from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import bpy


@dataclass
class MaterialImportResult:
    material: bpy.types.Material
    warnings: list[str] = field(default_factory=list)


@dataclass
class CompiledSocket:
    socket: bpy.types.NodeSocket
    type_name: str


@dataclass
class CompileContext:
    document: Any
    material: bpy.types.Material
    base_dir: Path
    warnings: list[str]
    cache: dict[tuple[int, str], CompiledSocket] = field(default_factory=dict)
    compiler: Any | None = None
