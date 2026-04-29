from __future__ import annotations

from typing import Any

import bpy

from ..blender_nodes import constant_socket, input_socket, math_socket
from ..types import CompileContext, CompiledSocket


def register(registry) -> None:
    registry.register_many({"texcoord", "position", "normal"}, compile_geometry)
    registry.register("frame", compile_frame)
    registry.register("time", compile_time)


def compile_geometry(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    return compile_geometry_category(context, node.getCategory())


def compile_geometry_category(context: CompileContext, category: str) -> CompiledSocket | None:
    nodes = context.material.node_tree.nodes
    if category == "texcoord":
        node = nodes.new(type="ShaderNodeTexCoord")
        socket = node.outputs.get("UV")
        return CompiledSocket(socket, "vector2") if socket is not None else None
    if category == "normal":
        node = nodes.new(type="ShaderNodeNewGeometry")
        socket = node.outputs.get("Normal")
        return CompiledSocket(socket, "vector3") if socket is not None else None
    node = nodes.new(type="ShaderNodeTexCoord")
    socket = node.outputs.get("Object")
    return materialx_position_socket(context, socket) if socket is not None else None


def materialx_position_socket(context: CompileContext, blender_position: bpy.types.NodeSocket) -> CompiledSocket:
    # MaterialX position defaults to object/model space. Blender supplies that
    # in its Z-up basis, so convert once at the geometry semantic boundary.
    separate = context.material.node_tree.nodes.new(type="ShaderNodeSeparateXYZ")
    context.material.node_tree.links.new(blender_position, separate.inputs["Vector"])

    negate_y = math_socket(
        context,
        "MULTIPLY",
        separate.outputs["Y"],
        constant_socket(context, -1.0, "float").socket,
    )

    combine = context.material.node_tree.nodes.new(type="ShaderNodeCombineXYZ")
    context.material.node_tree.links.new(separate.outputs["X"], combine.inputs["X"])
    context.material.node_tree.links.new(separate.outputs["Z"], combine.inputs["Y"])
    context.material.node_tree.links.new(negate_y, combine.inputs["Z"])
    return CompiledSocket(combine.outputs["Vector"], "vector3")


def compile_frame(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    return constant_socket(context, float(bpy.context.scene.frame_current), "float")


def compile_time(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    frame_offset = constant_socket(context, float(bpy.context.scene.frame_current - 1), "float")
    fps = input_socket(context, node, "fps", 24.0, scope)
    return CompiledSocket(math_socket(context, "DIVIDE", frame_offset.socket, fps.socket), "float")
