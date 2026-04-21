import path from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import { findFilesByName } from './fs-utils.js';
import { loadAdapters } from './adapters.js';
import type { CreateReferencesOptions, CreateReferencesResult, RenderFailure } from './types.js';

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';

function createOutputPath(materialPath: string, adapterName: string): string {
  return path.join(path.dirname(materialPath), `${adapterName}.png`);
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const workerCount = Math.max(1, concurrency);
  let cursor = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index] as T);
    }
  });

  await Promise.all(workers);
}

export async function createReferences(options: CreateReferencesOptions): Promise<CreateReferencesResult> {
  const samplesRoot = path.join(options.thirdPartyRoot, 'MaterialX-Samples');
  const materialsRoot = path.join(samplesRoot, 'materials');
  const viewerRoot = path.join(samplesRoot, 'viewer');

  const materialFiles = await findFilesByName(materialsRoot, 'material.mtlx');
  if (materialFiles.length === 0) {
    throw new Error(`No material.mtlx files found under ${materialsRoot}.`);
  }

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

  const adapters = await loadAdapters({
    adaptersRoot: options.adaptersRoot,
    context: {
      thirdPartyRoot: options.thirdPartyRoot,
    },
  });
  const adapter = adapters.get(options.adapterName);
  if (!adapter) {
    const available = [...adapters.keys()].toSorted().join(', ');
    throw new Error(`Adapter "${options.adapterName}" not found. Available adapters: ${available || '(none)'}.`);
  }

  const failures: RenderFailure[] = [];

  await adapter.start();
  try {
    await runWithConcurrency(materialFiles, options.concurrency, async (materialPath) => {
      const outputPngPath = createOutputPath(materialPath, adapter.name);
      await mkdir(path.dirname(outputPngPath), { recursive: true });

      try {
        await adapter.generateImage({
          mtlxPath: materialPath,
          outputPngPath,
          environmentHdrPath: hdrPath,
          modelPath,
          backgroundColor: options.backgroundColor,
          screenWidth: options.screenWidth,
          screenHeight: options.screenHeight,
        });
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        failures.push({ materialPath, outputPngPath, error: normalizedError });
      }
    });
  } finally {
    await adapter.shutdown();
  }

  return {
    adapterName: adapter.name,
    rendered: materialFiles.length - failures.length,
    failures,
  };
}
