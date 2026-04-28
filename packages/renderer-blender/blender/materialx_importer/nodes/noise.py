from __future__ import annotations

from typing import Any

import bpy

from ..blender_nodes import (
    component_socket,
    connect_or_set_input,
    constant_socket,
    coordinate_socket,
    input_socket,
    map_range_component,
    math_socket,
    scale_socket,
    texture_output,
    vector_math_output,
)
from ..document import type_name
from ..types import CompileContext, CompiledSocket
from ..values import COMPONENT_TYPES, component_count, static_bool_input, static_int_input


def register(registry) -> None:
    registry.register_many({"noise2d", "noise3d", "fractal2d", "fractal3d"}, compile_noise)
    registry.register_many({"cellnoise2d", "cellnoise3d"}, compile_cellnoise)
    registry.register_many({"worleynoise2d", "worleynoise3d", "worley2d", "worley3d"}, compile_worley)
    registry.register_many({"unifiednoise2d", "unifiednoise3d"}, compile_unified_noise)


def compile_noise(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = node.getCategory()
    is_2d = node_category.endswith("2d")
    is_fractal = node_category.startswith("fractal")
    texture = context.material.node_tree.nodes.new(type="ShaderNodeTexNoise")
    texture.label = f"MaterialX {node.getName()}"
    texture.noise_dimensions = "2D" if is_2d else "3D"
    if hasattr(texture, "normalize"):
        texture.normalize = False

    coordinate = coordinate_socket(context, node, "texcoord" if is_2d else "position", is_2d, scope)
    context.material.node_tree.links.new(coordinate.socket, texture.inputs["Vector"])

    if is_fractal:
        connect_or_set_input(context, node, "octaves", texture.inputs["Detail"], 3.0, scope)
        connect_or_set_input(context, node, "diminish", texture.inputs["Roughness"], 0.5, scope)
        if "Lacunarity" in texture.inputs:
            connect_or_set_input(context, node, "lacunarity", texture.inputs["Lacunarity"], 2.0, scope)
    else:
        texture.inputs["Detail"].default_value = 16.0
        texture.inputs["Roughness"].default_value = 0.5

    output_type = type_name(node) or "float"
    source_type = output_type if output_type in COMPONENT_TYPES else "float"
    source = texture_output(texture, "Color" if output_type in COMPONENT_TYPES else "Factor", "Fac")
    if source is None:
        return None
    return scale_noise_output(context, node, CompiledSocket(source, source_type), output_type, scope)


def compile_cellnoise(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = node.getCategory()
    is_2d = node_category.endswith("2d")
    texture = context.material.node_tree.nodes.new(type="ShaderNodeTexWhiteNoise")
    texture.label = f"MaterialX {node.getName()}"
    texture.noise_dimensions = "2D" if is_2d else "3D"

    coordinate = coordinate_socket(context, node, "texcoord" if is_2d else "position", is_2d, scope)
    context.material.node_tree.links.new(coordinate.socket, texture.inputs["Vector"])

    source = texture.outputs.get("Value")
    return CompiledSocket(source, "float") if source is not None else None


def compile_worley(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = node.getCategory()
    is_2d = node_category.endswith("2d")
    texture = create_voronoi_texture(context, node, is_2d)
    coordinate = coordinate_socket(context, node, "texcoord" if is_2d else "position", is_2d, scope)
    context.material.node_tree.links.new(coordinate.socket, texture.inputs["Vector"])
    connect_or_set_input(context, node, "jitter", texture.inputs["Randomness"], 1.0, scope)

    output_type = type_name(node) or "float"
    if output_type in COMPONENT_TYPES:
        source = texture.outputs.get("Color")
        return CompiledSocket(source, output_type) if source is not None else None
    if static_int_input(node, "style", 0) == 1:
        color = texture.outputs.get("Color")
        return CompiledSocket(component_socket(context, CompiledSocket(color, "color3"), 0), "float") if color is not None else None
    source = texture.outputs.get("Distance")
    return CompiledSocket(source, "float") if source is not None else None


def compile_unified_noise(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = node.getCategory()
    is_2d = node_category.endswith("2d")
    coordinate = coordinate_socket(context, node, "texcoord" if is_2d else "position", is_2d, scope)
    frequency = input_socket(context, node, "freq", (1.0, 1.0, 1.0), scope)
    offset = input_socket(context, node, "offset", (0.0, 0.0, 0.0), scope)
    scaled = vector_math_output(context, "MULTIPLY", coordinate.socket, frequency.socket)
    positioned = vector_math_output(context, "ADD", scaled, offset.socket)

    noise_type = static_int_input(node, "type", 0)
    if noise_type == 1:
        source = cellnoise_texture_output(context, node, is_2d, positioned)
    elif noise_type == 2:
        source = worley_texture_output(context, node, is_2d, positioned, scope)
    elif noise_type == 3:
        source = noise_texture_output(context, node, is_2d, positioned, scope, fractal=True, amplitude=1.0, pivot=0.0)
    else:
        source = noise_texture_output(context, node, is_2d, positioned, scope, fractal=False, amplitude=0.5, pivot=0.5)

    if source is None:
        return None
    return CompiledSocket(apply_output_range(context, node, source, scope), "float")


def scale_noise_output(
    context: CompileContext,
    node: Any,
    source: CompiledSocket,
    output_type: str,
    scope: Any | None,
) -> CompiledSocket:
    amplitude = input_socket(context, node, "amplitude", 1.0, scope)
    pivot = input_socket(context, node, "pivot", 0.0, scope)
    components: list[bpy.types.NodeSocket] = []
    for index in range(component_count(output_type)):
        source_component = component_socket(context, source, index)
        pivot_component = component_socket(context, pivot, index)
        amplitude_component = component_socket(context, amplitude, index)
        centered = math_socket(context, "SUBTRACT", source_component, pivot_component)
        scaled = math_socket(context, "MULTIPLY", centered, amplitude_component)
        components.append(math_socket(context, "ADD", scaled, pivot_component))
    from ..blender_nodes import combine_components

    return combine_components(context, components, output_type)


def noise_texture_output(
    context: CompileContext,
    node: Any,
    is_2d: bool,
    vector: bpy.types.NodeSocket,
    scope: Any | None,
    fractal: bool,
    amplitude: float,
    pivot: float,
) -> bpy.types.NodeSocket | None:
    texture = context.material.node_tree.nodes.new(type="ShaderNodeTexNoise")
    texture.label = f"MaterialX {node.getName()} Noise"
    texture.noise_dimensions = "2D" if is_2d else "3D"
    if hasattr(texture, "normalize"):
        texture.normalize = False
    context.material.node_tree.links.new(vector, texture.inputs["Vector"])
    if fractal:
        connect_or_set_input(context, node, "octaves", texture.inputs["Detail"], 3.0, scope)
        connect_or_set_input(context, node, "diminish", texture.inputs["Roughness"], 0.5, scope)
        if "Lacunarity" in texture.inputs:
            connect_or_set_input(context, node, "lacunarity", texture.inputs["Lacunarity"], 2.0, scope)
    else:
        texture.inputs["Detail"].default_value = 16.0
        texture.inputs["Roughness"].default_value = 0.5
    source = texture_output(texture, "Factor", "Fac")
    if source is None:
        return None
    return scale_socket(context, source, amplitude, pivot)


def cellnoise_texture_output(
    context: CompileContext,
    node: Any,
    is_2d: bool,
    vector: bpy.types.NodeSocket,
) -> bpy.types.NodeSocket | None:
    texture = context.material.node_tree.nodes.new(type="ShaderNodeTexWhiteNoise")
    texture.label = f"MaterialX {node.getName()} Cell"
    texture.noise_dimensions = "2D" if is_2d else "3D"
    context.material.node_tree.links.new(vector, texture.inputs["Vector"])
    return texture.outputs.get("Value")


def worley_texture_output(
    context: CompileContext,
    node: Any,
    is_2d: bool,
    vector: bpy.types.NodeSocket,
    scope: Any | None,
) -> bpy.types.NodeSocket | None:
    texture = create_voronoi_texture(context, node, is_2d)
    context.material.node_tree.links.new(vector, texture.inputs["Vector"])
    connect_or_set_input(context, node, "jitter", texture.inputs["Randomness"], 1.0, scope)
    if static_int_input(node, "style", 0) == 1:
        color = texture.outputs.get("Color")
        return component_socket(context, CompiledSocket(color, "color3"), 0) if color is not None else None
    return texture.outputs.get("Distance")


def create_voronoi_texture(context: CompileContext, node: Any, is_2d: bool) -> bpy.types.Node:
    texture = context.material.node_tree.nodes.new(type="ShaderNodeTexVoronoi")
    texture.label = f"MaterialX {node.getName()}"
    texture.voronoi_dimensions = "2D" if is_2d else "3D"
    texture.feature = "F1"
    texture.distance = "EUCLIDEAN"
    if hasattr(texture, "normalize"):
        texture.normalize = False
    return texture


def apply_output_range(
    context: CompileContext,
    node: Any,
    source: bpy.types.NodeSocket,
    scope: Any | None,
) -> bpy.types.NodeSocket:
    out_low = input_socket(context, node, "outmin", 0.0, scope)
    out_high = input_socket(context, node, "outmax", 1.0, scope)
    return map_range_component(
        context,
        source,
        constant_socket(context, 0.0, "float").socket,
        constant_socket(context, 1.0, "float").socket,
        component_socket(context, out_low, 0),
        component_socket(context, out_high, 0),
        static_bool_input(node, "clampoutput", True),
    )
