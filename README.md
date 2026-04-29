# Material Fidelity Testing

Material Fidelity is a TypeScript monorepo for generating and comparing renderer output for known MaterialX sample scenes.

## Repository Layout

- `packages/core` - renderer interfaces and reference-generation orchestration.
- `packages/cli` - command line tool for running renders.
- `packages/viewer` - TanStack Start website for browsing fidelity images.
- `packages/renderer-*` - renderer packages

## Requirements

- Node.js 24+
- pnpm 10+
- `materialxview` (or `MaterialXView`) available on your `PATH`
- Blender 4.0+ available as `blender` on your `PATH` or via `BLENDER_EXECUTABLE` (`blender-nodes` requires the patched Blender executable or `BLENDER_NODES_EXECUTABLE`; `blender-io-mtlx` requires Blender 5.0+)

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
pnpm cli render
```

```bash
# only generate MaterialX JavaScript renders of open_pbr materials
pnpm cli render --renderers materialxjs --materials open_pbr
```

This command writes `<renderer-name>.png` in each directory containing a `.mtlx` material file.

Currently supported renderers:

- `materialxview` (`@material-fidelity/renderer-materialxview`)
- `blender-new` (`@material-fidelity/renderer-blender`, Blender bundled MaterialX rendered through Cycles)
- `blender-nodes` (`@material-fidelity/renderer-blender`, patched Blender custom MaterialX nodes rendered through Cycles)
- `blender-io-mtlx` (`@material-fidelity/renderer-blender`, vendored `io_blender_mtlx` add-on rendered through Cycles)
- `materialxjs` (`@material-fidelity/renderer-materialxjs`)
- `threejs-current` (`@material-fidelity/renderer-threejs`, official npm Three.js MaterialX support)
- `threejs-new` (`@material-fidelity/renderer-threejs`, custom MaterialX support proposal)

Optional flags:

- `--renderers <name[,name...]>` optional renderer filter; supports repeated flags and comma-separated values
- `--materials <selector[,selector...]>` optional material filter; matches against each material directory name only (leaf directory), supports repeated flags, comma-separated values, substring matches, and regex selectors (`re:...` or `/.../flags`)
- `--concurrency <number>` optional render concurrency; defaults to the recommended available parallelism, with a minimum of `1`
- `--skip-existing` only render renderer/material pairs whose `<renderer-name>.png` output does not already exist

## Material Organization

Samples are organized by purpose:

- `third_party/material-samples/materials/nodes` - canonical per-node tests
- `third_party/material-samples/materials/surfaces/<surface_type>` - focused surface-attribute/debug samples grouped by shader family
- `third_party/material-samples/materials/showcase/<surface_type>` - complex, transferable showcase materials grouped by shader family

## Node Isolation Suite

The node isolation materials currently live under:

- `third_party/material-samples/materials/surfaces/gltf_pbr/node_isolation`

Each node gets its own directory and `<node-name>.mtlx`, with phase planning documented in:

- `third_party/material-samples/materials/surfaces/gltf_pbr/node_isolation/PHASES.md`

### Validate Node Isolation Materials

```bash
# single material (run from repo root)
pnpm --filter @material-viewer/materialx-cli start validate "$PWD/third_party/material-samples/materials/surfaces/gltf_pbr/node_isolation/add/add.mtlx"
```

```bash
# validate all node-isolation materials
python3 - <<'PY'
from pathlib import Path
import subprocess

root = Path.cwd()
files = sorted((root / "third_party/material-samples/materials/surfaces/gltf_pbr/node_isolation").glob("*/*.mtlx"))
for file in files:
    subprocess.run(
        ["pnpm", "--filter", "@material-viewer/materialx-cli", "start", "validate", str(file)],
        check=True,
    )
print(f"Validated {len(files)} materials.")
PY
```

### Regenerate Node Isolation References

```bash
# all node-isolation materials
pnpm cli render --materials node_isolation
```

```bash
# targeted node subset by regex on leaf directory names
pnpm cli render --materials "re:(image|tiledimage|transformmatrix)$"
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

To keep reference renders visually comparable between `materialxview`, `threejs-new`, and `threejs-current`, these renderers should follow this framing setup:

- camera: perspective, FOV `45`, near `0.05`, eye `(0,0,5)`, look target `(0,0,0)`
- model normalization: center the loaded `ShaderBall.glb` at the origin, then scale it so the bounding-box sphere radius is `2.0` (matching `MaterialXView`'s `IDEAL_MESH_SPHERE_RADIUS`)
- lighting for capture: IBL from `san_giuseppe_bridge_2k.hdr`, environment background enabled, direct light disabled, shadow map disabled
- environment orientation parity: apply a Y rotation offset of `-90` degrees in the Three.js viewer (`scene.environmentRotation.y`) to match MaterialXView lighting orientation
- color/output: no tone mapping, sRGB output encoding
- visible background comes from the active environment HDR (`san_giuseppe_bridge_2k.hdr`)
- fixed resolution of `512x512`

These values are intentionally aligned with `MaterialXView` defaults and its scene normalization behavior in `source/MaterialXView/Viewer.cpp`.
The Blender renderers follow the same scene contract through background Python scripts. `blender-new` uses the in-repo importer built on Blender's bundled `MaterialX` module, `blender-nodes` uses the same importer but requires the patched Blender custom MaterialX nodes, and `blender-io-mtlx` loads the vendored `third_party/io_blender_mtlx` add-on programmatically without requiring a manual Blender add-on install.

## Viewer

Run the MaterialX Fidelity Viewer:

```bash
pnpm viewer
```

The viewer scans MaterialX materials and looks for images for the built-in renderer list (`materialxview`, `blender-new`, `blender-nodes`, `blender-io-mtlx`, `materialxjs`, `threejs-current`, `threejs-new`).

The page groups materials by purpose/type (`showcase`, `nodes`, `open_pbr_surface`, `gltf_pbr`, `standard_surface`) and displays each renderer image (`<renderer>.png`) side by side. Missing images render as a placeholder tile.

Optional viewer environment variables:

- `VIEWER_RENDERERS` optional comma-separated renderer allowlist (for example: `materialxview,threejs-current,threejs-new`). If unset, the viewer shows all built-in renderers.

## License

MIT. See `LICENSE`.
