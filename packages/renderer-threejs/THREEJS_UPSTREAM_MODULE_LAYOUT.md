# Proposed Three.js Module Layout

This note maps current `renderer-threejs` implementation files to the expected upstream Three.js landing layout.

## Current-to-Upstream Mapping

- `viewer/src/vendor/MaterialXLoader.js`
  - candidate upstream: `examples/jsm/loaders/MaterialXLoader.js`
  - role: public loader API (`load`, `loadAsync`, issue policy + cache policy options)

- `viewer/src/vendor/materialx/MaterialXDocument.js`
  - candidate upstream: `examples/jsm/loaders/materialx/MaterialXDocument.js`
  - role: parse + node compilation orchestration and material construction

- `viewer/src/vendor/materialx/parse/*`
  - candidate upstream: `examples/jsm/loaders/materialx/parse/*`
  - role: XML traversal and node-tree indexing

- `viewer/src/vendor/materialx/compile/*`
  - candidate upstream: `examples/jsm/loaders/materialx/compile/*`
  - role: category handler registry and compile dispatch

- `viewer/src/vendor/materialx/MaterialXSurfaceMappings.js`
- `viewer/src/vendor/materialx/MaterialXSurfaceRegistry.js`
  - candidate upstream: `examples/jsm/loaders/materialx/mapping/*`
  - role: surface-family slot mapping and mapped-input metadata

- `viewer/src/vendor/materialx/MaterialXWarnings.js`
  - candidate upstream: `examples/jsm/loaders/materialx/MaterialXWarnings.js`
  - role: issue collection/reporting and strictness policies

- `viewer/src/vendor/materialx/MaterialXArchive.js`
  - candidate upstream: `examples/jsm/loaders/materialx/MaterialXArchive.js`
  - role: `.mtlx.zip` archive extraction and URL lifecycle

- `viewer/src/vendor/materialx/generated/MaterialXNodeRegistry.generated.js`
  - candidate upstream: build-time artifact (not hand-edited runtime source)
  - role: category coverage validation against translator registries

## Non-Upstream Harness Files

These files are fidelity-runner specific and should not be upstreamed as loader runtime:

- `src/index.ts` (Playwright + Vite capture harness)
- `viewer/src/main.tsx` (fidelity viewer runtime glue)

## Packaging Notes

- Public loader-facing exports should remain available via `@material-fidelity/renderer-threejs/loader`.
- Fidelity harness exports should stay separate so loader consumers do not inherit capture/runtime dependencies.
