import { DoubleSide } from 'three/webgpu';
import { float, color, mul, clamp, vec2, cos, sin } from 'three/tsl';

const mappedStandardSurfaceInputs = new Set([
  'base',
  'base_color',
  'roughness',
  'specular_roughness',
  'metalness',
  'specular',
  'specular_color',
  'specular_anisotropy',
  'specular_rotation',
  'transmission',
  'transmission_color',
  'transmission_depth',
  'thin_film_thickness',
  'thin_film_ior',
  'thin_film_IOR',
  'sheen',
  'sheen_color',
  'sheen_roughness',
  'coat',
  'coat_color',
  'coat_roughness',
  'coat_normal',
  'normal',
  'opacity',
  'ior',
  'specular_IOR',
  'emission',
  'emissionColor',
  'emission_color',
]);

const mappedGltfPbrInputs = new Set([
  'base_color',
  'occlusion',
  'roughness',
  'metallic',
  'normal',
  'transmission',
  'specular',
  'specular_color',
  'ior',
  'alpha',
  'alpha_mode',
  'alpha_cutoff',
  'iridescence',
  'iridescence_ior',
  'iridescence_thickness',
  'sheen_color',
  'sheen_roughness',
  'clearcoat',
  'clearcoat_roughness',
  'clearcoat_normal',
  'emissive',
  'emissive_strength',
  'attenuation_distance',
  'attenuation_color',
  'thickness',
  'dispersion',
  'anisotropy_strength',
  'anisotropy_rotation',
]);

const mappedOpenPbrInputs = new Set([
  'base_weight',
  'base_color',
  'specular_weight',
  'specular_color',
  'specular_roughness',
  'base_metalness',
  'specular_roughness_anisotropy',
  'specular_ior',
  'specular_ior_level',
  'coat_weight',
  'coat_color',
  'coat_roughness',
  'geometry_coat_normal',
  'fuzz_weight',
  'fuzz_color',
  'fuzz_roughness',
  'transmission_weight',
  'transmission_color',
  'transmission_depth',
  'transmission_dispersion_scale',
  'transmission_dispersion_abbe_number',
  'geometry_normal',
  'geometry_opacity',
  'geometry_thin_walled',
  'thin_film_weight',
  'thin_film_thickness',
  'thin_film_ior',
  'emission_color',
  'emission_luminance',
]);

function warnIgnoredInputs(inputs, mappedInputs, issueCollector, surfaceCategory, nodeName) {
  for (const inputName of Object.keys(inputs)) {
    if (mappedInputs.has(inputName) === false) {
      issueCollector.addIgnoredSurfaceInput(surfaceCategory, nodeName, inputName);
    }
  }
}

function hasNodeValue(value) {
  return value !== undefined && value !== null;
}

function setAnisotropy(material, strengthNode, rotationNode) {
  if (!hasNodeValue(strengthNode) && !hasNodeValue(rotationNode)) return;
  const strength = hasNodeValue(strengthNode) ? strengthNode : float(0);
  const rotation = hasNodeValue(rotationNode) ? rotationNode : float(0);
  material.anisotropyNode = vec2(cos(rotation), sin(rotation)).mul(strength);
  material.anisotropyRotationNode = rotation;
}

function setTransmissionFlags(material, transmissionNode, opacityNode) {
  if (hasNodeValue(opacityNode)) material.transparent = true;

  if (hasNodeValue(transmissionNode)) {
    material.side = DoubleSide;
    material.transparent = true;
  }
}

function toAttenuationDistance(distanceNode, hasAttenuationColorInput) {
  if (hasNodeValue(distanceNode)) return distanceNode;
  // When attenuation tint is authored without a distance, default to a
  // finite value so absorption tinting is visible.
  return hasAttenuationColorInput ? float(1) : undefined;
}

function applyStandardSurface(material, inputs, issueCollector, nodeName) {
  let colorNode = null;
  if (inputs.base && inputs.base_color) colorNode = mul(inputs.base, inputs.base_color);
  else if (inputs.base) colorNode = inputs.base;
  else if (inputs.base_color) colorNode = inputs.base_color;

  if (inputs.coat_color) {
    colorNode = colorNode ? mul(colorNode, inputs.coat_color) : colorNode;
  }

  const roughnessNode = inputs.specular_roughness ?? inputs.roughness;
  const opacityNode = inputs.opacity;
  const transmissionNode = inputs.transmission;
  const transmissionColorNode = inputs.transmission_color;

  let emissiveNode = inputs.emission;
  const emissionColorNode = inputs.emission_color ?? inputs.emissionColor;
  if (hasNodeValue(emissionColorNode)) {
    emissiveNode = emissiveNode ? mul(emissiveNode, emissionColorNode) : emissionColorNode;
  }

  const thinFilmThicknessNode = inputs.thin_film_thickness;
  const thinFilmIorNode = clamp(inputs.thin_film_ior || inputs.thin_film_IOR || float(1.5), float(1.0), float(2.333));

  material.colorNode = colorNode || color(0.8, 0.8, 0.8);
  material.opacityNode = opacityNode || float(1.0);
  material.roughnessNode = roughnessNode || float(0.2);
  material.metalnessNode = inputs.metalness || float(0);
  material.specularIntensityNode = inputs.specular || float(1.0);
  material.specularColorNode = inputs.specular_color || color(1, 1, 1);
  material.iorNode = inputs.specular_IOR || inputs.ior || float(1.5);

  setAnisotropy(material, inputs.specular_anisotropy, inputs.specular_rotation);

  material.transmissionNode = transmissionNode || float(0);
  material.transmissionColorNode = transmissionColorNode || color(1, 1, 1);
  material.thicknessNode = inputs.transmission_depth || float(0);
  material.iridescenceThicknessNode = thinFilmThicknessNode || float(0);
  material.iridescenceIORNode = thinFilmIorNode;
  if (hasNodeValue(thinFilmThicknessNode)) material.iridescenceNode = float(1);
  material.sheenNode = inputs.sheen || float(0);
  material.sheenColorNode = inputs.sheen_color || color(1, 1, 1);
  material.sheenRoughnessNode = inputs.sheen_roughness || float(0.3);
  material.clearcoatNode = inputs.coat || float(0);
  material.clearcoatRoughnessNode = inputs.coat_roughness || float(0.1);

  if (hasNodeValue(inputs.coat_normal)) material.clearcoatNormalNode = inputs.coat_normal;
  if (hasNodeValue(inputs.normal)) material.normalNode = inputs.normal;
  if (hasNodeValue(emissiveNode)) material.emissiveNode = emissiveNode;

  setTransmissionFlags(material, transmissionNode, opacityNode);
  warnIgnoredInputs(inputs, mappedStandardSurfaceInputs, issueCollector, 'standard_surface', nodeName);
}

function applyGltfPbrSurface(material, inputs, issueCollector, nodeName) {
  material.colorNode = inputs.base_color || color(1, 1, 1);
  if (hasNodeValue(inputs.occlusion)) material.aoNode = inputs.occlusion;
  material.roughnessNode = inputs.roughness || float(1);
  material.metalnessNode = inputs.metallic || float(1);
  material.specularIntensityNode = inputs.specular || float(1);
  material.specularColorNode = inputs.specular_color || color(1, 1, 1);
  material.iorNode = inputs.ior || float(1.5);
  material.opacityNode = inputs.alpha || float(1);
  material.transmissionNode = inputs.transmission || float(0);
  material.clearcoatNode = inputs.clearcoat || float(0);
  material.clearcoatRoughnessNode = inputs.clearcoat_roughness || float(0);
  material.sheenColorNode = inputs.sheen_color || color(0, 0, 0);
  material.sheenRoughnessNode = inputs.sheen_roughness || float(0);
  material.sheenNode = material.sheenColorNode;
  material.iridescenceNode = inputs.iridescence || float(0);
  material.iridescenceIORNode = inputs.iridescence_ior || float(1.3);
  material.iridescenceThicknessNode = inputs.iridescence_thickness || float(100);
  const hasAttenuationColorInput = hasNodeValue(inputs.attenuation_color);
  material.attenuationDistanceNode = toAttenuationDistance(inputs.attenuation_distance, hasAttenuationColorInput);
  material.attenuationColorNode = inputs.attenuation_color;
  if (hasNodeValue(inputs.thickness)) {
    material.thicknessNode = inputs.thickness;
  } else if (hasNodeValue(inputs.transmission)) {
    // Keep transmissive glTF materials volumetric even when thickness is omitted.
    material.thickness = 1;
  }
  material.dispersionNode = inputs.dispersion || float(0);

  const anisotropyStrength = inputs.anisotropy_strength;
  const anisotropyRotation = inputs.anisotropy_rotation;
  setAnisotropy(material, anisotropyStrength, anisotropyRotation);

  if (hasNodeValue(inputs.normal)) material.normalNode = inputs.normal;
  if (hasNodeValue(inputs.clearcoat_normal)) material.clearcoatNormalNode = inputs.clearcoat_normal;
  if (hasNodeValue(inputs.emissive) && hasNodeValue(inputs.emissive_strength))
    material.emissiveNode = mul(inputs.emissive, inputs.emissive_strength);
  else if (hasNodeValue(inputs.emissive)) material.emissiveNode = inputs.emissive;

  setTransmissionFlags(material, inputs.transmission, inputs.alpha);
  warnIgnoredInputs(inputs, mappedGltfPbrInputs, issueCollector, 'gltf_pbr', nodeName);
}

function applyOpenPbrSurface(material, inputs, issueCollector, nodeName) {
  const baseWeight = inputs.base_weight || float(1);
  const baseColor = inputs.base_color || color(0.8, 0.8, 0.8);
  material.colorNode = mul(baseWeight, baseColor);

  material.metalnessNode = inputs.base_metalness || float(0);
  material.roughnessNode = inputs.specular_roughness || float(0.3);
  material.specularIntensityNode = inputs.specular_weight || float(1);
  material.specularColorNode = inputs.specular_color || color(1, 1, 1);
  material.iorNode = inputs.specular_ior || inputs.specular_ior_level || float(1.5);
  setAnisotropy(material, inputs.specular_roughness_anisotropy, float(0));

  material.clearcoatNode = inputs.coat_weight || float(0);
  material.clearcoatRoughnessNode = inputs.coat_roughness || float(0);
  if (hasNodeValue(inputs.geometry_coat_normal)) material.clearcoatNormalNode = inputs.geometry_coat_normal;

  const fuzzWeight = inputs.fuzz_weight || float(0);
  const fuzzColor = inputs.fuzz_color || color(1, 1, 1);
  material.sheenNode = mul(fuzzWeight, fuzzColor);
  material.sheenRoughnessNode = inputs.fuzz_roughness || float(0.5);

  material.transmissionNode = inputs.transmission_weight || float(0);
  material.attenuationColorNode = inputs.transmission_color || color(1, 1, 1);
  const transmissionDepthNode = inputs.transmission_depth;
  if (hasNodeValue(transmissionDepthNode)) {
    material.thicknessNode = hasNodeValue(inputs.geometry_thin_walled)
      ? inputs.geometry_thin_walled.select(float(0), transmissionDepthNode)
      : transmissionDepthNode;
    material.attenuationDistanceNode = transmissionDepthNode;
  } else if (hasNodeValue(inputs.transmission_weight)) {
    // Keep transmissive OpenPBR materials volumetric even when depth is omitted.
    material.thickness = 1;
  }

  const transmissionDispersionAbbe = inputs.transmission_dispersion_abbe_number || float(20);
  if (hasNodeValue(inputs.transmission_dispersion_scale)) {
    material.dispersionNode = inputs.transmission_dispersion_scale.mul(float(20)).div(transmissionDispersionAbbe);
  }

  material.opacityNode = inputs.geometry_opacity || float(1);
  if (hasNodeValue(inputs.geometry_normal)) material.normalNode = inputs.geometry_normal;

  material.iridescenceNode = inputs.thin_film_weight || float(0);
  material.iridescenceThicknessNode = (inputs.thin_film_thickness || float(0.5)).mul(float(1000));
  material.iridescenceIORNode = inputs.thin_film_ior || float(1.4);

  const emissionColor = inputs.emission_color;
  const emissionLuminance = inputs.emission_luminance;
  if (hasNodeValue(emissionColor) && hasNodeValue(emissionLuminance)) {
    material.emissiveNode = mul(emissionColor, emissionLuminance);
  } else if (hasNodeValue(emissionColor)) {
    material.emissiveNode = emissionColor;
  }

  if (hasNodeValue(inputs.geometry_opacity)) material.transparent = true;
  if (hasNodeValue(inputs.transmission_weight)) material.transparent = true;

  setTransmissionFlags(material, inputs.transmission_weight, inputs.geometry_opacity);
  warnIgnoredInputs(inputs, mappedOpenPbrInputs, issueCollector, 'open_pbr_surface', nodeName);
}

const MaterialXSurfaceMappings = {
  standard_surface: applyStandardSurface,
  gltf_pbr: applyGltfPbrSurface,
  open_pbr_surface: applyOpenPbrSurface,
};

export { MaterialXSurfaceMappings, mappedStandardSurfaceInputs, mappedGltfPbrInputs, mappedOpenPbrInputs };
