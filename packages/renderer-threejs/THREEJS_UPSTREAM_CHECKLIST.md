# Three.js Upstream Contribution Guide (MaterialX Loader)

This note defines the expected contribution quality bar when preparing `renderer-threejs` changes for upstream Three.js review.

## Scope and Behavior Contract

- Target runtime is WebGPU + TSL through `MaterialXLoader`.
- Translator architecture is layered: parse (`parse/`) -> compile (`compile/`) -> surface mapping (`MaterialXSurfaceMappings.js`) -> runtime loader integration.
- Preserve current behavior parity with `third_party/material-viewer` for supported nodes/surfaces unless a deliberate divergence is documented in PR notes.
- Unsupported or partially supported features must emit structured issues through `MaterialXIssueCollector` rather than silently failing.

## Loader API Contract

Public loader import path:

- `@material-fidelity/renderer-threejs/loader`

Expected API behavior:

- `load(url, onLoad, onProgress?, onError?)`: callback-based loading compatible with Three.js loader conventions.
- `loadAsync(url, onProgress?)`: Promise wrapper over `load` with equivalent parse/error behavior.
- `setPath(path)`: inherited `Loader` path prefix behavior for relative MaterialX and texture URIs.
- `setIssuePolicy(policy)`: strictness profile (`warn`, `error-core`, `error-all`).
- `setUnsupportedPolicy('error')`: legacy alias that maps to `error-core`.
- `setMaterialName(name)`: optional surfacematerial selection.

## Supported Surface Families

Current surface mapping registry in `MaterialXSurfaceRegistry.js` includes:

- `standard_surface`
- `gltf_pbr`
- `open_pbr_surface`

Any additions must include:

- mapper registration,
- mapped-input metadata updates,
- strictness behavior tests (ignored/missing/invalid inputs),
- parity checks against existing materials.

## Strictness Policy

`MaterialXLoader` supports loader-level issue policy via `setIssuePolicy()`:

- `warn`: collect and warn, never throw from issue collector.
- `error-core`: fail on unsupported nodes, missing references, invalid values.
- `error-all`: fail on any collected issue, including ignored surface inputs and missing materials.

Backward-compat: `setUnsupportedPolicy('error')` aliases to `error-core`.

## Registry Regeneration and Drift Control

Generated category artifact:

- `viewer/src/vendor/materialx/generated/MaterialXNodeRegistry.generated.js`

Commands (from repo root):

```bash
pnpm --filter @material-fidelity/renderer-threejs generate:node-registry
pnpm --filter @material-fidelity/renderer-threejs validate:node-registry
```

Use `MATERIALX_LIBRARIES_DIR` to override source libraries path when needed.

Default source path expectation (when override is unset):

- `../MaterialX/libraries` relative to repository root.

Contributors without that checkout should always set `MATERIALX_LIBRARIES_DIR`.

## Runtime and Memory Lifecycle Expectations

- Archive-backed `.mtlx.zip` loads must revoke object URLs via resolver disposal.
- Scene/runtime capture path must dispose renderer + scene resources after each render.
- Translator texture dedupe cache remains unbounded by design for parity with legacy behavior.
- Missing references should report through issue collector (not crash via unresolved node dereference).

## Reviewer Test Matrix (Minimal)

For every upstream PR touching loader/translator behavior, include at least:

1. Loader API smoke:
   - callback `load` succeeds/fails as expected
   - Promise `loadAsync` resolves/rejects as expected
2. Strictness integration:
   - unsupported node and missing reference behavior under `warn` and `error-core`
   - ignored surface input behavior under `warn`, `error-core`, `error-all`
   - missing material behavior under `warn` and `error-all`
3. Lifecycle:
   - archive resolver `dispose()` revokes object URLs
4. Registry:
   - compile/surface category coverage validation remains in sync with generated categories

## Upstream PR Validation Checklist

Before opening/updating an upstream PR:

1. Run unit tests and ensure translator tests execute in default test discovery.
   - `pnpm test`
2. Run registry deterministic check.
   - `pnpm --filter @material-fidelity/renderer-threejs validate:node-registry`
3. Confirm no new lint/type errors.
   - `pnpm lint`
   - `pnpm tsc`
4. Run local fidelity parity pass (outside upstream repo) against your 300+ material suite and verify no unexpected regressions.
5. Document any intentional behavior differences from `material-viewer` in the PR description.

## Reviewer-Facing PR Notes Template

- **What changed:** concise description of translator/runtime slice touched.
- **Why:** maintenance, hardening, or correctness motivation.
- **Risk:** expected compatibility impact (if any).
- **Validation:** tests, registry validation, and fidelity parity evidence.
