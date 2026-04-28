from __future__ import annotations

from typing import Any

from ..blender_nodes import connect_or_set_input, input_socket
from ..document import type_name
from ..types import CompileContext, CompiledSocket


def register(registry) -> None:
    registry.register_many({"separate2", "separate3", "separate4"}, compile_separate)
    registry.register_many({"combine2", "combine3", "combine4"}, compile_combine)


def compile_separate(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    source = input_socket(context, node, "in", 0.0, scope)
    separate = context.material.node_tree.nodes.new(type="ShaderNodeSeparateXYZ")
    context.material.node_tree.links.new(source.socket, separate.inputs["Vector"])
    output_map = {"x": "X", "y": "Y", "z": "Z", "r": "X", "g": "Y", "b": "Z"}
    socket = separate.outputs.get(output_map.get(output_name, "X"))
    return CompiledSocket(socket, "float") if socket is not None else None


def compile_combine(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    combine = context.material.node_tree.nodes.new(type="ShaderNodeCombineXYZ")
    for input_name, socket_name in (("in1", "X"), ("in2", "Y"), ("in3", "Z")):
        connect_or_set_input(context, node, input_name, combine.inputs[socket_name], 0.0, scope)
    socket = combine.outputs.get("Vector")
    return CompiledSocket(socket, type_name(node) or "vector3") if socket is not None else None
