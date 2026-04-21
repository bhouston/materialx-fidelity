import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MaterialXLoader } from './vendor/MaterialXLoader.js';

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
const REFERENCE_IMAGE_WIDTH = 1024;
const REFERENCE_IMAGE_HEIGHT = 1024;

function parseQuery(search: string): ViewerQuery {
  const rawQuery = Object.fromEntries(new URLSearchParams(search).entries());
  return querySchema.parse(rawQuery);
}

function firstMaterial(candidate: unknown): THREE.Material | undefined {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  const value = candidate as Record<string, unknown>;
  const materialsObject = value.materials;
  if (materialsObject && typeof materialsObject === 'object') {
    const materials = Object.values(materialsObject as Record<string, unknown>);
    const lastMaterial = materials.at(-1);
    if (lastMaterial && typeof lastMaterial === 'object' && (lastMaterial as { isMaterial?: boolean }).isMaterial) {
      return lastMaterial as THREE.Material;
    }
  }

  const directMaterial = value.material;
  if (
    directMaterial &&
    typeof directMaterial === 'object' &&
    (directMaterial as { isMaterial?: boolean }).isMaterial
  ) {
    return directMaterial as THREE.Material;
  }

  return undefined;
}

function splitPath(path: string): { basePath: string; fileName: string } {
  const normalized = path.replaceAll('\\', '/');
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex === -1) {
    return { basePath: '', fileName: normalized };
  }

  return {
    basePath: `${normalized.slice(0, separatorIndex + 1)}`,
    fileName: normalized.slice(separatorIndex + 1),
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

  const materialXPath = splitPath(query.mtlxPath);
  const materialXLoader = new MaterialXLoader().setPath(materialXPath.basePath).setUnsupportedPolicy('warn');
  const materialXResult =
    typeof materialXLoader.loadAsync === 'function'
      ? await materialXLoader.loadAsync(materialXPath.fileName)
      : await new Promise((resolve, reject) => {
          materialXLoader.load(materialXPath.fileName, resolve, undefined, reject);
        });

  const resolvedMaterial = firstMaterial(materialXResult);
  if (!resolvedMaterial) {
    throw new Error('MaterialXLoader did not produce a surface material.');
  }

  const calibrationMesh = gltf.scene.getObjectByName('Calibration_Mesh') as THREE.Mesh | undefined;
  const previewMesh = gltf.scene.getObjectByName('Preview_Mesh') as THREE.Mesh | undefined;
  if (calibrationMesh?.isMesh && previewMesh?.isMesh) {
    calibrationMesh.material = resolvedMaterial;
    previewMesh.material = resolvedMaterial;
    if ((resolvedMaterial as THREE.Material).transparent) {
      calibrationMesh.renderOrder = 1;
      previewMesh.renderOrder = 2;
    }
  } else {
    gltf.scene.traverse((node: THREE.Object3D) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = resolvedMaterial;
      }
    });
  }

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
