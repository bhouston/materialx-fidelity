import path from 'node:path';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { readMaterialX, validateDocument } from '@materialx-js/materialx';
import pLimit from 'p-limit';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { findFilesByName } from './fs-utils.js';
import type { CreateReferencesOptions, CreateReferencesResult, FidelityRenderer, RenderFailure } from './types.js';
import type { MaterialXDocument, MaterialXInput, MaterialXNode } from '@materialx-js/materialx';

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';
const DEFAULT_BACKGROUND_COLOR = '0,0,0';
const UNKNOWN_NODE_CATEGORY_PREFIX = 'Unknown node category "';

interface PreflightIssue {
  materialPath: string;
  level: 'error' | 'warning';
  location: string;
  message: string;
}

interface PreflightResult {
  fatalIssues: PreflightIssue[];
  warningIssues: PreflightIssue[];
}

async function assertRenderIsNotEmpty(outputPngPath: string): Promise<void> {
  const pngBytes = await readFile(outputPngPath);
  const png = PNG.sync.read(pngBytes);

  for (let pixelOffset = 0; pixelOffset < png.data.length; pixelOffset += 4) {
    const red = png.data[pixelOffset];
    const green = png.data[pixelOffset + 1];
    const blue = png.data[pixelOffset + 2];
    if (red !== 0 || green !== 0 || blue !== 0) {
      return;
    }
  }

  await rm(outputPngPath, { force: true });
  throw new Error('Render output is empty (all pixels are black).');
}

function createOutputPath(materialPath: string, rendererName: string): string {
  return path.join(path.dirname(materialPath), `${rendererName}.png`);
}

function toWebpPath(outputPngPath: string): string {
  const parsedPath = path.parse(outputPngPath);
  return path.join(parsedPath.dir, `${parsedPath.name}.webp`);
}

function normalizeFilePrefix(filePrefix: string | undefined): string {
  if (!filePrefix) {
    return '';
  }
  return filePrefix.trim();
}

function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function combineFilePrefix(parentPrefix: string, childPrefix: string): string {
  if (!childPrefix) {
    return parentPrefix;
  }
  if (!parentPrefix || path.isAbsolute(childPrefix) || hasUriScheme(childPrefix)) {
    return childPrefix;
  }
  return `${parentPrefix}${childPrefix}`;
}

function extractFilenameInputValue(input: MaterialXInput): string {
  const inputValue = input.value ?? input.attributes.value ?? '';
  return inputValue.trim();
}

async function validateTextureInputsForNodes(
  materialPath: string,
  nodes: MaterialXNode[],
  scope: string,
  inheritedFilePrefix: string,
): Promise<PreflightResult> {
  const fatalIssues: PreflightIssue[] = [];
  const warningIssues: PreflightIssue[] = [];
  const materialDirectory = path.dirname(materialPath);

  for (const node of nodes) {
    const nodePrefix = combineFilePrefix(inheritedFilePrefix, normalizeFilePrefix(node.attributes.fileprefix));
    const nodeLocation = `${scope}/${node.category}:${node.name ?? 'unnamed'}`;

    for (const input of node.inputs) {
      if (input.type !== 'filename') {
        continue;
      }

      const filenameValue = extractFilenameInputValue(input);
      if (filenameValue.length === 0) {
        continue;
      }
      const location = `${nodeLocation}/input:${input.name || 'unnamed'}`;
      if (hasUriScheme(filenameValue)) {
        warningIssues.push({
          materialPath,
          level: 'warning',
          location,
          message: `Skipping texture existence check for URI "${filenameValue}".`,
        });
        continue;
      }

      const inputPrefix = combineFilePrefix(nodePrefix, normalizeFilePrefix(input.attributes.fileprefix));
      const sourcePath = `${inputPrefix}${filenameValue}`;
      const resolvedPath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(materialDirectory, sourcePath);

      try {
        await access(resolvedPath);
      } catch {
        fatalIssues.push({
          materialPath,
          level: 'error',
          location,
          message: `Missing texture file "${sourcePath}" resolved to "${resolvedPath}".`,
        });
      }
    }
  }

  return { fatalIssues, warningIssues };
}

async function preflightMaterialValidation(materialPaths: string[]): Promise<PreflightResult> {
  const fatalIssues: PreflightIssue[] = [];
  const warningIssues: PreflightIssue[] = [];

  for (const materialPath of materialPaths) {
    let document: MaterialXDocument;
    try {
      document = await readMaterialX(materialPath);
    } catch (error) {
      fatalIssues.push({
        materialPath,
        level: 'error',
        location: 'materialx',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const issue of validateDocument(document)) {
      const issueRecord: PreflightIssue = {
        materialPath,
        level: issue.level,
        location: issue.location,
        message: issue.message,
      };
      if (issue.level === 'error' || issue.message.startsWith(UNKNOWN_NODE_CATEGORY_PREFIX)) {
        fatalIssues.push(issueRecord);
      } else {
        warningIssues.push(issueRecord);
      }
    }

    const documentPrefix = normalizeFilePrefix(document.attributes.fileprefix);
    const documentTextureIssues = await validateTextureInputsForNodes(
      materialPath,
      document.nodes,
      'materialx',
      documentPrefix,
    );
    fatalIssues.push(...documentTextureIssues.fatalIssues);
    warningIssues.push(...documentTextureIssues.warningIssues);
    for (const nodeGraph of document.nodeGraphs) {
      const nodeGraphPrefix = combineFilePrefix(documentPrefix, normalizeFilePrefix(nodeGraph.attributes.fileprefix));
      const nodeGraphScope = `materialx/nodegraph:${nodeGraph.name ?? 'unnamed'}`;
      const nodeGraphTextureIssues = await validateTextureInputsForNodes(
        materialPath,
        nodeGraph.nodes,
        nodeGraphScope,
        nodeGraphPrefix,
      );
      fatalIssues.push(...nodeGraphTextureIssues.fatalIssues);
      warningIssues.push(...nodeGraphTextureIssues.warningIssues);
    }
  }

  return { fatalIssues, warningIssues };
}

function writeValidationWarnings(warnings: PreflightIssue[]): void {
  for (const warning of warnings) {
    process.stderr.write(`WARN ${warning.materialPath} | ${warning.location}: ${warning.message}\n`);
  }
}

function formatFatalValidationIssues(issues: PreflightIssue[]): string {
  return [
    `MaterialX pre-render validation failed for ${new Set(issues.map((issue) => issue.materialPath)).size} material(s):`,
    ...issues.map((issue) => `- ${issue.materialPath} | ${issue.location}: ${issue.message}`),
  ].join('\n');
}

function parseMaterialSelectorAsRegex(selector: string): RegExp | undefined {
  const trimmedSelector = selector.trim();
  if (trimmedSelector.length === 0) {
    return undefined;
  }

  if (trimmedSelector.startsWith('re:')) {
    return new RegExp(trimmedSelector.slice(3), 'i');
  }

  const regexLiteralMatch = /^\/(.+)\/([dgimsuvy]*)$/.exec(trimmedSelector);
  if (regexLiteralMatch) {
    const expression = regexLiteralMatch[1];
    const flags = regexLiteralMatch[2] ?? '';
    if (!expression) {
      return undefined;
    }
    return new RegExp(expression, flags);
  }

  return undefined;
}

function materialMatchesSelector(materialPath: string, materialsRoot: string, selector: string): boolean {
  const regex = parseMaterialSelectorAsRegex(selector);
  const materialDirectory = path.dirname(materialPath);
  const relativeMaterialPath = path.relative(materialsRoot, materialPath);
  const relativeMaterialDirectory = path.relative(materialsRoot, materialDirectory);
  const matchTargets = [materialPath, materialDirectory, relativeMaterialPath, relativeMaterialDirectory].map((target) =>
    target.replaceAll('\\', '/'),
  );

  if (regex) {
    return matchTargets.some((target) => {
      regex.lastIndex = 0;
      return regex.test(target);
    });
  }

  const normalizedSelector = selector.trim().toLowerCase();
  if (normalizedSelector.length === 0) {
    return false;
  }
  return matchTargets.some((target) => target.toLowerCase().includes(normalizedSelector));
}

export async function createReferences(options: CreateReferencesOptions): Promise<CreateReferencesResult> {
  const samplesRoot = path.join(options.thirdPartyRoot, 'materialx-samples');
  const materialsRoot = path.join(samplesRoot, 'materials');
  const viewerRoot = path.join(samplesRoot, 'viewer');

  try {
    await access(samplesRoot);
  } catch {
    throw new Error(`Missing required materialx-samples directory at ${samplesRoot}.`);
  }

  try {
    await access(materialsRoot);
  } catch {
    throw new Error(`Missing required materials directory at ${materialsRoot}.`);
  }

  try {
    await access(viewerRoot);
  } catch {
    throw new Error(`Missing required viewer directory at ${viewerRoot}.`);
  }

  const materialFiles = await findFilesByName(materialsRoot, 'material.mtlx');
  if (materialFiles.length === 0) {
    throw new Error(`No material.mtlx files found under ${materialsRoot}.`);
  }
  const materialSelectors = [...new Set((options.materialSelectors ?? []).map((selector) => selector.trim()).filter(Boolean))];
  const selectedMaterialFiles =
    materialSelectors.length > 0
      ? materialFiles.filter((materialPath) =>
          materialSelectors.some((selector) => materialMatchesSelector(materialPath, materialsRoot, selector)),
        )
      : materialFiles;
  if (selectedMaterialFiles.length === 0) {
    throw new Error(`No material.mtlx files matched --materials "${materialSelectors.join(', ')}".`);
  }
  await options.onPlan?.({ materialPaths: selectedMaterialFiles });

  const hdrPath = path.join(viewerRoot, VIEWER_HDR_FILENAME);
  const modelPath = path.join(viewerRoot, VIEWER_MODEL_FILENAME);
  const missingViewerAssets: string[] = [];

  try {
    await access(hdrPath);
  } catch {
    missingViewerAssets.push(VIEWER_HDR_FILENAME);
  }

  try {
    await access(modelPath);
  } catch {
    missingViewerAssets.push(VIEWER_MODEL_FILENAME);
  }
  if (missingViewerAssets.length > 0) {
    throw new Error(
      `Missing required viewer assets under ${viewerRoot}: ${missingViewerAssets.join(', ')}.`,
    );
  }

  const rendererMap = new Map<string, FidelityRenderer>();
  for (const renderer of options.renderers) {
    if (rendererMap.has(renderer.name)) {
      throw new Error(`Duplicate renderer name detected: "${renderer.name}".`);
    }
    rendererMap.set(renderer.name, renderer);
  }

  const normalizedRequestedRenderers = [...new Set((options.rendererNames ?? []).map((name) => name.trim()).filter(Boolean))];
  const selectedRendererNames =
    normalizedRequestedRenderers.length > 0 ? normalizedRequestedRenderers : [...rendererMap.keys()];
  if (selectedRendererNames.length === 0) {
    const available = [...rendererMap.keys()].toSorted().join(', ');
    throw new Error(`No renderers are available. Available renderers: ${available || '(none)'}.`);
  }
  const missingRendererNames = selectedRendererNames.filter((rendererName) => !rendererMap.has(rendererName));
  if (missingRendererNames.length > 0) {
    const available = [...rendererMap.keys()].toSorted().join(', ');
    throw new Error(
      `Renderer(s) "${missingRendererNames.join(', ')}" not found. Available renderers: ${available || '(none)'}.`,
    );
  }
  const selectedRenderers = selectedRendererNames.map((rendererName) => rendererMap.get(rendererName) as FidelityRenderer);
  const failedRendererChecks: string[] = [];
  for (const renderer of selectedRenderers) {
    const checkResult = await renderer.checkPrerequisites();
    if (!checkResult.success) {
      failedRendererChecks.push(
        `${renderer.name}: ${checkResult.message?.trim() || 'Renderer prerequisites are not satisfied.'}`,
      );
    }
  }
  if (failedRendererChecks.length > 0) {
    throw new Error(`Renderer prerequisites are not met:\n- ${failedRendererChecks.join('\n- ')}`);
  }
  const preflightResult = await preflightMaterialValidation(selectedMaterialFiles);
  if (preflightResult.warningIssues.length > 0) {
    writeValidationWarnings(preflightResult.warningIssues);
  }
  if (preflightResult.fatalIssues.length > 0) {
    throw new Error(formatFatalValidationIssues(preflightResult.fatalIssues));
  }

  const failures: RenderFailure[] = [];
  let started = 0;
  let completed = 0;
  let attempted = 0;
  let stopped = false;
  const shouldStop = (): boolean => options.shouldStop?.() === true;
  const renderQueue = selectedMaterialFiles.flatMap((materialPath) =>
    selectedRenderers.map((renderer) => ({ materialPath, renderer })),
  );
  const startedRenderers: FidelityRenderer[] = [];
  let renderPipelineError: Error | undefined;
  let shutdownError: Error | undefined;
  try {
    for (const renderer of selectedRenderers) {
      await renderer.start();
      startedRenderers.push(renderer);
    }

    const limit = pLimit(Math.max(1, options.concurrency));
    await Promise.all(
      renderQueue.map(({ materialPath, renderer }) =>
        limit(async () => {
          if (shouldStop()) {
            stopped = true;
            return;
          }

          const outputPngPath = createOutputPath(materialPath, renderer.name);
          started += 1;
          await options.onProgress?.({
            phase: 'start',
            rendererName: renderer.name,
            materialPath,
            outputPngPath,
            total: renderQueue.length,
            started,
            completed,
          });
          await mkdir(path.dirname(outputPngPath), { recursive: true });

          let renderError: Error | undefined;
          const startedAt = Date.now();
          try {
            await renderer.generateImage({
              mtlxPath: materialPath,
              outputPngPath,
              environmentHdrPath: hdrPath,
              modelPath,
              backgroundColor: DEFAULT_BACKGROUND_COLOR,
            });
            await assertRenderIsNotEmpty(outputPngPath);
            const outputWebpPath = toWebpPath(outputPngPath);
            await sharp(outputPngPath).webp({ quality: 99 }).toFile(outputWebpPath);
            await rm(outputPngPath, { force: true });
          } catch (error) {
            renderError = error instanceof Error ? error : new Error(String(error));
            failures.push({ rendererName: renderer.name, materialPath, outputPngPath, error: renderError });
          } finally {
            attempted += 1;
            completed += 1;
          }

          await options.onProgress?.({
            phase: 'finish',
            rendererName: renderer.name,
            materialPath,
            outputPngPath,
            total: renderQueue.length,
            started,
            completed,
            success: !renderError,
            durationMs: Math.max(0, Date.now() - startedAt),
            error: renderError,
          });
        }),
      ),
    );
  } catch (error) {
    renderPipelineError = error instanceof Error ? error : new Error(String(error));
  } finally {
    for (const renderer of startedRenderers.toReversed()) {
      try {
        await renderer.shutdown();
      } catch (error) {
        shutdownError ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  }
  if (shutdownError) {
    throw shutdownError;
  }
  if (renderPipelineError) {
    throw renderPipelineError;
  }

  return {
    rendererNames: selectedRenderers.map((renderer) => renderer.name),
    total: renderQueue.length,
    attempted,
    rendered: attempted - failures.length,
    failures,
    stopped,
  };
}
