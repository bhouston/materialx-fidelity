from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from materialx_importer import load_materialx_as_blender_material

IDEAL_MESH_SPHERE_RADIUS = 2.0
ENVIRONMENT_ROTATION_DEGREES = 90.0


def main() -> int:
    args = parse_args(sys.argv)
    warnings: list[str] = []

    if args.template_output_path:
        create_template(args, warnings)
        return 0

    render_from_template(args, warnings)
    return 0


def create_template(args: argparse.Namespace, warnings: list[str]) -> None:
    clear_scene()
    configure_render(args.width, args.height, None, args.background_color)
    imported_objects = import_model(args.model_path)
    recenter_and_normalize(imported_objects)
    setup_camera()
    setup_environment(args.environment_hdr_path, args.background_color, warnings)
    print(json.dumps({"event": "blender-template-create", "warnings": warnings}))
    bpy.ops.wm.save_as_mainfile(filepath=args.template_output_path)
    print(json.dumps({"event": "blender-template-finish", "output": args.template_output_path, "warnings": warnings}))


def render_from_template(args: argparse.Namespace, warnings: list[str]) -> None:
    configure_render(args.width, args.height, args.output_png_path, args.background_color)
    normalized_root = find_normalized_root()
    material_result = load_materialx_as_blender_material(args.mtlx_path)
    warnings.extend(material_result.warnings)
    apply_material(normalized_root, material_result.material)
    print(json.dumps({"event": "blender-render-start", "warnings": warnings}))
    bpy.ops.render.render(write_still=True)
    print(json.dumps({"event": "blender-render-finish", "output": args.output_png_path, "warnings": warnings}))


def parse_args(argv: list[str]) -> argparse.Namespace:
    passthrough_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Render a MaterialX material on the fidelity shader ball in Blender.")
    parser.add_argument("--mtlx-path")
    parser.add_argument("--output-png-path")
    parser.add_argument("--model-path")
    parser.add_argument("--environment-hdr-path")
    parser.add_argument("--template-output-path")
    parser.add_argument("--background-color", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--third-party-root")
    args = parser.parse_args(passthrough_args)

    if args.template_output_path:
        required_template_args = {
            "--model-path": args.model_path,
            "--environment-hdr-path": args.environment_hdr_path,
        }
        missing_template_args = [name for name, value in required_template_args.items() if not value]
        if missing_template_args:
            parser.error(f"Template creation requires: {', '.join(missing_template_args)}")
        return args

    required_render_args = {
        "--mtlx-path": args.mtlx_path,
        "--output-png-path": args.output_png_path,
    }
    missing_render_args = [name for name, value in required_render_args.items() if not value]
    if missing_render_args:
        parser.error(f"Template rendering requires: {', '.join(missing_render_args)}")
    return args


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def configure_render(width: int, height: int, output_png_path: str | None, background_color: str) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 4
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    if output_png_path is not None:
        scene.render.filepath = output_png_path
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    color = parse_background_color(background_color)
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = color[:3]


def import_model(model_path: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=model_path)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    if not imported:
        raise RuntimeError(f"No objects imported from model: {model_path}")
    return imported


def recenter_and_normalize(objects: list[bpy.types.Object]) -> bpy.types.Object:
    mesh_objects = [obj for obj in objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("Imported model did not contain mesh objects.")

    for obj in mesh_objects:
        obj.data.transform(obj.matrix_world)
        obj.data.update()
        obj.matrix_world = Matrix.Identity(4)
        obj.parent = None
    bpy.context.view_layer.update()

    min_corner = Vector((math.inf, math.inf, math.inf))
    max_corner = Vector((-math.inf, -math.inf, -math.inf))
    for obj in mesh_objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            min_corner.x = min(min_corner.x, point.x)
            min_corner.y = min(min_corner.y, point.y)
            min_corner.z = min(min_corner.z, point.z)
            max_corner.x = max(max_corner.x, point.x)
            max_corner.y = max(max_corner.y, point.y)
            max_corner.z = max(max_corner.z, point.z)

    size = max_corner - min_corner
    sphere_radius = size.length * 0.5
    if sphere_radius <= 0:
        raise RuntimeError("Imported model has an empty bounding volume.")

    center = (min_corner + max_corner) * 0.5
    scale = IDEAL_MESH_SPHERE_RADIUS / sphere_radius
    root = bpy.data.objects.new("Normalized_ShaderBall", None)
    bpy.context.collection.objects.link(root)
    root.scale = (scale, scale, scale)
    root.location = (-center.x * scale, -center.y * scale, -center.z * scale)
    for obj in mesh_objects:
        obj.parent = root
    return root


def find_normalized_root() -> bpy.types.Object:
    root = bpy.data.objects.get("Normalized_ShaderBall")
    if root is None:
        raise RuntimeError("Template scene is missing Normalized_ShaderBall.")
    return root


def apply_material(root: bpy.types.Object, material: bpy.types.Material) -> None:
    mesh_objects = [obj for obj in iter_descendants(root) if obj.type == "MESH"]
    named_targets = [obj for obj in mesh_objects if obj.name in {"Calibration_Mesh", "Preview_Mesh"}]
    targets = named_targets if len(named_targets) == 2 else mesh_objects
    for obj in targets:
        obj.data.materials.clear()
        obj.data.materials.append(material)


def iter_descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    descendants: list[bpy.types.Object] = []
    pending = list(root.children)
    while pending:
        obj = pending.pop(0)
        descendants.append(obj)
        pending.extend(obj.children)
    return descendants


def setup_camera() -> None:
    camera_data = bpy.data.cameras.new("Fidelity_Camera")
    camera = bpy.data.objects.new("Fidelity_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.0, -5.0, 0.0)
    camera_data.angle = math.radians(45.0)
    camera_data.clip_start = 0.05
    camera_data.clip_end = 1000.0
    look_at(camera, Vector((0.0, 0.0, 0.0)))
    bpy.context.scene.camera = camera


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Z").to_euler()


def setup_environment(environment_hdr_path: str, background_color: str, warnings: list[str]) -> None:
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputWorld")
    background = nodes.new(type="ShaderNodeBackground")
    environment = nodes.new(type="ShaderNodeTexEnvironment")
    mapping = nodes.new(type="ShaderNodeMapping")
    texcoord = nodes.new(type="ShaderNodeTexCoord")

    try:
        environment.image = bpy.data.images.load(environment_hdr_path, check_existing=True)
    except RuntimeError as exc:
        warnings.append(f"Failed to load HDR environment; using flat background: {exc}")
        background.inputs["Color"].default_value = parse_background_color(background_color)
        links.new(background.outputs["Background"], output.inputs["Surface"])
        return

    mapping.inputs["Rotation"].default_value[2] = math.radians(ENVIRONMENT_ROTATION_DEGREES)
    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], environment.inputs["Vector"])
    links.new(environment.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])
    background.inputs["Strength"].default_value = 1.0


def parse_background_color(value: str) -> tuple[float, float, float, float]:
    pieces = [float(piece.strip()) for piece in value.split(",") if piece.strip()]
    if len(pieces) != 3:
        raise ValueError(f'Expected background color as "r,g,b", received: {value}')
    return (pieces[0], pieces[1], pieces[2], 1.0)


if __name__ == "__main__":
    raise SystemExit(main())
