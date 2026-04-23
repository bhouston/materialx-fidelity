# renderer-materialxjs

Capture renderer for MaterialX Fidelity using the JavaScript MaterialX toolchain (`@materialx-js/materialx` + `@materialx-js/materialx-three`) with a local Vite page and Playwright screenshots.

## What This Renderer Does

- starts a local capture web page from `viewer/`
- loads `material.mtlx`, `ShaderBall.glb`, and `san_giuseppe_bridge_2k.hdr`
- compiles MaterialX with the JavaScript MaterialX compiler
- renders one deterministic frame and writes `<material-dir>/materialxjs.png`
- relies on `@materialx-fidelity/core` to convert PNG to `materialxjs.webp`

## Local Debug

From repo root:

```bash
pnpm --filter @materialx-fidelity/renderer-materialxjs dev
```

Then run normal reference generation:

```bash
pnpm cli create-references --renderers materialxjs --materials open_pbr
```

## Upstream Source Mapping

This renderer is based on the MaterialX JavaScript project and capture flow concepts from:

- `../MaterialX/javascript`
- `third_party/material-viewer/apps/viewer/src/routes/embed.tsx`
- `third_party/material-viewer/apps/viewer/src/hooks/useMaterialXCompile.ts`
- `third_party/material-viewer/apps/viewer/src/lib/browser-texture-resolver.ts`

## Sync From Upstream

When upstream MaterialX JavaScript changes, use this checklist:

1. update your local `../MaterialX` checkout (`git pull`) and refresh `third_party/material-viewer` as needed
2. compare upstream viewer/compiler texture-loading behavior against `viewer/src/main.tsx`
3. copy/adapt any required logic changes into this package (keep capture-only behavior)
4. run validation:
   - `pnpm build`
   - `pnpm test`
5. run a focused render diff:
   - `pnpm cli create-references --renderers materialxjs --materials open_pbr`
6. visually compare `materialxjs.webp` against existing renderer outputs in the fidelity viewer
