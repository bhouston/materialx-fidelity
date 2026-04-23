import {
  Texture,
  RepeatWrapping,
  ImageBitmapLoader,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
} from 'three/webgpu';

import {
  float,
  int,
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
      if (graphNode) {
        referencePath = graphNode.nodePath + '/' + (this.nodeName || this.interfaceName);
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

    if (this.materialX.textureCache.has(resolvedURI)) {
      return this.materialX.textureCache.get(resolvedURI);
    }

    let loader = this.materialX.textureLoader;
    if (resolvedURI) {
      const handler = this.materialX.manager.getHandler(resolvedURI);
      if (handler !== null) loader = handler;
    }

    const textureNode = new Texture();
    textureNode.wrapS = textureNode.wrapT = RepeatWrapping;
    this.materialX.textureCache.set(resolvedURI, textureNode);

    loader.load(
      resolvedURI,
      function (imageBitmap) {
        textureNode.image = imageBitmap;
        textureNode.needsUpdate = true;
      },
      undefined,
      () => {
        textureNode.needsUpdate = true;
      },
    );

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
        const space = normalizeSpaceName(rawSpace, 'world');
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
      } else if (type !== null && type !== undefined) {
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
