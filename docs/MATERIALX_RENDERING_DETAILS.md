# MaterialX Rendering Details

This document describes what the desktop viewer (`MaterialXView`) actually does, so you can replicate it in Three.js as closely as possible.

## 1) Default asset setup used by `MaterialXView`

From `source/MaterialXView/Main.cpp`:

- Default material: `resources/Materials/Examples/StandardSurface/standard_surface_default.mtlx`
- Default mesh: `resources/Geometry/shaderball.glb`
- Default environment radiance: `resources/Lights/san_giuseppe_bridge_split.hdr`
- Default camera position: `(0,0,5)`
- Default camera target: `(0,0,0)`
- Default camera view angle: `45`
- Default screen color: `0.3,0.3,0.32` (sRGB UI/background color)
- Default env sample count: `16`
- Default direct light: enabled
- Default shadow map: enabled

## 2) IBL / lighting model

## Environment maps (IBL)

Viewer lighting is image-based and uses:

- Radiance map: loaded from `--envRad` (`.hdr`, lat-long).
- Irradiance map:
  - first tries `resources/Lights/irradiance/<same_basename>.hdr`
  - if missing, generates diffuse irradiance from the radiance map using spherical harmonics.
- Specular method:
  - default `FIS` (filtered importance sampling),
  - optional prefiltered environment map mode (`--envMethod 1`).

Default environment files present in repo include:

- `resources/Lights/san_giuseppe_bridge_split.hdr`
- `resources/Lights/goegap_split.hdr`
- `resources/Lights/table_mountain_split.hdr`

and matching diffuse maps in `resources/Lights/irradiance/`.

## Direct lights

If the environment has a companion `.mtlx` with the same basename, viewer imports it and registers light shaders from it.

For default `san_giuseppe_bridge_split.hdr`, companion file is:

- `resources/Lights/san_giuseppe_bridge_split.mtlx`

which defines a `directional_light`:

- direction: `0.514434, -0.479014, -0.711269`
- color: `1, 0.894474, 0.567234`
- intensity: `2.52776`

Direct lighting can be toggled independently (`--enableDirectLight`), and environment intensity can be scaled (`--envLightIntensity`).

## Environment rotation

- `--lightRotation` rotates lighting around +Y.
- This rotation is applied to both:
  - light transform for shading,
  - directional light direction (for shadows),
  - environment background shader rotation (when background drawing enabled).

## 3) Shadowing and AO

- Shadow map resolution: `2048`
- Uses first directional light category (`directional_light`) for shadow map.
- Shadow mapping is on by default (`hwShadowMap = true`).
- AO is optional (`hwAmbientOcclusion` option), and if enabled viewer looks for mesh-sidecar AO textures such as:
  - `<mesh_basename>_ao.png`
  - for UDIM: `<mesh_basename>_ao_<udim>.png`
- Default AO gain is `0.6`.

## 4) Color management and output transform

## Working/render color space

Viewer sets generator target override to:

- `lin_rec709`

For color management:

- if built with OCIO, it tries builtin config `ocio://studio-config-latest`,
- otherwise falls back to MaterialX `DefaultColorManagementSystem`.

This is primarily about transforming input colors/textures into shader working space.

## Display/output encoding (important for Three.js parity)

### OpenGL backend

- Rendering enables `GL_FRAMEBUFFER_SRGB` during scene draw.
- Captured image is read back as `GL_RGB` + `GL_UNSIGNED_BYTE` (8-bit), then saved.

### Metal backend

- Main render target is linear float (`RGBA16F`).
- Viewer explicitly runs a linear-to-sRGB pass with standard sRGB transfer:
  - linear segment below `0.0031308`,
  - power function `pow(x, 1/2.4)` above that.
- Captures are converted to 8-bit (`BGRA8Unorm`) before save.

## Tone mapping?

No filmic/ACES/reinhard tone mapping path is applied in the viewer render pipeline code. The output path is linear shading + sRGB encoding (plus whatever dynamic range clipping happens during 8-bit capture for PNG/JPG/BMP/TGA).

## 5) Geometry used to showcase materials

Default showcase object is:

- `resources/Geometry/shaderball.glb`

Other available primitives include `sphere.obj`, `teapot.obj`, `plane.obj`, `cube.obj`.

For environment background rendering, viewer separately uses:

- `resources/Geometry/sphere.obj`

as a sky sphere.

## Can this object be replicated in glTF/GLB?

Yes. It already is a glTF binary (`shaderball.glb`). For Three.js parity:

- load `shaderball.glb` directly,
- preserve tangents/normals/UVs as authored,
- use double-sided rendering if matching viewer defaults,
- keep camera framing similar to viewer defaults.

## 6) Three.js replication checklist (closest practical match)

- Use `shaderball.glb` as the preview mesh.
- Use `san_giuseppe_bridge_split.hdr` as environment radiance.
- Use precomputed irradiance map from `resources/Lights/irradiance/san_giuseppe_bridge_split.hdr` for diffuse IBL contribution (if your MaterialX shader path expects separate irradiance input).
- Add one directional light with values from `san_giuseppe_bridge_split.mtlx`.
- Apply shared Y rotation to env and directional light.
- Use the environment HDR as both `scene.environment` and `scene.background` when matching refractive/transmissive background behavior.
- Use no tone mapping (`NoToneMapping`) if matching viewer behavior.
- Use sRGB output conversion only (renderer output color space set to sRGB).
- Keep camera near/far and FOV close to viewer defaults (near `0.05`, far large enough, FOV around `45`).

## Suggested Three.js output settings for parity

```js
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

If you use PMREM in Three.js for specular IBL, expect some differences versus MaterialX viewer `FIS` mode. For closer approximation, use consistent environment map resolution and sampling strategy, then visually calibrate with a known material (for example `standard_surface_greysphere_calibration.mtlx`).
