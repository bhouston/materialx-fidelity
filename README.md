# Material Fidelity Testing

Material Fidelity Testing is a TypeScript monorepo for generating and comparing renderer output for known MaterialX sample scenes.

## Repository Layout

- `packages/core` - renderer interfaces and reference-generation orchestration.
- `packages/cli` - command line tool for running renders.
- `packages/viewer` - TanStack Start website for browsing fidelity images.
- `packages/renderer-*` - renderer packages

## Requirements

- Node.js 24+
- pnpm 10+
- `materialxview` (or `MaterialXView`) available on your `PATH`

## Install

```bash
# pull in samples repository
git submodule update --init --recursive
```

```bash
pnpm install
```

## Build and Validate

```bash
pnpm build
pnpm tsc
pnpm lint
pnpm format
pnpm test
```

## CLI

Generate reference images:

```bash
# all renderers, all materials
pnpm cli create-references
```

```bash
# only generate MaterialX JavaScript renders of open_pbr materials
pnpm cli create-references --renderers materialxjs --materials open_pbr
```

This command writes `<renderer-name>.webp` in each directory containing a `material.mtlx`.

Currently supported renderers:

- `materialxjs` (`@materialx-fidelity/renderer-materialxjs`)
- `materialxview` (`@materialx-fidelity/renderer-materialxview`)
- `threejs` (`@materialx-fidelity/renderer-threejs`)

Optional flags:

- `--renderers <name[,name...]>` optional renderer filter; supports repeated flags and comma-separated values
- `--materials <selector[,selector...]>` optional material filter; matches against each material directory name only (leaf directory), supports repeated flags, comma-separated values, substring matches, and regex selectors (`re:...` or `/.../flags`)
- `--concurrency <number>` default `1`

## Material Organization

Samples are organized by purpose:

- `third_party/materialx-samples/materials/nodes` - canonical per-node tests
- `third_party/materialx-samples/materials/surfaces/<surface_type>` - surface/showcase samples grouped by shader family

## Node Isolation Suite

The node isolation materials currently live under:

- `third_party/materialx-samples/materials/surfaces/gltf_pbr/node_isolation`

Each node gets its own directory and `material.mtlx`, with phase planning documented in:

- `third_party/materialx-samples/materials/surfaces/gltf_pbr/node_isolation/PHASES.md`

### Validate Node Isolation Materials

```bash
# single material (run from repo root)
pnpm --filter @materialx-js/materialx-cli start validate "$PWD/third_party/materialx-samples/materials/surfaces/gltf_pbr/node_isolation/add/material.mtlx"
```

```bash
# validate all node-isolation materials
python3 - <<'PY'
from pathlib import Path
import subprocess

root = Path.cwd()
files = sorted((root / "third_party/materialx-samples/materials/surfaces/gltf_pbr/node_isolation").glob("*/material.mtlx"))
for file in files:
    subprocess.run(
        ["pnpm", "--filter", "@materialx-js/materialx-cli", "start", "validate", str(file)],
        check=True,
    )
print(f"Validated {len(files)} materials.")
PY
```

### Regenerate Node Isolation References

```bash
# all node-isolation materials
pnpm cli create-references --materials node_isolation
```

```bash
# targeted node subset by regex on leaf directory names
pnpm cli create-references --materials "re:(image|tiledimage|transformmatrix)$"
```

## Surface Input Coverage

Surface samples now follow an input-driven naming convention:

- `input_<primary_input>` for single-input isolates
- `graph_<target_input>_<source>` for graph-driven isolates
- `showcase_<stack_or_look>` for intentionally multi-feature examples

Coverage and rename artifacts:

- `docs/surface-input-coverage-baseline.json`
- `docs/surface-input-coverage-baseline.md`
- `docs/surface-sample-rename-map.md`

## Reference Renderer Setup

To keep reference renders visually comparable between `materialxview` and `threejs`, both renderers should follow this framing setup:

- camera: perspective, FOV `45`, near `0.05`, eye `(0,0,5)`, look target `(0,0,0)`
- model normalization: center the loaded `ShaderBall.glb` at the origin, then scale it so the bounding-box sphere radius is `2.0` (matching `MaterialXView`'s `IDEAL_MESH_SPHERE_RADIUS`)
- lighting for capture: IBL from `san_giuseppe_bridge_2k.hdr`, environment background enabled, direct light disabled, shadow map disabled
- environment orientation parity: apply a Y rotation offset of `-90` degrees in the Three.js viewer (`scene.environmentRotation.y`) to match MaterialXView lighting orientation
- color/output: no tone mapping, sRGB output encoding
- visible background comes from the active environment HDR (`san_giuseppe_bridge_2k.hdr`)
- fixed resolution of `1024x1024`

These values are intentionally aligned with `MaterialXView` defaults and its scene normalization behavior in `source/MaterialXView/Viewer.cpp`.

## Viewer

Run the MaterialX Fidelity Viewer:

```bash
pnpm viewer
```

The viewer scans MaterialX materials and looks for images for the built-in renderer list (`materialxjs`, `materialxview`, `threejs`).

The page groups materials by purpose/type (`nodes`, `open_pbr_surface`, `gltf_pbr`, `standard_surface`) and displays each renderer image (`<renderer>.webp`) side by side. Missing images render as a placeholder tile.

## License

MIT. See `LICENSE`.
