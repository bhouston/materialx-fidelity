import { parseMaterialX } from '@material-viewer/materialx/dist/xml.js';
import { createThreeMaterialFromDocument, type TextureResolver } from '@material-viewer/materialx-three';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import { RepeatWrapping, TextureLoader } from 'three';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

declare global {
  var __MTLX_CAPTURE_DONE__: boolean | undefined;
  var __MTLX_CAPTURE_ERROR__: string | undefined;
}

const querySchema = z.object({
  mtlxPath: z.string().min(1),
  modelPath: z.string().min(1),
  environmentHdrPath: z.string().min(1),
  environmentRotationDegrees: z.coerce.number().default(0),
  backgroundColor: z.string().transform((value, context) => {
    const pieces = value.split(',').map((piece) => Number(piece.trim()));
    if (pieces.length !== 3 || pieces.some((piece) => Number.isNaN(piece) || piece < 0 || piece > 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected backgroundColor as "r,g,b" with values in [0,1].',
      });
      return z.NEVER;
    }

    return [pieces[0], pieces[1], pieces[2]] as const;
  }),
});

type ViewerQuery = z.infer<typeof querySchema>;
const IDEAL_MESH_SPHERE_RADIUS = 2;
const REFERENCE_IMAGE_WIDTH = 512;
const REFERENCE_IMAGE_HEIGHT = 512;
const DISABLED_NODE_CATEGORIES = new Set(['artistic_ior']);
const nodeNamespace = THREE as typeof THREE & {
  Node?: {
    captureStackTrace?: boolean;
  };
};
if (nodeNamespace.Node) {
  nodeNamespace.Node.captureStackTrace = true;
}

function parseQuery(search: string): ViewerQuery {
  const rawQuery = Object.fromEntries(new URLSearchParams(search).entries());
  return querySchema.parse(rawQuery);
}

function normalizePath(value: string): string {
  const raw = value.replaceAll('\\', '/');
  const hasLeadingSlash = raw.startsWith('/');
  const out: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const normalized = out.join('/');
  return hasLeadingSlash ? `/${normalized}` : normalized;
}

function dirnamePath(value: string): string {
  const normalized = normalizePath(value);
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex <= 0) {
    return normalized.startsWith('/') ? '/' : '';
  }
  return normalized.slice(0, separatorIndex);
}

function fromFsUrlPath(fsUrlPath: string): string {
  if (!fsUrlPath.startsWith('/@fs/')) {
    return fsUrlPath;
  }
  return fsUrlPath.slice('/@fs/'.length);
}

function toFsUrlPath(path: string): string {
  return `/@fs/${normalizePath(path)}`;
}

function createBrowserTextureResolver(mtlxPathUrl: string): TextureResolver {
  const materialPath = normalizePath(fromFsUrlPath(mtlxPathUrl));
  const materialDirectory = dirnamePath(materialPath);
  const loader = new TextureLoader();
  const cache = new Map<string, THREE.Texture>();

  return {
    resolve(uri, context) {
      const filePrefix = context.document.attributes.fileprefix ?? '';
      const resolvedPath = normalizePath(`${materialDirectory}/${filePrefix}/${uri}`);
      const resolvedUrl = toFsUrlPath(resolvedPath);
      const cached = cache.get(resolvedUrl);
      if (cached) {
        return cached;
      }

      const texture = loader.load(resolvedUrl);
      texture.name = resolvedUrl;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      // Match MaterialXView/Three vendor MaterialX orientation semantics.
      texture.flipY = false;
      cache.set(resolvedUrl, texture);
      return texture;
    },
  };
}

function recenterAndNormalizeModel(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const sphereRadius = size.length() * 0.5;
  if (sphereRadius <= 0) {
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const scale = IDEAL_MESH_SPHERE_RADIUS / sphereRadius;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
}

function applyMaterialToScene(scene: THREE.Object3D, material: THREE.Material): void {
  const calibrationMesh = scene.getObjectByName('Calibration_Mesh') as THREE.Mesh | undefined;
  const previewMesh = scene.getObjectByName('Preview_Mesh') as THREE.Mesh | undefined;
  if (calibrationMesh?.isMesh && previewMesh?.isMesh) {
    calibrationMesh.material = material;
    previewMesh.material = material;
    if (material.transparent) {
      calibrationMesh.renderOrder = 1;
      previewMesh.renderOrder = 2;
    }
    return;
  }

  scene.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = material;
    }
  });
}

function getCoveredNodeCategories(document: {
  nodes?: Array<{ category?: string }>;
  nodeGraphs?: Array<{ nodes?: Array<{ category?: string }> }>;
}): Set<string> {
  const categories = new Set<string>();
  for (const node of document.nodes ?? []) {
    if (node.category) categories.add(node.category);
  }
  for (const graph of document.nodeGraphs ?? []) {
    for (const node of graph.nodes ?? []) {
      if (node.category) categories.add(node.category);
    }
  }
  return categories;
}

async function buildScene(): Promise<void> {
  const query = parseQuery(window.location.search);
  const [backgroundR, backgroundG, backgroundB] = query.backgroundColor;
  const mount = document.getElementById('capture-root');
  if (!mount) {
    throw new Error('Capture root element not found.');
  }

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    forceWebGL: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(REFERENCE_IMAGE_WIDTH, REFERENCE_IMAGE_HEIGHT, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(new THREE.Color(backgroundR, backgroundG, backgroundB), 1);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, REFERENCE_IMAGE_WIDTH / REFERENCE_IMAGE_HEIGHT, 0.05, 1000);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);

  const hdrLoader = new HDRLoader();
  const environmentTexture = await hdrLoader.loadAsync(query.environmentHdrPath);
  environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
  const environmentRotationRadians = THREE.MathUtils.degToRad(query.environmentRotationDegrees);
  scene.environment = environmentTexture;
  scene.environmentRotation.set(0, environmentRotationRadians, 0);
  scene.background = environmentTexture;
  const sceneWithBackgroundRotation = scene as THREE.Scene & { backgroundRotation?: THREE.Euler };
  sceneWithBackgroundRotation.backgroundRotation?.set(0, environmentRotationRadians, 0);

  const gltfLoader = new GLTFLoader();
  const gltf = await gltfLoader.loadAsync(query.modelPath);
  recenterAndNormalizeModel(gltf.scene);
  scene.add(gltf.scene);

  const response = await fetch(query.mtlxPath);
  if (!response.ok) {
    throw new Error(`Failed to load material file (${response.status}): ${query.mtlxPath}`);
  }
  const xml = await response.text();
  const materialxDocument = parseMaterialX(xml);
  const { material, result } = createThreeMaterialFromDocument(materialxDocument, {
    textureResolver: createBrowserTextureResolver(query.mtlxPath),
  });
  const coveredCategories = getCoveredNodeCategories(materialxDocument);
  const unsupportedCategories = new Set(result.unsupportedCategories);
  for (const category of DISABLED_NODE_CATEGORIES) {
    if (coveredCategories.has(category)) {
      unsupportedCategories.add(category);
    }
  }
  if (unsupportedCategories.size > 0) {
    const categoryList = [...unsupportedCategories].sort().join(', ');
    throw new Error(`Unsupported MaterialX node categories in materialxjs renderer: ${categoryList}`);
  }
  if (result.warnings.length > 0) {
    const warningText = result.warnings.map((warning) => warning.message).join(' | ');
    console.warn(`MaterialX JS compile warnings: ${warningText}`);
  }

  applyMaterialToScene(gltf.scene, material);
  if (typeof renderer.compileAsync === 'function') {
    await renderer.compileAsync(gltf.scene, camera, scene);
  }
  renderer.render(scene, camera);
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  renderer.render(scene, camera);
}

async function initialize(): Promise<void> {
  globalThis.__MTLX_CAPTURE_DONE__ = false;
  delete globalThis.__MTLX_CAPTURE_ERROR__;

  try {
    await buildScene();
  } catch (error) {
    globalThis.__MTLX_CAPTURE_ERROR__ = error instanceof Error ? error.message : String(error);
  } finally {
    globalThis.__MTLX_CAPTURE_DONE__ = true;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found.');
}

const root = createRoot(rootElement);
flushSync(() => {
  root.render(
    <div
      id="capture-root"
      style={{
        width: '100%',
        height: '100%',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    />,
  );
});

void initialize();
