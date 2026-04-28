from __future__ import annotations

from typing import Any

import bpy

from ..blender_nodes import (
    apply_gamma,
    clamp01_component,
    combine_components,
    component_binary_math,
    component_socket,
    component_unary_math,
    connect_or_set_input,
    constant_socket,
    input_socket,
    map_range_component,
    math_socket,
    smoothstep_component,
)
from ..document import category, type_name
from ..types import CompileContext, CompiledSocket
from ..values import COMPONENT_TYPES, component_count, static_bool_input


SCALAR_MATH_OPERATIONS = {
    "add": "ADD",
    "subtract": "SUBTRACT",
    "multiply": "MULTIPLY",
    "mul": "MULTIPLY",
    "divide": "DIVIDE",
    "div": "DIVIDE",
    "modulo": "MODULO",
    "power": "POWER",
    "sin": "SINE",
    "cos": "COSINE",
    "asin": "ARCSINE",
    "acos": "ARCCOSINE",
    "atan2": "ARCTAN2",
    "ceil": "CEIL",
    "floor": "FLOOR",
    "fract": "FRACT",
    "absval": "ABSOLUTE",
    "exp": "EXPONENT",
    "tan": "TANGENT",
    "sqrt": "SQRT",
    "round": "ROUND",
    "sign": "SIGN",
    "min": "MINIMUM",
    "max": "MAXIMUM",
}
VECTOR_MATH_OPERATIONS = {
    "normalize": ("NORMALIZE", "Vector", "vector3"),
    "dotproduct": ("DOT_PRODUCT", "Value", "float"),
    "crossproduct": ("CROSS_PRODUCT", "Vector", "vector3"),
    "distance": ("DISTANCE", "Value", "float"),
}
BINARY_INPUTS = {
    "add": ("in1", "in2", 0.0, 0.0),
    "subtract": ("in1", "in2", 0.0, 0.0),
    "multiply": ("in1", "in2", 0.0, 1.0),
    "mul": ("in1", "in2", 0.0, 1.0),
    "divide": ("in1", "in2", 0.0, 1.0),
    "div": ("in1", "in2", 0.0, 1.0),
    "modulo": ("in1", "in2", 0.0, 1.0),
    "power": ("in1", "in2", 0.0, 1.0),
    "atan2": ("iny", "inx", 0.0, 1.0),
    "min": ("in1", "in2", 0.0, 0.0),
    "max": ("in1", "in2", 0.0, 0.0),
}
UNARY_INPUTS = {
    "sin": ("in", 0.0),
    "cos": ("in", 0.0),
    "asin": ("in", 0.0),
    "acos": ("in", 0.0),
    "ceil": ("in", 0.0),
    "floor": ("in", 0.0),
    "fract": ("in", 0.0),
    "absval": ("in", 0.0),
    "exp": ("in", 0.0),
    "tan": ("in", 0.0),
    "sqrt": ("in", 0.0),
    "round": ("in", 0.0),
    "sign": ("in", 0.0),
}


def register(registry) -> None:
    registry.register_categories(SCALAR_MATH_OPERATIONS.keys(), compile_math)
    registry.register("clamp", compile_clamp)
    registry.register_many({"range", "remap"}, compile_range)
    registry.register("smoothstep", compile_smoothstep)
    registry.register("safepower", compile_safepower)
    registry.register("invert", compile_invert)
    registry.register_many({"magnitude", "length"}, compile_magnitude)
    registry.register_categories(VECTOR_MATH_OPERATIONS.keys(), compile_vector_math)


def compile_math(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = category(node)
    output_type = type_name(node)
    operation = SCALAR_MATH_OPERATIONS[node_category]
    if output_type in COMPONENT_TYPES:
        if node_category in BINARY_INPUTS:
            in1, in2, default1, default2 = BINARY_INPUTS[node_category]
            return component_binary_math(context, node, operation, in1, in2, default1, default2, scope)
        input_name, default = UNARY_INPUTS[node_category]
        return component_unary_math(context, node, operation, input_name, default, scope)

    math_node = context.material.node_tree.nodes.new(type="ShaderNodeMath")
    math_node.operation = operation
    if node_category in BINARY_INPUTS:
        in1, in2, default1, default2 = BINARY_INPUTS[node_category]
        connect_or_set_input(context, node, in1, math_node.inputs[0], default1, scope)
        connect_or_set_input(context, node, in2, math_node.inputs[1], default2, scope)
    else:
        input_name, default = UNARY_INPUTS[node_category]
        connect_or_set_input(context, node, input_name, math_node.inputs[0], default, scope)
    return CompiledSocket(math_node.outputs[0], "float")


def compile_clamp(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    if type_name(node) in COMPONENT_TYPES:
        output_type = type_name(node)
        source = input_socket(context, node, "in", 0.0, scope)
        low = input_socket(context, node, "low", 0.0, scope)
        high = input_socket(context, node, "high", 1.0, scope)
        components: list[bpy.types.NodeSocket] = []
        for index in range(component_count(output_type)):
            clamped_low = math_socket(
                context,
                "MAXIMUM",
                component_socket(context, source, index),
                component_socket(context, low, index),
            )
            components.append(math_socket(context, "MINIMUM", clamped_low, component_socket(context, high, index)))
        return combine_components(context, components, output_type)

    clamp = context.material.node_tree.nodes.new(type="ShaderNodeClamp")
    connect_or_set_input(context, node, "in", clamp.inputs[0], 0.0, scope)
    connect_or_set_input(context, node, "low", clamp.inputs[1], 0.0, scope)
    connect_or_set_input(context, node, "high", clamp.inputs[2], 1.0, scope)
    return CompiledSocket(clamp.outputs[0], "float")


def compile_range(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = category(node)
    output_type = type_name(node) or "float"
    source = input_socket(context, node, "in", 0.0, scope)
    in_low = input_socket(context, node, "inlow", 0.0, scope)
    in_high = input_socket(context, node, "inhigh", 1.0, scope)
    out_low = input_socket(context, node, "outlow", 0.0, scope)
    out_high = input_socket(context, node, "outhigh", 1.0, scope)
    gamma = input_socket(context, node, "gamma", 1.0, scope)
    do_clamp = static_bool_input(node, "doclamp", False)

    components: list[bpy.types.NodeSocket] = []
    for index in range(component_count(output_type)):
        normalized = map_range_component(
            context,
            component_socket(context, source, index),
            component_socket(context, in_low, index),
            component_socket(context, in_high, index),
            constant_socket(context, 0.0, "float").socket,
            constant_socket(context, 1.0, "float").socket,
            False,
        )
        gamma_applied = normalized if node_category == "remap" else apply_gamma(context, normalized, component_socket(context, gamma, index))
        components.append(
            map_range_component(
                context,
                gamma_applied,
                constant_socket(context, 0.0, "float").socket,
                constant_socket(context, 1.0, "float").socket,
                component_socket(context, out_low, index),
                component_socket(context, out_high, index),
                do_clamp,
            )
        )
    return combine_components(context, components, output_type)


def compile_smoothstep(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    output_type = type_name(node) or "float"
    source = input_socket(context, node, "in", 0.0, scope)
    low = input_socket(context, node, "low", 0.0, scope)
    high = input_socket(context, node, "high", 1.0, scope)
    components = [
        smoothstep_component(
            context,
            component_socket(context, source, index),
            component_socket(context, low, index),
            component_socket(context, high, index),
        )
        for index in range(component_count(output_type))
    ]
    return combine_components(context, components, output_type)


def compile_safepower(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    output_type = type_name(node) or "float"
    input1 = input_socket(context, node, "in1", 0.0, scope)
    input2 = input_socket(context, node, "in2", 1.0, scope)
    components = []
    for index in range(component_count(output_type)):
        base = component_socket(context, input1, index)
        exponent = component_socket(context, input2, index)
        sign = math_socket(context, "SIGN", base, None)
        magnitude = math_socket(context, "POWER", math_socket(context, "ABSOLUTE", base, None), exponent)
        components.append(math_socket(context, "MULTIPLY", sign, magnitude))
    return combine_components(context, components, output_type)


def compile_invert(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    if type_name(node) in COMPONENT_TYPES:
        return component_binary_math(context, node, "SUBTRACT", "amount", "in", 1.0, 0.0, scope)
    math_node = context.material.node_tree.nodes.new(type="ShaderNodeMath")
    math_node.operation = "SUBTRACT"
    connect_or_set_input(context, node, "amount", math_node.inputs[0], 1.0, scope)
    connect_or_set_input(context, node, "in", math_node.inputs[1], 0.0, scope)
    return CompiledSocket(math_node.outputs[0], "float")


def compile_magnitude(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    source = input_socket(context, node, "in", 0.0, scope)
    if source.type_name in COMPONENT_TYPES:
        vector_node = context.material.node_tree.nodes.new(type="ShaderNodeVectorMath")
        vector_node.operation = "LENGTH"
        context.material.node_tree.links.new(source.socket, vector_node.inputs[0])
        return CompiledSocket(vector_node.outputs[1], "float")
    math_node = context.material.node_tree.nodes.new(type="ShaderNodeMath")
    math_node.operation = "ABSOLUTE"
    context.material.node_tree.links.new(source.socket, math_node.inputs[0])
    return CompiledSocket(math_node.outputs[0], "float")


def compile_vector_math(context: CompileContext, node: Any, output_name: str, scope: Any | None) -> CompiledSocket | None:
    node_category = category(node)
    operation, vector_output_name, output_type = VECTOR_MATH_OPERATIONS[node_category]
    vector_node = context.material.node_tree.nodes.new(type="ShaderNodeVectorMath")
    vector_node.operation = operation
    if node_category == "normalize":
        source = input_socket(context, node, "in", (0.0, 0.0, 0.0), scope)
        context.material.node_tree.links.new(source.socket, vector_node.inputs[0])
    else:
        input1 = input_socket(context, node, "in1", (0.0, 0.0, 0.0), scope)
        input2 = input_socket(context, node, "in2", (0.0, 0.0, 0.0), scope)
        context.material.node_tree.links.new(input1.socket, vector_node.inputs[0])
        context.material.node_tree.links.new(input2.socket, vector_node.inputs[1])
    socket = vector_node.outputs.get(vector_output_name)
    return CompiledSocket(socket, output_type) if socket is not None else None
