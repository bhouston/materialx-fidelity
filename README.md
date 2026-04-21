# MaterialX Fidelity Testing

MaterialX Fidelity Testing is a TypeScript monorepo for generating and comparing renderer output for known MaterialX sample scenes.

The initial scaffold focuses on reference-image generation:

- discover MaterialX materials in a samples repository,
- load a renderer adapter from `adapters/*`,
- generate deterministic PNG reference images beside each `material.mtlx`.

## Repository Layout

- `packages/core` - adapter interfaces, adapter loading, and reference-generation orchestration.
- `packages/mtlx-fidelity-cli` - `mtlx-fidelity` command line tool.
- `adapters/materialxview` - adapter that wraps `materialxview` / `MaterialXView`.
- `adapters/threejs` - adapter that serves a Three.js capture viewer and renders via Playwright.

## Requirements

- Node.js 24+
- pnpm 10+
- `materialxview` (or `MaterialXView`) available on your `PATH`
- third-party root at `../` containing `MaterialX-Samples` and `threejs` repositories

Expected third-party layout:

- `../MaterialX-Samples/materials/**/material.mtlx`
- `../MaterialX-Samples/viewer/san_giuseppe_bridge_2k.hdr`
- `../MaterialX-Samples/viewer/ShaderBall.glb`
- `../threejs/build/three.module.js`
- `../threejs/examples/jsm/loaders/MaterialXLoader.js`

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

Generate adapter-specific reference images:

```bash
pnpm cli create-references --adapter materialxview
```

```bash
pnpm cli create-references --adapter threejs --third-party-root ../ --adapters-root ./adapters
```

This command writes `<adapter-name>.png` in each directory containing a `material.mtlx`.

Optional flags:

- `--third-party-root <path>` override default `../`
- `--adapters-root <path>` override default `./adapters`
- `--screen-width <number>` default `512`
- `--screen-height <number>` default `512`
- `--concurrency <number>` default `1`
- `--background-color <value>` default `0,0,0` (`r,g,b` where each value is in `[0,1]`)

## License

MIT. See `LICENSE`.
