import {
  Texture,
  RepeatWrapping,
  ImageLoader,
  ImageBitmapLoader,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
} from 'three/webgpu';

import {
  abs,
  add,
  clamp,
  cos,
  div,
  dot,
  float,
  floor,
  fract,
  int,
  max,
  mix,
  mul,
  normalMap,
  pow,
  sin,
  step,
  sub,
  vec2,
  vec3,
  vec4,
  color,
  texture,
  positionLocal,
  positionWorld,
  uv,
  vertexColor,
  normalLocal,
  normalWorld,
  tangentLocal,
  tangentWorld,
  mat3,
  mat4,
  element,
  mx_transform_uv,
  mx_srgb_texture_to_lin_rec709,
} from 'three/tsl';

import { MaterialXSurfaceMappings } from './MaterialXSurfaceMappings.js';
import { MtlXLibrary } from './MaterialXNodeLibrary.js';

const colorSpaceLib = {
  mx_srgb_texture_to_lin_rec709,
};

const IDENTITY_MAT3_VALUES = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_MAT4_VALUES = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MATRIX_PIVOT_EPSILON = 1e-8;
const HEXTILE_SQRT3_2 = Math.sqrt(3) * 2;
const HEXTILE_EPSILON = 1e-6;
const HEXTILE_PI_OVER_180 = Math.PI / 180;

function toRadians(degrees) {
  return mul(degrees, HEXTILE_PI_OVER_180);
}

function mxHextileHash(point) {
  const x = element(point, 0);
  const y = element(point, 1);
  const p3Base = vec3(x, y, x);
  const p3Scaled = mul(p3Base, vec3(0.1031, 0.103, 0.0973));
  const p3Fract = fract(p3Scaled);
  const p3YZX = vec3(element(p3Fract, 1), element(p3Fract, 2), element(p3Fract, 0));
  const p3Offset = add(p3YZX, 33.33);
  const p3 = add(p3Fract, dot(p3Fract, p3Offset));
  const lhs = add(vec2(element(p3, 0), element(p3, 0)), vec2(element(p3, 1), element(p3, 2)));
  const rhs = vec2(element(p3, 2), element(p3, 1));
  return fract(mul(lhs, rhs));
}

function mxSchlickGain(x, r) {
  const rr = clamp(r, 0.001, 0.999);
  const a = mul(sub(div(1, rr), 2), sub(1, mul(2, x)));
  const low = div(x, add(a, 1));
  const high = div(sub(a, x), sub(a, 1));
  return mix(low, high, step(0.5, x));
}

function normalizeBlendWeights(weights) {
  const wx = element(weights, 0);
  const wy = element(weights, 1);
  const wz = element(weights, 2);
  const sum = max(add(add(wx, wy), wz), HEXTILE_EPSILON);
  return div(weights, sum);
}

function mxHextileComputeBlendWeights(luminanceWeights, tileWeights, falloff) {
  const weighted = mul(luminanceWeights, pow(max(tileWeights, vec3(HEXTILE_EPSILON, HEXTILE_EPSILON, HEXTILE_EPSILON)), vec3(7, 7, 7)));
  const normalized = normalizeBlendWeights(weighted);
  const gained = vec3(
    mxSchlickGain(element(normalized, 0), falloff),
    mxSchlickGain(element(normalized, 1), falloff),
    mxSchlickGain(element(normalized, 2), falloff),
  );
  const gainedNormalized = normalizeBlendWeights(gained);
  const applyFalloff = step(HEXTILE_EPSILON, abs(sub(falloff, 0.5)));
  return mix(normalized, gainedNormalized, applyFalloff);
}

function mxRotate2d(point, sine, cosine) {
  return vec2(sub(mul(cosine, element(point, 0)), mul(sine, element(point, 1))), add(mul(sine, element(point, 0)), mul(cosine, element(point, 1))));
}

function mxHextileCoord(coord, rotation, rotationRange, scale, scaleRange, offset, offsetRange) {
  const st = mul(coord, HEXTILE_SQRT3_2);
  const stSkewed = vec2(add(element(st, 0), mul(-0.57735027, element(st, 1))), mul(1.15470054, element(st, 1)));
  const stFrac = fract(stSkewed);
  const tx = element(stFrac, 0);
  const ty = element(stFrac, 1);
  const tz = sub(sub(1, tx), ty);
  const s = step(0, sub(0, tz));
  const s2 = sub(mul(2, s), 1);
  const w1 = mul(sub(0, tz), s2);
  const w2 = sub(s, mul(ty, s2));
  const w3 = sub(s, mul(tx, s2));
  const baseId = floor(stSkewed);
  const oneMinusS = sub(1, s);
  const id1 = add(baseId, vec2(s, s));
  const id2 = add(baseId, vec2(s, oneMinusS));
  const id3 = add(baseId, vec2(oneMinusS, s));

  const toTileCenter = (tileId) => {
    const scaled = div(tileId, HEXTILE_SQRT3_2);
    const sx = element(scaled, 0);
    const sy = element(scaled, 1);
    return vec2(add(sx, mul(0.5, sy)), mul(0.8660254, sy));
  };

  const ctr1 = toTileCenter(id1);
  const ctr2 = toTileCenter(id2);
  const ctr3 = toTileCenter(id3);

  const seedOffset = vec2(0.12345, 0.12345);
  const rand1 = mxHextileHash(add(id1, seedOffset));
  const rand2 = mxHextileHash(add(id2, seedOffset));
  const rand3 = mxHextileHash(add(id3, seedOffset));

  const rr = vec2(toRadians(element(rotationRange, 0)), toRadians(element(rotationRange, 1)));
  const rrMin = element(rr, 0);
  const rrMax = element(rr, 1);
  const randX = vec3(element(rand1, 0), element(rand2, 0), element(rand3, 0));
  const rotations = mix(vec3(rrMin, rrMin, rrMin), vec3(rrMax, rrMax, rrMax), mul(randX, rotation));
  const randY = vec3(element(rand1, 1), element(rand2, 1), element(rand3, 1));
  const scaleMin = element(scaleRange, 0);
  const scaleMax = element(scaleRange, 1);
  const randomScale = mix(vec3(scaleMin, scaleMin, scaleMin), vec3(scaleMax, scaleMax, scaleMax), randY);
  const scales = mix(vec3(1, 1, 1), randomScale, scale);
  const offsetMin = element(offsetRange, 0);
  const offsetMax = element(offsetRange, 1);
  const offset1 = mix(vec2(offsetMin, offsetMin), vec2(offsetMax, offsetMax), mul(rand1, offset));
  const offset2 = mix(vec2(offsetMin, offsetMin), vec2(offsetMax, offsetMax), mul(rand2, offset));
  const offset3 = mix(vec2(offsetMin, offsetMin), vec2(offsetMax, offsetMax), mul(rand3, offset));

  const sampleCoord = (center, randomOffset, rotationValue, sampleScale) => {
    const delta = sub(coord, center);
    const rotated = mxRotate2d(delta, sin(rotationValue), cos(rotationValue));
    const safeScale = max(sampleScale, HEXTILE_EPSILON);
    return add(add(div(rotated, vec2(safeScale, safeScale)), center), randomOffset);
  };

  return {
    coords: [
      sampleCoord(ctr1, offset1, element(rotations, 0), element(scales, 0)),
      sampleCoord(ctr2, offset2, element(rotations, 1), element(scales, 1)),
      sampleCoord(ctr3, offset3, element(rotations, 2), element(scales, 2)),
    ],
    weights: vec3(w1, w2, w3),
  };
}

function isSvgUri(uri) {
  if (typeof uri !== 'string') return false;
  return /\.svg(?:$|[?#])/i.test(uri);
}

function invertConstantMatrixValues(values, size) {
  if (!Array.isArray(values) || values.length !== size * size) return null;

  const rowAt = (row, col) => values[row * size + col];
  const augmented = [];

  for (let row = 0; row < size; row++) {
    const augRow = [];

    for (let col = 0; col < size; col++) {
      augRow.push(rowAt(row, col));
    }

    for (let col = 0; col < size; col++) {
      augRow.push(row === col ? 1 : 0);
    }

    augmented.push(augRow);
  }

  for (let pivotCol = 0; pivotCol < size; pivotCol++) {
    let pivotRow = pivotCol;
    let pivotAbs = Math.abs(augmented[pivotRow][pivotCol]);

    for (let row = pivotCol + 1; row < size; row++) {
      const valueAbs = Math.abs(augmented[row][pivotCol]);
      if (valueAbs > pivotAbs) {
        pivotAbs = valueAbs;
        pivotRow = row;
      }
    }

    if (pivotAbs < MATRIX_PIVOT_EPSILON) {
      return null;
    }

    if (pivotRow !== pivotCol) {
      const temp = augmented[pivotCol];
      augmented[pivotCol] = augmented[pivotRow];
      augmented[pivotRow] = temp;
    }

    const pivot = augmented[pivotCol][pivotCol];
    for (let col = 0; col < size * 2; col++) {
      augmented[pivotCol][col] /= pivot;
    }

    for (let row = 0; row < size; row++) {
      if (row === pivotCol) continue;
      const factor = augmented[row][pivotCol];
      if (factor === 0) continue;

      for (let col = 0; col < size * 2; col++) {
        augmented[row][col] -= factor * augmented[pivotCol][col];
      }
    }
  }

  const inverse = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      inverse.push(augmented[row][size + col]);
    }
  }

  return inverse;
}

function getOutputChannel(outputName) {
  if (outputName === 'outx' || outputName === 'outr' || outputName === 'r') return 0;
  if (outputName === 'outy' || outputName === 'outg' || outputName === 'g') return 1;
  if (outputName === 'outz' || outputName === 'outb' || outputName === 'b') return 2;
  if (outputName === 'outw' || outputName === 'outa' || outputName === 'a') return 3;
  return 0;
}

function normalizeSpaceName(value, fallback = 'world') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return fallback;
  if (normalized === 'world') return 'world';
  if (normalized === 'object' || normalized === 'model') return 'object';
  return fallback;
}

class MaterialXNode {
  constructor(materialX, nodeXML, nodePath = '') {
    this.materialX = materialX;
    this.nodeXML = nodeXML;
    this.nodePath = nodePath ? nodePath + '/' + this.name : this.name;
    this.parent = null;
    this.node = null;
    this.children = [];
  }

  get element() {
    return this.nodeXML.nodeName;
  }
  get nodeGraph() {
    return this.getAttribute('nodegraph');
  }
  get nodeName() {
    return this.getAttribute('nodename');
  }
  get interfaceName() {
    return this.getAttribute('interfacename');
  }
  get output() {
    return this.getAttribute('output');
  }
  get name() {
    return this.getAttribute('name');
  }
  get type() {
    return this.getAttribute('type');
  }
  get value() {
    return this.getAttribute('value');
  }

  getNodeGraph() {
    let nodeX = this;
    while (nodeX !== null) {
      if (nodeX.element === 'nodegraph') break;
      nodeX = nodeX.parent;
    }
    return nodeX;
  }

  getRoot() {
    let nodeX = this;
    while (nodeX.parent !== null) {
      nodeX = nodeX.parent;
    }
    return nodeX;
  }

  get referencePath() {
    let referencePath = null;
    if (this.nodeGraph !== null && this.output !== null) {
      referencePath = this.nodeGraph + '/' + this.output;
    } else if (this.nodeName !== null || this.interfaceName !== null) {
      const graphNode = this.getNodeGraph();
      const scopedReference = this.nodeName || this.interfaceName;
      if (graphNode && scopedReference) {
        referencePath = graphNode.nodePath + '/' + scopedReference;
      } else if (this.nodeName !== null) {
        // Surface-level nodename links can legitimately target top-level siblings.
        referencePath = this.nodeName;
      }
    }
    return referencePath;
  }

  get hasReference() {
    return this.referencePath !== null;
  }
  get isConst() {
    return this.element === 'input' && this.value !== null && this.type !== 'filename';
  }

  getColorSpaceNode() {
    const csSource = this.getAttribute('colorspace');
    const csTarget = this.getRoot().getAttribute('colorspace');
    if (!csSource || !csTarget) return null;
    const nodeName = `mx_${csSource}_to_${csTarget}`;
    return colorSpaceLib[nodeName] || null;
  }

  getTexture() {
    const filePrefix = this.getRecursiveAttribute('fileprefix') || '';
    const sourceURI = filePrefix + this.value;
    const resolvedURI = this.materialX.resolveTextureURI(sourceURI);
    const svgTexture = isSvgUri(resolvedURI);

    if (this.materialX.textureCache.has(resolvedURI)) {
      return this.materialX.textureCache.get(resolvedURI);
    }

    let loader = svgTexture ? this.materialX.imageLoader : this.materialX.textureLoader;
    if (resolvedURI && !svgTexture) {
      const handler = this.materialX.manager.getHandler(resolvedURI);
      if (handler !== null) loader = handler;
    }

    const textureNode = new Texture();
    textureNode.wrapS = textureNode.wrapT = RepeatWrapping;
    textureNode.flipY = !svgTexture;
    this.materialX.textureCache.set(resolvedURI, textureNode);

    loader.load(resolvedURI, (imageData) => {
      textureNode.image = imageData;
      textureNode.needsUpdate = true;
    }, undefined, () => {
      throw new Error(`Failed to load texture "${resolvedURI}".`);
    });

    return textureNode;
  }

  getClassFromType(type) {
    if (type === 'integer') return int;
    if (type === 'float') return float;
    if (type === 'vector2') return vec2;
    if (type === 'vector3') return vec3;
    if (type === 'vector4' || type === 'color4') return vec4;
    if (type === 'color3') return color;
    if (type === 'boolean') return null;
    if (type === 'matrix33') return mat3;
    if (type === 'matrix44') return mat4;
    return null;
  }

  toBooleanMaskNode(node) {
    if (node && node.nodeType === 'bool' && typeof node.select === 'function') {
      return node.select(float(1), float(0));
    }

    if (typeof node === 'boolean') {
      return float(node ? 1 : 0);
    }

    return node;
  }

  getNode(out = null) {
    let node = this.node;
    if (node !== null && out === null) return node;

    if (this.element === 'input' && this.name === 'texcoord' && this.type === 'vector2') {
      let index = 0;
      const defaultGeomProp = this.getAttribute('defaultgeomprop');
      if (defaultGeomProp && /^UV(\d+)$/.test(defaultGeomProp)) {
        index = parseInt(defaultGeomProp.match(/^UV(\d+)$/)[1], 10);
      }
      node = uv(index);
    }

    if ((this.element === 'separate2' || this.element === 'separate3' || this.element === 'separate4') && out) {
      const inNode = this.getNodeByName('in');
      return element(inNode, getOutputChannel(out));
    }

    if (this.element === 'gltf_colorimage' && out) {
      const file = this.getChildByName('file');
      const uvNode = this.getNodeByName('texcoord') || uv(0);
      const textureFile = file ? file.getTexture() : null;
      const sampled = textureFile ? texture(textureFile, uvNode) : vec4(0, 0, 0, 1);

      if (out === 'outa' || out === 'a') {
        return element(sampled, 3);
      }

      const colorSpaceNode = file ? file.getColorSpaceNode() : null;
      if (colorSpaceNode) {
        const converted = colorSpaceNode(sampled);
        return vec3(element(converted, 0), element(converted, 1), element(converted, 2));
      }

      return vec3(element(sampled, 0), element(sampled, 1), element(sampled, 2));
    }

    const type = this.type;

    if (this.isConst) {
      if (type === 'boolean') {
        const normalized = this.getValue().trim().toLowerCase();
        node = float(normalized === 'true' || normalized === '1' ? 1 : 0);
      } else if (type === 'matrix33') {
        node = this.getMatrix(3) || mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
      } else if (type === 'matrix44') {
        node = this.getMatrix(4) || mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      } else if (type === 'string') {
        node = this.getValue();
      } else {
        const nodeClass = this.getClassFromType(type);
        node = nodeClass ? nodeClass(...this.getVector()) : float(0);
      }
    } else if (this.hasReference) {
      if (this.element === 'output' && this.output && out === null) out = this.output;
      const referenceNode = this.materialX.getMaterialXNode(this.referencePath);

      if (referenceNode) {
        node = referenceNode.getNode(out);
      } else {
        this.materialX.issueCollector.addMissingReference(this.name, this.referencePath);
        node = float(0);
      }
    } else {
      const elementName = this.element;

      if (elementName === 'convert') {
        const nodeClass = this.getClassFromType(type) || float;
        node = nodeClass(this.getNodeByName('in'));
      } else if (elementName === 'constant') {
        node = this.getNodeByName('value');
      } else if (elementName === 'position') {
        const rawSpace = this.getInputValueByName('space') ?? this.getAttribute('space');
        const space = normalizeSpaceName(rawSpace, 'world');
        node = space === 'world' ? positionWorld : positionLocal;
      } else if (elementName === 'normal') {
        const rawSpace = this.getInputValueByName('space') ?? this.getAttribute('space');
        const space = normalizeSpaceName(rawSpace, 'object');
        node = space === 'world' ? normalWorld : normalLocal;
      } else if (elementName === 'tangent') {
        const rawSpace = this.getInputValueByName('space') ?? this.getAttribute('space');
        const space = normalizeSpaceName(rawSpace, 'world');
        node = space === 'world' ? tangentWorld : tangentLocal;
      } else if (elementName === 'texcoord') {
        const indexNode = this.getChildByName('index');
        const index = indexNode ? parseInt(indexNode.value) : 0;
        node = uv(index);
      } else if (elementName === 'geomcolor') {
        const indexNode = this.getChildByName('index');
        const index = indexNode ? parseInt(indexNode.value) : 0;
        node = vertexColor(index);
      } else if (elementName === 'tiledimage') {
        const file = this.getChildByName('file');
        const textureFile = file.getTexture();
        const uvNode = this.getNodeByName('texcoord') || uv(0);
        const uvTiling = this.getNodeByName('uvtiling');
        const uvOffset = this.getNodeByName('uvoffset');
        // three/tsl expects (scale, offset, uv), not (uv, scale, offset).
        const transformedUv = mx_transform_uv(uvTiling, uvOffset, uvNode);
        node = texture(textureFile, transformedUv);

        const colorSpaceNode = file.getColorSpaceNode();
        if (colorSpaceNode) node = colorSpaceNode(node);
      } else if (elementName === 'image') {
        const file = this.getChildByName('file');
        const uvNode = this.getNodeByName('texcoord');
        const textureFile = file.getTexture();
        node = texture(textureFile, uvNode);

        const colorSpaceNode = file.getColorSpaceNode();
        if (colorSpaceNode) node = colorSpaceNode(node);
      } else if (elementName === 'hextiledimage' || elementName === 'hextilednormalmap') {
        const file = this.getChildByName('file');
        if (!file) {
          this.materialX.issueCollector.addInvalidValue(
            this.name,
            `Texture node "${this.name || this.element}" is missing required input "file".`,
          );
          node = vec4(0, 0, 0, 1);
        } else {
          const textureFile = file.getTexture();
          const uvNode = this.getNodeByName('texcoord') || uv(0);
          const tiling = this.getNodeByName('tiling') || vec2(1, 1);
          const rotation = this.getNodeByName('rotation') || float(1);
          const rotationRange = this.getNodeByName('rotationrange') || vec2(0, 360);
          const scale = this.getNodeByName('scale') || float(1);
          const scaleRange = this.getNodeByName('scalerange') || vec2(0.5, 2);
          const offset = this.getNodeByName('offset') || float(1);
          const offsetRange = this.getNodeByName('offsetrange') || vec2(0, 1);
          const falloff = this.getNodeByName('falloff') || float(0.5);
          const falloffContrast = this.getNodeByName('falloffcontrast') || float(0.5);
          const lumaCoeffs = this.getNodeByName('lumacoeffs') || vec3(0.2722287, 0.6740818, 0.0536895);
          const transformedUv = mul(uvNode, tiling);
          const tileData = mxHextileCoord(transformedUv, rotation, rotationRange, scale, scaleRange, offset, offsetRange);

          let sample0 = texture(textureFile, tileData.coords[0]);
          let sample1 = texture(textureFile, tileData.coords[1]);
          let sample2 = texture(textureFile, tileData.coords[2]);
          const sample0Raw = sample0;
          const sample1Raw = sample1;
          const sample2Raw = sample2;

          const colorSpaceNode = file.getColorSpaceNode();
          if (colorSpaceNode) {
            sample0 = colorSpaceNode(sample0);
            sample1 = colorSpaceNode(sample1);
            sample2 = colorSpaceNode(sample2);
          }

          const c0 = vec3(element(sample0, 0), element(sample0, 1), element(sample0, 2));
          const c1 = vec3(element(sample1, 0), element(sample1, 1), element(sample1, 2));
          const c2 = vec3(element(sample2, 0), element(sample2, 1), element(sample2, 2));
          const cw = mix(
            vec3(1, 1, 1),
            vec3(dot(c0, lumaCoeffs), dot(c1, lumaCoeffs), dot(c2, lumaCoeffs)),
            vec3(falloffContrast, falloffContrast, falloffContrast),
          );
          const blendWeights = mxHextileComputeBlendWeights(cw, tileData.weights, falloff);
          const alphaWeights = mxHextileComputeBlendWeights(vec3(1, 1, 1), tileData.weights, falloff);
          const blendedRgb = add(
            add(mul(element(blendWeights, 0), c0), mul(element(blendWeights, 1), c1)),
            mul(element(blendWeights, 2), c2),
          );
          const blendedAlpha = add(
            add(
              mul(element(alphaWeights, 0), element(sample0Raw, 3)),
              mul(element(alphaWeights, 1), element(sample1Raw, 3)),
            ),
            mul(element(alphaWeights, 2), element(sample2Raw, 3)),
          );
          const blended = vec4(blendedRgb, blendedAlpha);

          if (elementName === 'hextilednormalmap') {
            const normalScale = this.getNodeByName('scale') || float(1);
            node = normalMap(blended, normalScale);
          } else {
            node = blended;
          }
        }
      } else if (elementName === 'gltf_image' || elementName === 'gltf_colorimage' || elementName === 'gltf_normalmap') {
        const file = this.getChildByName('file');
        const uvNode = this.getNodeByName('texcoord') || uv(0);
        const textureFile = file ? file.getTexture() : null;
        node = textureFile ? texture(textureFile, uvNode) : float(0);

        const colorSpaceNode = file ? file.getColorSpaceNode() : null;
        if (colorSpaceNode) node = colorSpaceNode(node);
        if (elementName === 'gltf_normalmap') {
          const normalScale = this.getNodeByName('scale') || float(1);
          node = normalMap(node, normalScale);
        }
      } else if (elementName === 'invertmatrix') {
        const inInput = this.getChildByName('in');
        const matrixType = inInput ? inInput.type : null;
        const isMatrixType = matrixType === 'matrix33' || matrixType === 'matrix44';

        if (inInput && inInput.isConst && isMatrixType) {
          const size = matrixType === 'matrix33' ? 3 : 4;
          const identityValues = size === 3 ? IDENTITY_MAT3_VALUES : IDENTITY_MAT4_VALUES;
          const matrixValues = inInput.getVector();
          const invertedValues = invertConstantMatrixValues(matrixValues, size);

          if (invertedValues === null) {
            this.materialX.issueCollector.addInvalidValue(
              this.name,
              `Matrix input for "${this.name || this.element}" is singular; using identity fallback.`,
            );
            node = size === 3 ? mat3(...identityValues) : mat4(...identityValues);
          } else {
            node = size === 3 ? mat3(...invertedValues) : mat4(...invertedValues);
          }
        } else {
          const inNode = this.getNodeByName('in');
          node = inNode === undefined || inNode === null ? float(0) : inNode;
        }
      } else if (MtlXLibrary[elementName] !== undefined) {
        const nodeElement = MtlXLibrary[elementName];
        const args = this.getNodesByNames(...nodeElement.params);

        for (let i = 0; i < nodeElement.params.length; i++) {
          if (args[i] === undefined || args[i] === null) {
            const paramName = nodeElement.params[i];
            const defaultValue = nodeElement.defaults ? nodeElement.defaults[paramName] : undefined;

            if (defaultValue !== undefined) {
              args[i] = typeof defaultValue === 'function' ? defaultValue() : float(defaultValue);
            } else {
              this.materialX.issueCollector.addInvalidValue(
                this.name,
                `Missing input "${paramName}" for node "${this.name || this.element}" (${this.element}). Using fallback 0.`,
              );
              args[i] = float(0);
            }
          }
        }

        node = nodeElement.nodeFunc(...args);
      }
    }

    if (node === null || node === undefined) {
      this.materialX.issueCollector.addUnsupportedNode(this.element, this.name);
      node = float(0);
    }

    if (type === 'boolean') {
      node = this.toBooleanMaskNode(node);
    } else {
      const nodeToTypeClass = this.getClassFromType(type);
      if (nodeToTypeClass !== null) {
        node = nodeToTypeClass(node);
      } else if (type !== null && type !== undefined && type !== 'multioutput') {
        this.materialX.issueCollector.addInvalidValue(this.name, `Unexpected type "${type}" on node "${this.name}".`);
        node = float(0);
      }
    }

    node.name = this.name;
    this.node = node;
    return node;
  }

  getChildByName(name) {
    for (const input of this.children) {
      if (input.name === name) return input;
    }
  }

  getNodes() {
    const nodes = {};
    for (const input of this.children) {
      const value = input.getNode(input.output);
      nodes[input.name] = value;
    }
    return nodes;
  }

  getNodeByName(name) {
    const child = this.getChildByName(name);
    return child ? child.getNode(child.output) : undefined;
  }

  getInputValueByName(name) {
    const child = this.getChildByName(name);
    return child ? child.value : null;
  }

  getNodesByNames(...names) {
    const nodes = [];
    for (const name of names) {
      const nodeValue = this.getNodeByName(name);
      nodes.push(nodeValue);
    }
    return nodes;
  }

  getValue() {
    return this.value ? this.value.trim() : '';
  }

  getVector() {
    const vector = [];
    for (const val of this.getValue().split(/[,|\s]/)) {
      if (val !== '') vector.push(Number(val.trim()));
    }
    return vector;
  }

  getMatrix(size) {
    const vector = this.getVector();
    const expectedLength = size * size;
    if (vector.length !== expectedLength) return null;
    return size === 3 ? mat3(...vector) : mat4(...vector);
  }

  getAttribute(name) {
    return this.nodeXML.getAttribute(name);
  }

  getRecursiveAttribute(name) {
    let attribute = this.nodeXML.getAttribute(name);
    if (attribute === null && this.parent !== null) {
      attribute = this.parent.getRecursiveAttribute(name);
    }
    return attribute;
  }

  setMaterial(material) {
    const mapper = MaterialXSurfaceMappings[this.element];
    if (mapper) {
      mapper(material, this.getNodes(), this.materialX.issueCollector, this.name);
    } else {
      this.materialX.issueCollector.addUnsupportedNode(this.element, this.name);
    }
  }

  toBasicMaterial() {
    const material = new MeshBasicNodeMaterial();
    material.name = this.name;

    for (const nodeX of this.children.toReversed()) {
      if (nodeX.name === 'out') {
        material.colorNode = nodeX.getNode();
        break;
      }
    }

    return material;
  }

  resolveSurfaceShaderNode(nodeX) {
    if (nodeX.hasReference) {
      return this.materialX.getMaterialXNode(nodeX.referencePath);
    }

    if (nodeX.nodeName) {
      return this.materialX.getMaterialXNode(nodeX.nodeName);
    }

    return null;
  }

  toPhysicalMaterial() {
    const material = new MeshPhysicalNodeMaterial();
    material.name = this.name;

    for (const nodeX of this.children) {
      const shaderProperties = this.resolveSurfaceShaderNode(nodeX);
      if (shaderProperties === null) {
        this.materialX.issueCollector.addMissingReference(
          nodeX.name,
          nodeX.referencePath || nodeX.nodeName || '(unknown)',
        );
        continue;
      }
      shaderProperties.setMaterial(material);
    }

    return material;
  }

  toMaterials(materialName = null) {
    const materials = {};
    const surfaceMaterials = this.children.filter((nodeX) => nodeX.element === 'surfacematerial');

    let selectedSurfaceMaterials = surfaceMaterials;
    if (materialName) {
      selectedSurfaceMaterials = surfaceMaterials.filter((nodeX) => nodeX.name === materialName);

      if (selectedSurfaceMaterials.length === 0) {
        this.materialX.issueCollector.addMissingMaterial(materialName);
      }
    }

    for (const nodeX of selectedSurfaceMaterials) {
      const material = nodeX.toPhysicalMaterial();
      materials[material.name] = material;
    }

    if (Object.keys(materials).length === 0) {
      for (const nodeX of this.children) {
        if (nodeX.element === 'nodegraph') {
          const material = nodeX.toBasicMaterial();
          materials[material.name] = material;
        }
      }
    }

    return materials;
  }

  add(materialXNode) {
    materialXNode.parent = this;
    this.children.push(materialXNode);
  }
}

class MaterialXDocument {
  constructor(manager, path, issueCollector, archiveResolver = null) {
    this.manager = manager;
    this.path = path;
    this.issueCollector = issueCollector;
    this.archiveResolver = archiveResolver;

    this.nodesXLib = new Map();
    this.imageLoader = new ImageLoader(manager);
    this.imageLoader.setPath(path);
    this.textureLoader = new ImageBitmapLoader(manager);
    this.textureLoader.setOptions({ imageOrientation: 'flipY' });
    this.textureLoader.setPath(path);
    this.textureCache = new Map();
  }

  resolveTextureURI(uri) {
    if (this.archiveResolver) {
      const archiveURI = this.archiveResolver(uri);
      if (archiveURI) return archiveURI;
    }

    return uri;
  }

  addMaterialXNode(materialXNode) {
    this.nodesXLib.set(materialXNode.nodePath, materialXNode);
  }

  getMaterialXNode(...names) {
    return this.nodesXLib.get(names.join('/'));
  }

  parseNode(nodeXML, nodePath = '') {
    const materialXNode = new MaterialXNode(this, nodeXML, nodePath);
    if (materialXNode.nodePath) this.addMaterialXNode(materialXNode);

    for (const childNodeXML of nodeXML.children) {
      const childMXNode = this.parseNode(childNodeXML, materialXNode.nodePath);
      materialXNode.add(childMXNode);
    }

    return materialXNode;
  }

  parse(text, materialName = null) {
    const rootXML = new DOMParser().parseFromString(text, 'application/xml').documentElement;
    const rootNode = this.parseNode(rootXML);
    const materials = rootNode.toMaterials(materialName);
    const report = this.issueCollector.buildReport();
    return { materials, report };
  }
}

export { MaterialXDocument };
