# Custom Blender MaterialX Noise Nodes

This project can use a patched sibling Blender checkout at `../blender` to render MaterialX procedural noise nodes with custom Cycles shader nodes. The goal is to avoid Blender's built-in noise implementations for MaterialX nodes whose reference behavior comes from MaterialX's standard library.

## Node IDs

The patched Blender build registers these shader node types:

- `ShaderNodeMxNoise2D`
- `ShaderNodeMxNoise3D`
- `ShaderNodeMxFractal2D`
- `ShaderNodeMxFractal3D`
- `ShaderNodeMxCellNoise2D`
- `ShaderNodeMxCellNoise3D`
- `ShaderNodeMxWorleyNoise2D`
- `ShaderNodeMxWorleyNoise3D`
- `ShaderNodeMxUnifiedNoise2D`
- `ShaderNodeMxUnifiedNoise3D`

The importer creates these nodes conditionally. If the active Blender executable does not have them, it falls back to Blender's native `ShaderNodeTexNoise`, `ShaderNodeTexWhiteNoise`, and `ShaderNodeTexVoronoi` nodes and emits a warning.

## Blender Code Locations

The Blender-side node declarations and registration live in the sibling Blender checkout:

- `../blender/source/blender/nodes/shader/nodes/node_shader_tex_mx_noise.cc`
- `../blender/source/blender/nodes/shader/node_shader_register.cc`
- `../blender/source/blender/nodes/shader/node_shader_register.hh`
- `../blender/source/blender/nodes/shader/CMakeLists.txt`
- `../blender/source/blender/blenkernel/BKE_node_legacy_types.hh`

Cycles translation and evaluation live here:

- `../blender/intern/cycles/blender/shader.cpp`
- `../blender/intern/cycles/scene/shader_nodes.h`
- `../blender/intern/cycles/scene/shader_nodes.cpp`
- `../blender/intern/cycles/kernel/svm/mx_noise.h`
- `../blender/intern/cycles/kernel/svm/node_types.h`
- `../blender/intern/cycles/kernel/svm/node_types_template.h`
- `../blender/intern/cycles/kernel/svm/svm.h`

The shared noise math was ported from MaterialX's GenGlsl implementation:

- `../MAterialX/libraries/stdlib/genglsl/lib/mx_noise.glsl`
- `../MAterialX/libraries/stdlib/genglsl/mx_noise2d_float.glsl`
- `../MAterialX/libraries/stdlib/genglsl/mx_cellnoise2d_float.glsl`
- `../MAterialX/libraries/stdlib/genglsl/mx_worleynoise2d_float.glsl`

## Importer Location

The MaterialX importer support is in:

- `packages/renderer-blender/blender/materialx_importer/nodes/noise.py`

That file feature-detects each mx-prefixed node by attempting to create it in a temporary Blender node tree. When creation succeeds, MaterialX noise nodes are compiled to the custom nodes.

## Build Prerequisites

The expected local layout is:

```text
/Users/bhouston/Coding/OpenSource/
  blender/
  material-fidelity/
```

Install the basic Blender build tools if they are not already available:

```bash
brew install cmake git git-lfs ninja ccache
```

Use the Xcode version that matches the configured build tree. The known-good local setup uses:

- Xcode: `/Applications/Xcode-26.1.1.app`
- SDK: `/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk`
- build directory: `/Users/bhouston/Coding/OpenSource/build_darwin`

For a first-time Blender checkout, fetch submodules, Git LFS files, and precompiled Apple Silicon libraries:

```bash
cd /Users/bhouston/Coding/OpenSource/blender
make update
```

This should populate:

```text
/Users/bhouston/Coding/OpenSource/blender/lib/macos_arm64
```

If the build directory has not been configured for Ninja yet, configure it through Blender's make wrapper:

```bash
cd /Users/bhouston/Coding/OpenSource/blender
make ccache ninja
```

## Building Blender

From `../blender`, build and install the app bundle with the known-good local command:

```bash
SDK="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk"
DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer" \
SDKROOT="$SDK" \
ninja -C "/Users/bhouston/Coding/OpenSource/build_darwin" -j 8 install
```

The executable used by this repo should be:

```bash
/Users/bhouston/Coding/OpenSource/build_darwin/bin/Blender.app/Contents/MacOS/Blender
```

If CMake fails with missing precompiled libraries, rerun `make update`. If Ninja reports a stale or incompatible build directory after switching generators or Xcode versions, reconfigure with `make ccache ninja` or use a clean build directory.

## Material Fidelity Setup

From this repository, install/build the TypeScript workspace before running renders:

```bash
cd /Users/bhouston/Coding/OpenSource/material-fidelity
pnpm install
pnpm build
```

The renderer requires the usual sample and asset layout from this repo:

- MaterialX samples under `third_party/material-samples`
- shader ball model and HDR environment resolved by the CLI startup path
- Blender's bundled Python `MaterialX` module, which is checked during renderer prerequisite validation

If samples are missing, initialize submodules:

```bash
git submodule update --init --recursive
```

## Running `blender-nodes`

Use the `blender-nodes` renderer so the CLI requires the patched Blender executable and does not accidentally use an installed Blender app:

```bash
pnpm cli render --renderers blender-nodes --materials noise2d
```

If the patched Blender is not at the default local build path, set `BLENDER_NODES_EXECUTABLE`:

```bash
BLENDER_NODES_EXECUTABLE="/Users/bhouston/Coding/OpenSource/build_darwin/bin/Blender.app/Contents/MacOS/Blender" \
pnpm cli render --renderers blender-nodes --materials noise2d --concurrency 1
```

For broader smoke testing:

```bash
pnpm cli render --renderers blender-nodes \
  --materials "re:^(noise2d|noise3d|cellnoise2d|cellnoise3d|worleynoise2d|worleynoise3d|unifiednoise2d|unifiednoise3d)$" \
  --concurrency 1
```

## Quick Node Probe

To verify a built Blender contains the custom nodes:

```bash
BLENDER_EXECUTABLE="/Users/bhouston/Coding/OpenSource/build_darwin/bin/Blender.app/Contents/MacOS/Blender"
"$BLENDER_EXECUTABLE" --background --factory-startup --python-expr '
import bpy
mat = bpy.data.materials.new("mx_probe")
mat.use_nodes = True
nodes = mat.node_tree.nodes
ids = [
    "ShaderNodeMxNoise2D",
    "ShaderNodeMxNoise3D",
    "ShaderNodeMxFractal2D",
    "ShaderNodeMxFractal3D",
    "ShaderNodeMxCellNoise2D",
    "ShaderNodeMxCellNoise3D",
    "ShaderNodeMxWorleyNoise2D",
    "ShaderNodeMxWorleyNoise3D",
    "ShaderNodeMxUnifiedNoise2D",
    "ShaderNodeMxUnifiedNoise3D",
]
for node_id in ids:
    node = nodes.new(type=node_id)
    print(node_id, "inputs=", [s.name for s in node.inputs], "outputs=", [s.name for s in node.outputs])
'
```

## Current Caveats

- These nodes are custom to the local Blender checkout and are not available in stock Blender.
- The default path is Cycles SVM. The OSL path is intentionally not implemented for these custom nodes.
- The implementation is intended for MaterialX noise parity testing, not as a general Blender UI feature.
- Numeric smoke tests against `materialxview` still show nonzero RMS differences, so visual parity should be validated per sample before treating this as exact.
