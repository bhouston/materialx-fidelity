import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createIoBlenderMtlxRenderer,
  createNodesRenderer as createBlenderNodesRenderer,
  createRenderer as createBlenderRenderer,
} from '@material-fidelity/renderer-blender';
import { createRenderer as createMaterialXJsRenderer } from '@material-fidelity/renderer-materialxjs';
import { createRenderer as createMaterialXViewRenderer } from '@material-fidelity/renderer-materialxview';
import {
  createCurrentRenderer as createThreeJsCurrentRenderer,
  createRenderer as createThreeJsNewRenderer,
} from '@material-fidelity/renderer-threejs';

const MATERIAL_SOURCE_BASE_URL = 'https://github.com/bhouston/material-samples/tree/main/materials';
const HOMAGE_VIEWER_BASE_URL = 'https://materialx.ben3d.ca';
const DEFAULT_LOCAL_HOST = 'localhost:3000';
const DEFAULT_PRODUCTION_HOST = 'material-fidelity.ben3d.ca';
const MATERIAL_TYPE_ORDER = ['showcase', 'nodes', 'open_pbr_surface', 'gltf_pbr', 'standard_surface'] as const;
const RENDERER_CATEGORY_ORDER = ['pathtracer', 'raytracer', 'rasterizer'] as const;
const RENDERER_NAME_ORDER = [
  'materialxview',
  'blender-new',
  'blender-nodes',
  'blender-io-mtlx',
  'materialxjs',
  'threejs-current',
  'threejs-new',
] as const;
type RendererCategory = (typeof RENDERER_CATEGORY_ORDER)[number];
const RENDERER_CATEGORY_LABEL: Record<RendererCategory, string> = {
  pathtracer: 'Pathtracers',
  raytracer: 'Raytracers',
  rasterizer: 'Rasterizers',
};
interface MaterialDescriptor {
  type: string;
  apiType: string;
  apiName: string;
  name: string;
  absoluteDirectory: string;
  relativeDirectory: string;
  displayPath: string;
  sourceUrl: string;
}

interface BuiltInRendererDescriptor {
  name: string;
  category: RendererCategory;
}

interface RendererFilterResolution {
  renderers: BuiltInRendererDescriptor[];
}

export interface MaterialViewModel {
  id: string;
  type: string;
  name: string;
  displayPath: string;
  sourceUrl: string;
  liveViewerUrl: string;
  downloadMtlxZipUrl: string;
  images: Record<string, string | null>;
  reports: Record<string, string | null>;
}

export interface MaterialTypeGroupViewModel {
  type: string;
  materials: MaterialViewModel[];
}

export interface RendererCategoryGroupViewModel {
  category: RendererCategory;
  label: string;
  renderers: string[];
}

export interface ViewerIndexViewModel {
  renderers: string[];
  rendererGroups: RendererCategoryGroupViewModel[];
  groups: MaterialTypeGroupViewModel[];
  errors: string[];
  resolvedThirdPartyRoot: string;
}

export interface ViewerRoots {
  repoRoot: string;
  thirdPartyRoot: string;
  materialsRoot: string;
}

function toGithubSourceUrl(relativeDirectory: string): string {
  return `${MATERIAL_SOURCE_BASE_URL}/${relativeDirectory.replaceAll(path.sep, '/')}`;
}

function resolveViewerHostName(): string {
  const configuredHostName = process.env.HOST_NAME?.trim();
  if (configuredHostName) {
    return configuredHostName;
  }

  return process.env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_HOST : DEFAULT_LOCAL_HOST;
}

function toViewerOrigin(hostName: string): string {
  const protocol = hostName.startsWith('localhost') || hostName.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${hostName}`;
}

function toMaterialZipUrl(materialType: string, materialName: string): string {
  return `${toViewerOrigin(resolveViewerHostName())}/api/asset/${encodeURIComponent(materialType)}/${encodeURIComponent(materialName)}.mtlx.zip`;
}

function toLiveViewerUrl(materialType: string, materialName: string): string {
  const materialUrl = toMaterialZipUrl(materialType, materialName);
  return `${HOMAGE_VIEWER_BASE_URL}/?sourceUrl=${encodeURIComponent(materialUrl)}`;
}

function inferRepoRoot(invocationCwd: string): string {
  if (path.basename(invocationCwd) === 'viewer' && path.basename(path.dirname(invocationCwd)) === 'packages') {
    return path.dirname(path.dirname(invocationCwd));
  }

  return invocationCwd;
}

export function resolveViewerRoots(): ViewerRoots {
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const repoRoot = inferRepoRoot(invocationCwd);
  const thirdPartyRoot = path.join(repoRoot, 'third_party');
  const materialsRoot = path.join(thirdPartyRoot, 'material-samples', 'materials');

  return {
    repoRoot,
    thirdPartyRoot,
    materialsRoot,
  };
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function listMtlxFilesInDirectory(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.mtlx')
    .map((entry) => path.join(directoryPath, entry.name))
    .toSorted((left, right) => left.localeCompare(right));
}

async function resolveSingleMtlxFileInDirectory(directoryPath: string): Promise<string | undefined> {
  if (!(await directoryExists(directoryPath))) {
    return undefined;
  }
  const mtlxFiles = await listMtlxFilesInDirectory(directoryPath);
  if (mtlxFiles.length !== 1) {
    return undefined;
  }
  return mtlxFiles[0];
}

async function resolveReferenceImageCandidatePath(
  materialDirectory: string,
  rendererName: string,
): Promise<string | undefined> {
  const pngPath = path.join(materialDirectory, `${rendererName}.png`);
  if (await directoryExists(pngPath)) {
    return pngPath;
  }

  return undefined;
}

async function resolveReferenceReportCandidatePath(
  materialDirectory: string,
  rendererName: string,
): Promise<string | undefined> {
  const reportPath = path.join(materialDirectory, `${rendererName}.json`);
  if (await directoryExists(reportPath)) {
    return reportPath;
  }

  return undefined;
}

async function discoverMaterialFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const mtlxFiles = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.mtlx')
    .map((entry) => path.join(rootDir, entry.name));
  if (mtlxFiles.length > 0) {
    return mtlxFiles;
  }

  const nested: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      nested.push(...(await discoverMaterialFiles(path.join(rootDir, entry.name))));
    }
  }
  return nested;
}

function getBuiltInRenderers(thirdPartyRoot: string): BuiltInRendererDescriptor[] {
  const renderers = [
    createBlenderRenderer({ thirdPartyRoot }),
    createBlenderNodesRenderer({ thirdPartyRoot }),
    createIoBlenderMtlxRenderer({ thirdPartyRoot }),
    createMaterialXJsRenderer({ thirdPartyRoot }),
    createMaterialXViewRenderer(),
    createThreeJsNewRenderer({ thirdPartyRoot }),
    createThreeJsCurrentRenderer({ thirdPartyRoot }),
  ];
  return renderers.map((renderer) => ({ name: renderer.name, category: renderer.category })).toSorted(sortRenderers);
}

function getRendererNameOrder(rendererName: string): number {
  const index = RENDERER_NAME_ORDER.indexOf(rendererName as (typeof RENDERER_NAME_ORDER)[number]);
  return index === -1 ? RENDERER_NAME_ORDER.length : index;
}

function sortRenderers(left: BuiltInRendererDescriptor, right: BuiltInRendererDescriptor): number {
  const leftNameOrder = getRendererNameOrder(left.name);
  const rightNameOrder = getRendererNameOrder(right.name);
  if (leftNameOrder !== rightNameOrder) {
    return leftNameOrder - rightNameOrder;
  }

  const leftCategoryIndex = RENDERER_CATEGORY_ORDER.indexOf(left.category);
  const rightCategoryIndex = RENDERER_CATEGORY_ORDER.indexOf(right.category);
  if (leftCategoryIndex !== rightCategoryIndex) {
    return leftCategoryIndex - rightCategoryIndex;
  }

  return left.name.localeCompare(right.name);
}

function parseConfiguredRenderers(rawValue: string | undefined): string[] | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  return [
    ...new Set(
      rawValue
        .split(',')
        .map((renderer) => renderer.trim())
        .filter((renderer) => renderer.length > 0),
    ),
  ];
}

function resolveConfiguredRenderers(
  builtInRenderers: BuiltInRendererDescriptor[],
  configuredRenderers: string[] | undefined,
  errors: string[],
): RendererFilterResolution {
  if (!configuredRenderers) {
    return {
      renderers: builtInRenderers,
    };
  }

  const byName = new Map(builtInRenderers.map((renderer) => [renderer.name, renderer] as const));
  const unknownRenderers = configuredRenderers.filter((rendererName) => !byName.has(rendererName));

  if (unknownRenderers.length > 0) {
    errors.push(
      `Unknown renderer(s) in VIEWER_RENDERERS: ${unknownRenderers.join(', ')}. Known renderers: ${builtInRenderers.map((renderer) => renderer.name).join(', ')}`,
    );
  }

  const filteredRenderers = configuredRenderers
    .map((rendererName) => byName.get(rendererName))
    .filter((renderer): renderer is BuiltInRendererDescriptor => renderer !== undefined);

  if (filteredRenderers.length === 0) {
    errors.push('VIEWER_RENDERERS is defined, but no configured renderers matched the built-in renderer set.');
  }

  return {
    renderers: filteredRenderers,
  };
}

function toRendererGroups(renderers: BuiltInRendererDescriptor[]): RendererCategoryGroupViewModel[] {
  const groups = new Map<RendererCategory, RendererCategoryGroupViewModel>();

  for (const renderer of renderers.toSorted(sortRenderers)) {
    const group = groups.get(renderer.category) ?? {
      category: renderer.category,
      label: RENDERER_CATEGORY_LABEL[renderer.category],
      renderers: [],
    };
    group.renderers.push(renderer.name);
    groups.set(renderer.category, group);
  }

  return [...groups.values()];
}

function sortMaterialTypes(left: string, right: string): number {
  const leftIndex = MATERIAL_TYPE_ORDER.indexOf(left as (typeof MATERIAL_TYPE_ORDER)[number]);
  const rightIndex = MATERIAL_TYPE_ORDER.indexOf(right as (typeof MATERIAL_TYPE_ORDER)[number]);

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }

  if (leftIndex === -1) {
    return 1;
  }

  if (rightIndex === -1) {
    return -1;
  }

  return leftIndex - rightIndex;
}

function toMaterialDescriptor(materialFilePath: string, materialsRoot: string): MaterialDescriptor {
  const materialDirectory = path.dirname(materialFilePath);
  const relativeDirectory = path.relative(materialsRoot, materialDirectory);
  const segments = relativeDirectory.split(path.sep).filter(Boolean);
  const name = segments.at(-1) ?? path.basename(materialDirectory);
  const displayPath = segments.join(' / ');
  let type = segments.at(0) ?? 'unknown';
  let apiType = type;
  let apiName = name;

  if (segments[0] === 'nodes' && segments.length >= 2) {
    type = 'nodes';
    apiType = 'nodes';
    apiName = name;
  } else if (segments[0] === 'showcase' && segments.length >= 3) {
    type = 'showcase';
    apiType = `showcase:${segments[1]}`;
    apiName = name;
  } else if (segments[0] === 'surfaces' && segments.length >= 3) {
    type = segments[1] ?? 'unknown';
    apiType = type;
    apiName = name;
  }

  return {
    type,
    apiType,
    apiName,
    name,
    absoluteDirectory: materialDirectory,
    relativeDirectory,
    displayPath,
    sourceUrl: toGithubSourceUrl(relativeDirectory),
  };
}

export async function getViewerIndexData(): Promise<ViewerIndexViewModel> {
  const roots = resolveViewerRoots();
  const errors: string[] = [];
  const configuredRenderers = parseConfiguredRenderers(process.env.VIEWER_RENDERERS);

  const hasMaterialsRoot = await directoryExists(roots.materialsRoot);
  if (!hasMaterialsRoot) {
    errors.push(`Materials directory not found: ${roots.materialsRoot}`);
    return {
      renderers: [],
      rendererGroups: [],
      groups: [],
      errors,
      resolvedThirdPartyRoot: roots.thirdPartyRoot,
    };
  }
  const [builtInRenderers, materialFiles] = await Promise.all([
    Promise.resolve(getBuiltInRenderers(roots.thirdPartyRoot)),
    discoverMaterialFiles(roots.materialsRoot),
  ]);
  const rendererResolution = resolveConfiguredRenderers(builtInRenderers, configuredRenderers, errors);
  const rendererGroups = toRendererGroups(rendererResolution.renderers);
  const renderers = rendererGroups.flatMap((group) => group.renderers);

  if (materialFiles.length === 0) {
    errors.push(`No .mtlx files found under: ${roots.materialsRoot}`);
  }

  const grouped = new Map<string, MaterialViewModel[]>();

  for (const materialFilePath of materialFiles) {
    const descriptor = toMaterialDescriptor(materialFilePath, roots.materialsRoot);
    const images = Object.fromEntries(
      await Promise.all(
        renderers.map(async (rendererName) => {
          const referencePath = await resolveReferenceImageCandidatePath(descriptor.absoluteDirectory, rendererName);
          const imageUrl = referencePath
            ? `/api/reference-image/${encodeURIComponent(descriptor.apiType)}/${encodeURIComponent(descriptor.apiName)}/${encodeURIComponent(rendererName)}`
            : null;
          return [rendererName, imageUrl] as const;
        }),
      ),
    );
    const reports = Object.fromEntries(
      await Promise.all(
        renderers.map(async (rendererName) => {
          const reportPath = await resolveReferenceReportCandidatePath(descriptor.absoluteDirectory, rendererName);
          const reportUrl = reportPath
            ? `/api/reference-report/${encodeURIComponent(descriptor.apiType)}/${encodeURIComponent(descriptor.apiName)}/${encodeURIComponent(rendererName)}`
            : null;
          return [rendererName, reportUrl] as const;
        }),
      ),
    );

    const material: MaterialViewModel = {
      id: descriptor.relativeDirectory,
      type: descriptor.type,
      name: descriptor.name,
      displayPath: descriptor.displayPath,
      sourceUrl: descriptor.sourceUrl,
      liveViewerUrl: toLiveViewerUrl(descriptor.apiType, descriptor.apiName),
      downloadMtlxZipUrl: toMaterialZipUrl(descriptor.apiType, descriptor.apiName),
      images,
      reports,
    };
    const group = grouped.get(descriptor.type) ?? [];
    group.push(material);
    grouped.set(descriptor.type, group);
  }

  const groups: MaterialTypeGroupViewModel[] = [...grouped.entries()]
    .toSorted(([leftType], [rightType]) => sortMaterialTypes(leftType, rightType))
    .map(([type, materials]) => ({
      type,
      materials: materials.toSorted((left, right) => left.displayPath.localeCompare(right.displayPath)),
    }));

  return {
    renderers,
    rendererGroups,
    groups,
    errors,
    resolvedThirdPartyRoot: roots.thirdPartyRoot,
  };
}

export async function resolveReferenceImagePath(
  materialType: string,
  materialName: string,
  adapterName: string,
): Promise<string | undefined> {
  const targetDirectory = await resolveMaterialDirectory(materialType, materialName);
  if (!targetDirectory) {
    return undefined;
  }

  return resolveReferenceImageCandidatePath(targetDirectory, adapterName);
}

export async function resolveReferenceReportPath(
  materialType: string,
  materialName: string,
  adapterName: string,
): Promise<string | undefined> {
  const targetDirectory = await resolveMaterialDirectory(materialType, materialName);
  if (!targetDirectory) {
    return undefined;
  }

  return resolveReferenceReportCandidatePath(targetDirectory, adapterName);
}

export async function resolveMaterialDirectory(
  materialType: string,
  materialName: string,
): Promise<string | undefined> {
  const roots = resolveViewerRoots();
  const materialsRootPrefix = `${path.resolve(roots.materialsRoot)}${path.sep}`;
  const candidateDirectories =
    materialType === 'nodes'
      ? [path.resolve(roots.materialsRoot, 'nodes', materialName)]
      : materialType.startsWith('showcase:')
        ? [path.resolve(roots.materialsRoot, 'showcase', materialType.slice('showcase:'.length), materialName)]
        : [
            path.resolve(roots.materialsRoot, 'showcase', materialType, materialName),
            path.resolve(roots.materialsRoot, 'surfaces', materialType, materialName),
            // Legacy fallback while old trees are still present.
            path.resolve(roots.materialsRoot, materialType, materialName),
          ];

  for (const targetDirectory of candidateDirectories) {
    if (!targetDirectory.startsWith(materialsRootPrefix)) {
      continue;
    }

    const materialPath = await resolveSingleMtlxFileInDirectory(targetDirectory);
    if (materialPath) {
      return targetDirectory;
    }
  }

  return undefined;
}

export async function resolveMaterialFilePath(materialType: string, materialName: string): Promise<string | undefined> {
  const targetDirectory = await resolveMaterialDirectory(materialType, materialName);
  if (!targetDirectory) {
    return undefined;
  }
  return resolveSingleMtlxFileInDirectory(targetDirectory);
}
