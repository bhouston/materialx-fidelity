# Three.js Translator Registry

`renderer-threejs` uses a slim generated MaterialX node registry to validate compile/surface handler coverage at startup.

## Regenerate

From repo root:

```bash
pnpm --filter @material-fidelity/renderer-threejs generate:node-registry
```

The generator is in `packages/renderer-threejs/scripts/generate-node-registry.mjs`.

## MaterialX Source

By default the script reads nodedefs from `../MaterialX/libraries` relative to the repository root parent directory.

Override with:

```bash
MATERIALX_LIBRARIES_DIR=/absolute/path/to/MaterialX/libraries pnpm --filter @material-fidelity/renderer-threejs generate:node-registry
```

## Generated Artifact

The script writes:

- `packages/renderer-threejs/viewer/src/vendor/materialx/generated/MaterialXNodeRegistry.generated.js`

This file is consumed by startup validation in the Three.js MaterialX translator.
