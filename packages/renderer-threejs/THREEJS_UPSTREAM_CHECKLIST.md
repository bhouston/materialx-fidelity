# Three.js Upstream Contribution Guide (MaterialX Loader)

This note defines the expected contribution quality bar when preparing `renderer-threejs` changes for upstream Three.js review.

## Scope and Behavior Contract

- Target runtime is WebGPU + TSL through `MaterialXLoader`.
- Translator architecture is layered: parse (`parse/`) -> compile (`compile/`) -> surface mapping (`MaterialXSurfaceMappings.js`) -> runtime loader integration.
- Preserve current behavior parity with `third_party/material-viewer` for supported nodes/surfaces unless a deliberate divergence is documented in PR notes.
- Unsupported or partially supported features must emit structured issues through `MaterialXIssueCollector` rather than silently failing.

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
