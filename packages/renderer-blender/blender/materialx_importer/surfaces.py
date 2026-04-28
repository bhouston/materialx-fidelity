from __future__ import annotations

from typing import Any

import bpy

from .blender_nodes import set_color_socket, set_scalar_socket
from .document import category, get_input, input_value, is_connected
from .types import CompileContext
from .values import parse_color, parse_float


def apply_surface_inputs(
    context: CompileContext,
    surface_node: Any,
    principled: bpy.types.Node,
) -> None:
    surface_category = category(surface_node)
    if surface_category == "standard_surface":
        scalar_inputs = {
            "metalness": "Metallic",
            "specular_roughness": "Roughness",
            "specular": "Specular IOR Level",
            "specular_ior": "IOR",
            "emission": "Emission Strength",
        }
        color_inputs = {
            "base_color": "Base Color",
            "emission_color": "Emission Color",
        }
    elif surface_category == "gltf_pbr":
        scalar_inputs = {
            "metallic": "Metallic",
            "roughness": "Roughness",
        }
        color_inputs = {
            "base_color": "Base Color",
            "emissive": "Emission Color",
        }
    else:
        context.warnings.append(f"Unsupported surface shader category: {surface_category}")
        return

    for input_name, socket_name in color_inputs.items():
        input_element = get_input(surface_node, input_name)
        if input_element is None:
            continue
        socket = principled.inputs.get(socket_name)
        if socket is None:
            continue
        if is_connected(input_element):
            compiled = context.compiler.compile_input(input_element) if context.compiler is not None else None
            if compiled is not None:
                context.material.node_tree.links.new(compiled.socket, socket)
            else:
                context.warnings.append(f"Unsupported connected color input: {input_name}")
            continue
        value = input_value(input_element)
        if value is not None:
            set_color_socket(principled, socket_name, parse_color(value))

    for input_name, socket_name in scalar_inputs.items():
        input_element = get_input(surface_node, input_name)
        if input_element is None:
            continue
        socket = principled.inputs.get(socket_name)
        if socket is None:
            continue
        if is_connected(input_element):
            compiled = context.compiler.compile_input(input_element) if context.compiler is not None else None
            if compiled is not None:
                context.material.node_tree.links.new(compiled.socket, socket)
            else:
                context.warnings.append(f"Unsupported connected scalar input: {input_name}")
            continue
        value = input_value(input_element)
        if value is not None:
            set_scalar_socket(principled, socket_name, parse_float(value))

    opacity = get_input(surface_node, "opacity")
    if opacity is not None:
        if is_connected(opacity):
            socket = principled.inputs.get("Alpha")
            compiled = context.compiler.compile_input(opacity) if context.compiler is not None else None
            if socket is not None and compiled is not None:
                context.material.node_tree.links.new(compiled.socket, socket)
                context.material.blend_method = "BLEND"
                if hasattr(context.material, "use_screen_refraction"):
                    context.material.use_screen_refraction = True
            else:
                context.warnings.append("Unsupported connected opacity input.")
        else:
            value = input_value(opacity)
            if value is None:
                return
            alpha = parse_color(value)[0]
            set_scalar_socket(principled, "Alpha", alpha)
            context.material.blend_method = "BLEND"
            if hasattr(context.material, "use_screen_refraction"):
                context.material.use_screen_refraction = True

    normal = get_input(surface_node, "normal")
    if normal is not None and is_connected(normal):
        socket = principled.inputs.get("Normal")
        compiled = context.compiler.compile_input(normal) if context.compiler is not None else None
        if socket is not None and compiled is not None:
            context.material.node_tree.links.new(compiled.socket, socket)
        else:
            context.warnings.append("Unsupported connected normal input.")


def get_principled_node(material: bpy.types.Material) -> bpy.types.Node | None:
    nodes = material.node_tree.nodes
    for node in nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def create_fallback_material(name: str) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    principled = get_principled_node(material)
    if principled is not None:
        set_color_socket(principled, "Base Color", (1.0, 0.0, 1.0, 1.0))
        set_scalar_socket(principled, "Roughness", 0.5)
    return material
