# MaterialX Fidelity Testing

MaterialX Fidelity Testing is a TypeScript monorepo for generating and comparing renderer output for known MaterialX sample scenes.

The initial scaffold focuses on reference-image generation:

- discover MaterialX materials in a samples repository,
- run built-in renderers from the CLI,
- generate deterministic WebP reference images beside each `material.mtlx`.

## Repository Layout

- `packages/core` - renderer interfaces and reference-generation orchestration.
- `packages/cli` - `mtlx-fidelity` command line tool.
- `packages/viewer` - TanStack Start website for browsing fidelity reference images.
- `packages/renderer-materialxview` - renderer package `@materialx-fidelity/renderer-materialxview` wrapping `materialxview` / `MaterialXView`.
- `packages/renderer-threejs` - renderer package `@materialx-fidelity/renderer-threejs` serving a Three.js capture viewer and rendering via Playwright.

## Requirements

- Node.js 24+
- pnpm 10+
- `materialxview` (or `MaterialXView`) available on your `PATH`
- `third_party/materialx-samples` initialized as a git submodule

Expected third-party layout:

- `third_party/materialx-samples/materials/**/material.mtlx`
- `third_party/materialx-samples/viewer/san_giuseppe_bridge_2k.hdr`
- `third_party/materialx-samples/viewer/ShaderBall.glb`

### Initialize Submodules

Fresh clone:

```bash
git clone --recurse-submodules <repo-url>
```

Existing clone:

```bash
git submodule update --init --recursive
```

This repo intentionally does not include a `three.js` submodule. The Three.js renderer uses the npm `three` package plus vendored MaterialX loader files under `packages/renderer-threejs/viewer/src/vendor`.

## Install

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

Generate renderer-specific reference images:

```bash
pnpm cli create-references --renderers materialxview
```

```bash
pnpm cli create-references --renderers threejs
```

This command writes `<renderer-name>.webp` in each directory containing a `material.mtlx`.
If `--renderers` is omitted, all built-in renderers are used.

Currently supported renderers:

- `materialxview` (`@materialx-fidelity/renderer-materialxview`)
- `threejs` (`@materialx-fidelity/renderer-threejs`)

Optional flags:

- `--renderers <name[,name...]>` optional renderer filter; supports repeated flags and comma-separated values
- `--materials <selector[,selector...]>` optional material filter; supports repeated flags, comma-separated values, substring matches, and regex selectors (`re:...` or `/.../flags`)
- `--concurrency <number>` default `1`

All renderers render with a fixed black background (`0,0,0`) at a fixed resolution of `1024x1024`.  Fully black renders are treated as failures and deleted.

## Renderer Setup

To keep reference renders visually comparable between `materialxview` and `threejs`, both renderers should follow this framing setup:

- camera: perspective, FOV `45`, near `0.05`, eye `(0,0,5)`, look target `(0,0,0)`
- model normalization: center the loaded `ShaderBall.glb` at the origin, then scale it so the bounding-box sphere radius is `2.0` (matching `MaterialXView`'s `IDEAL_MESH_SPHERE_RADIUS`)
- lighting for capture: IBL from `san_giuseppe_bridge_2k.hdr`, environment background disabled, direct light disabled, shadow map disabled
- environment orientation parity: apply a Y rotation offset of `-90` degrees in the Three.js viewer (`scene.environmentRotation.y`) to match MaterialXView lighting orientation
- color/output: no tone mapping, sRGB output encoding

These values are intentionally aligned with `MaterialXView` defaults and its scene normalization behavior in `source/MaterialXView/Viewer.cpp`.

## Viewer

Run the MaterialX fidelity reference viewer:

```bash
pnpm viewer
```

The viewer scans MaterialX materials and looks for images for the built-in renderer list (`materialxview`, `threejs`).

The page groups materials by type (`open_pbr_surface`, `gltf_pbr`, `standard_surface`) and displays each renderer image (`<renderer>.webp`) side by side. Missing images render as a placeholder tile.

## License

MIT. See `LICENSE`.
