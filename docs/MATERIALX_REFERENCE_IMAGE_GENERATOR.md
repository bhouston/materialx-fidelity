# MaterialX Reference Image Generator

## Short answer

Yes. The repository already includes a CLI-capable renderer path via `MaterialXView`, and it can save a still image non-interactively using `--captureFilename`.

This is already used in CI in `.github/workflows/main.yml`, so it is a supported workflow in this repo.

## Existing tool you can use today

The executable is `MaterialXView` (built from `source/MaterialXView`).

Core flags for thumbnail generation:

- `--material` input `.mtlx`
- `--mesh` showcase geometry (`resources/Geometry/shaderball.glb`, `sphere.obj`, etc.)
- `--envRad` HDRI environment (`resources/Lights/san_giuseppe_bridge_split.hdr`, etc.)
- `--screenWidth` / `--screenHeight` output resolution (this repository's `mtlx-fidelity` wrapper fixes output at `1024x1024`)
- `--captureFilename` output image path
- Optional quality/look controls: `--envSampleCount`, `--lightRotation`, `--envLightIntensity`, `--cameraZoom`, `--shadowMap`, `--drawEnvironment`

For this repository's reference renderer parity profile, `--drawEnvironment` is enabled so the HDR is used for both lighting and visible background.

## Build and run

From repository root:

```bash
cmake -S . -B build -DMATERIALX_BUILD_VIEWER=ON
cmake --build build --target install -j
```

Then render one image:

```bash
./build/installed/bin/MaterialXView \
  --material resources/Materials/Examples/StandardSurface/standard_surface_carpaint.mtlx \
  --mesh resources/Geometry/shaderball.glb \
  --envRad resources/Lights/san_giuseppe_bridge_split.hdr \
  --screenWidth 1024 \
  --screenHeight 1024 \
  --cameraZoom 1.0 \
  --envSampleCount 16 \
  --captureFilename output/carpaint.png
```

## Bulk thumbnail generation

### Option A: shell loop around `MaterialXView` (fastest to adopt)

```bash
mkdir -p output
for mtlx in resources/Materials/Examples/StandardSurface/*.mtlx; do
  base="$(basename "$mtlx" .mtlx)"
  ./build/installed/bin/MaterialXView \
    --material "$mtlx" \
    --mesh resources/Geometry/shaderball.glb \
    --envRad resources/Lights/san_giuseppe_bridge_split.hdr \
    --screenWidth 1024 \
    --screenHeight 1024 \
    --envSampleCount 16 \
    --captureFilename "output/${base}.png"
done
```

### Option B: Python wrapper for retry/logging/manifest support

Use `subprocess.run` with:

- deterministic CLI parameters,
- per-material timeout,
- retry on transient failures,
- CSV/JSON output manifest (`material`, `image`, `status`, `stderr`).

## Important operational notes

- Output directories must exist before rendering (`mkdir -p output`).
- The viewer resolves libraries and resources from search paths. If running outside repo root, pass `--path` and (if needed) `--library`.
- Linux headless usage generally needs an X server (CI uses Xvfb).
- You can disable direct shadows (`--shadowMap false`) for faster stable thumbnails.
- CI examples use a sphere mesh for fast verification, but default viewer mesh is shaderball.

## Is a new dedicated thumbnail tool still worth building?

If you only need batch stills, `MaterialXView --captureFilename` is sufficient.

A new dedicated tool is worth it if you need:

- strict deterministic render profiles (JSON preset),
- parallel worker orchestration,
- structured machine-readable logs and error codes,
- resumable large jobs,
- richer output metadata (render settings hash, git SHA, render time).

If you decide to build one, the most direct path is a small C++ executable that reuses viewer/render modules and exposes a batch-oriented CLI (list/glob input + preset file + output directory).
