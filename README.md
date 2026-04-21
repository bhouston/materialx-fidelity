# MaterialX Fidelity Testing

MaterialX Fidelity Testing is a TypeScript monorepo for generating and comparing renderer output for known MaterialX sample scenes.

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

Generatereference images:

```bash
# all renderers, all materials
pnpm cli create-references 
```

```bash
# only generate three.js renders of open_pbr materials
pnpm cli create-references --renderers threejs --materials open_pbr
```

This command writes `<renderer-name>.webp` in each directory containing a `material.mtlx`.

Currently supported renderers:

- `materialxview` (`@materialx-fidelity/renderer-materialxview`)
- `threejs` (`@materialx-fidelity/renderer-threejs`)

Optional flags:

- `--renderers <name[,name...]>` optional renderer filter; supports repeated flags and comma-separated values
- `--materials <selector[,selector...]>` optional material filter; supports repeated flags, comma-separated values, substring matches, and regex selectors (`re:...` or `/.../flags`)
- `--concurrency <number>` default `1`

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

The viewer scans MaterialX materials and looks for images for the built-in renderer list (`materialxview`, `threejs`).

The page groups materials by type (`open_pbr_surface`, `gltf_pbr`, `standard_surface`) and displays each renderer image (`<renderer>.webp`) side by side. Missing images render as a placeholder tile.

## License

MIT. See `LICENSE`.
