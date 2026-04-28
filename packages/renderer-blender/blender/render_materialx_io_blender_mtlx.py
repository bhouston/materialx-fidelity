from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from render_materialx import (
    apply_material,
    clear_scene,
    configure_render,
    elapsed_ms,
    find_normalized_root,
    import_model,
    log_timing_event,
    log_warnings_event,
    parse_args,
    recenter_and_normalize,
    setup_camera,
    setup_environment,
    time_call,
)


_SCRIPT_STARTED_AT = time.perf_counter()


def main() -> int:
    args = parse_args(sys.argv)
    warnings: list[str] = []

    if args.template_output_path:
        create_template(args, warnings)
        return 0

    render_from_template(args, warnings)
    return 0


def create_template(args: Any, warnings: list[str]) -> None:
    timings: dict[str, float] = {}
    started_at = time.perf_counter()
    time_call(timings, "clear_scene", clear_scene)
    time_call(
        timings,
        "configure_render",
        configure_render,
        args.width,
        args.height,
        None,
        args.background_color,
    )
    imported_objects = time_call(timings, "import_model", import_model, args.model_path)
    time_call(timings, "recenter_and_normalize", recenter_and_normalize, imported_objects)
    time_call(timings, "setup_camera", setup_camera)
    time_call(
        timings,
        "setup_environment",
        setup_environment,
        args.environment_hdr_path,
        args.background_color,
        warnings,
    )
    log_warnings_event("blender-io-mtlx-template-create", warnings)
    time_call(
        timings,
        "save_mainfile",
        bpy.ops.wm.save_as_mainfile,
        filepath=args.template_output_path,
    )
    timings["total"] = elapsed_ms(started_at)
    log_timing_event(
        "blender-io-mtlx-template-timing",
        timings,
        output=args.template_output_path,
        warnings=warnings,
    )
    print(
        json.dumps(
            {
                "event": "blender-io-mtlx-template-finish",
                "output": args.template_output_path,
                "warnings": warnings,
            }
        )
    )


def render_from_template(args: Any, warnings: list[str]) -> None:
    timings: dict[str, float] = {}
    started_at = time.perf_counter()
    time_call(
        timings,
        "configure_render",
        configure_render,
        args.width,
        args.height,
        args.output_png_path,
        args.background_color,
    )
    normalized_root = time_call(timings, "find_normalized_root", find_normalized_root)
    material = time_call(
        timings,
        "load_materialx_io_blender_mtlx",
        load_materialx_with_io_blender_mtlx,
        args.mtlx_path,
        args.third_party_root,
        warnings,
    )
    time_call(timings, "apply_material", apply_material, normalized_root, material)
    log_warnings_event("blender-io-mtlx-render-start", warnings)
    time_call(timings, "cycles_render", bpy.ops.render.render, write_still=True)
    timings["total"] = elapsed_ms(started_at)
    log_timing_event(
        "blender-io-mtlx-render-timing",
        timings,
        output=args.output_png_path,
        mtlx_path=args.mtlx_path,
        warnings=warnings,
    )
    print(
        json.dumps(
            {
                "event": "blender-io-mtlx-render-finish",
                "output": args.output_png_path,
                "warnings": warnings,
            }
        )
    )


def load_materialx_with_io_blender_mtlx(
    mtlx_path: str,
    third_party_root: str | None,
    warnings: list[str],
) -> bpy.types.Material:
    if not third_party_root:
        raise RuntimeError("--third-party-root is required for blender-io-mtlx.")

    addons_path = Path(third_party_root) / "io_blender_mtlx" / "bl_env" / "addons"
    addon_package_path = addons_path / "io_data_mtlx"
    if not addon_package_path.is_dir():
        raise RuntimeError(f"io_blender_mtlx add-on package was not found: {addon_package_path}")

    if str(addons_path) not in sys.path:
        sys.path.insert(0, str(addons_path))

    import io_data_mtlx

    try:
        io_data_mtlx.register()
    except ValueError as exc:
        warnings.append(f"io_blender_mtlx add-on was already registered: {exc}")

    material = bpy.data.materials.new("MaterialX_IO_MTLX")
    material.mtlx_document = str(Path(mtlx_path).resolve())
    if not material.use_nodes or material.node_tree is None:
        raise RuntimeError(f"io_blender_mtlx did not generate Blender nodes for: {mtlx_path}")
    return material


if __name__ == "__main__":
    raise SystemExit(main())
