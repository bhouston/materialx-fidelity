import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { createReferences } from './references.js';
import type { FidelityRenderer } from './types.js';

const tempDirs: string[] = [];

function createSolidPngBase64(red: number, green: number, blue: number, alpha = 255): string {
  const png = new PNG({ width: 1, height: 1 });
  png.data[0] = red;
  png.data[1] = green;
  png.data[2] = blue;
  png.data[3] = alpha;
  return PNG.sync.write(png).toString('base64');
}

const NON_BLACK_PIXEL_PNG_BASE64 = createSolidPngBase64(255, 0, 0);
const BLACK_PIXEL_PNG_BASE64 = createSolidPngBase64(0, 0, 0);
const VALID_MTLX_DOCUMENT = '<materialx version="1.39"></materialx>';

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createPngWriterRenderer(base64Png: string, rendererName = 'fake'): FidelityRenderer {
  return {
    name: rendererName,
    version: '0.0.1',
    async checkPrerequisites() {
      return { success: true };
    },
    async start() {},
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, Buffer.from(base64Png, 'base64'));
    },
  };
}

function createFailingPrerequisiteRenderer(rendererName = 'fake'): FidelityRenderer {
  return {
    name: rendererName,
    version: '0.0.1',
    async checkPrerequisites() {
      return { success: false, message: 'Missing fake prerequisite.' };
    },
    async start() {},
    async shutdown() {},
    async generateImage() {},
  };
}

function createTrackingRenderer(base64Png: string, rendererName = 'fake') {
  const state = {
    started: false,
    startCalls: 0,
  };
  const renderer: FidelityRenderer = {
    name: rendererName,
    version: '0.0.1',
    async checkPrerequisites() {
      return { success: true };
    },
    async start() {
      state.started = true;
      state.startCalls += 1;
    },
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, Buffer.from(base64Png, 'base64'));
    },
  };
  return { renderer, state };
}

function createAdapterModulePngWriter(base64Png: string, adapterName = 'fake'): string {
  return `
import { writeFile } from 'node:fs/promises';
export function createAdapter() {
  return {
    name: '${adapterName}',
    version: '0.0.1',
    async checkPrerequisites() { return { success: true }; },
    async start() {},
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, Buffer.from('${base64Png}', 'base64'));
    },
  };
}
`;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('createReferences', () => {
  it('renders a webp named after the adapter beside each material', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const result = await createReferences({
      thirdPartyRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
    });

    const outputWebpPath = path.join(materialDir, 'fake.webp');
    await access(outputWebpPath);
    await expect(access(path.join(materialDir, 'fake.png'))).rejects.toThrow('ENOENT');
    expect(result.rendererNames).toEqual(['fake']);
    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(result.stopped).toBe(false);
  });

  it('requires the expected viewer hdr and mesh filenames', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'other_env.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'other_mesh.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      `
export function createAdapter() {
  return {
    name: 'fake',
    version: '0.0.1',
    async checkPrerequisites() { return { success: true }; },
    async start() {},
    async shutdown() {},
    async generateImage() {},
  };
}
`,
      'utf8',
    );

    await expect(
      createReferences({
        thirdPartyRoot,
        renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('Missing required viewer assets');
  });

  it('applies materialSelectors to material paths', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');
    const includedDir = path.join(samplesRoot, 'materials', 'standard_surface', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(includedDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(skippedDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const result = await createReferences({
      thirdPartyRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
      materialSelectors: ['included'],
    });

    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    await expect(access(path.join(includedDir, 'fake.webp'))).resolves.toBeUndefined();
    await expect(access(path.join(skippedDir, 'fake.webp'))).rejects.toThrow('ENOENT');
  });

  it('supports regex material selectors', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');
    const includedDir = path.join(samplesRoot, 'materials', 'gltf_pbr', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(includedDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(skippedDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const result = await createReferences({
      thirdPartyRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
      materialSelectors: ['/gltf_pbr/i'],
    });

    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    await expect(access(path.join(includedDir, 'fake.webp'))).resolves.toBeUndefined();
    await expect(access(path.join(skippedDir, 'fake.webp'))).rejects.toThrow('ENOENT');
  });

  it('emits progress events with adapter names for each render task', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');
    const materialOneDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-one');
    const materialTwoDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-two');

    await mkdir(materialOneDir, { recursive: true });
    await mkdir(materialTwoDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialOneDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(materialTwoDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const events: Array<{ phase: string; rendererName: string }> = [];
    const result = await createReferences({
      thirdPartyRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 1,
      onProgress: (event) => {
        events.push({ phase: event.phase, rendererName: event.rendererName });
      },
    });

    expect(result.rendered).toBe(2);
    expect(events).toHaveLength(4);
    expect(events.filter((event) => event.phase === 'start')).toHaveLength(2);
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(2);
    expect(events.every((event) => event.rendererName === 'fake')).toBe(true);
  });

  it('defaults to all renderers when rendererNames is omitted', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const fakeAdapterDir = path.join(root, 'adapters', 'fake');
    const altAdapterDir = path.join(root, 'adapters', 'alt');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(fakeAdapterDir, 'dist'), { recursive: true });
    await mkdir(path.join(altAdapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(fakeAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(fakeAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-alt', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      'utf8',
    );

    const result = await createReferences({
      thirdPartyRoot,
      renderers: [
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      ],
      concurrency: 1,
    });

    await expect(access(path.join(materialDir, 'fake.webp'))).resolves.toBeUndefined();
    await expect(access(path.join(materialDir, 'alt.webp'))).resolves.toBeUndefined();
    expect(result.rendererNames.toSorted()).toEqual(['alt', 'fake']);
    expect(result.total).toBe(2);
    expect(result.rendered).toBe(2);
  });

  it('queues renders in material-first then adapter order', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const firstMaterialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-one');
    const secondMaterialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-two');
    const fakeAdapterDir = path.join(root, 'adapters', 'fake');
    const altAdapterDir = path.join(root, 'adapters', 'alt');

    await mkdir(firstMaterialDir, { recursive: true });
    await mkdir(secondMaterialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(fakeAdapterDir, 'dist'), { recursive: true });
    await mkdir(path.join(altAdapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(firstMaterialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(secondMaterialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(fakeAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(fakeAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-alt', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      'utf8',
    );

    const startEvents: Array<{ materialPath: string; rendererName: string }> = [];
    await createReferences({
      thirdPartyRoot,
      renderers: [
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      ],
      rendererNames: ['fake', 'alt'],
      concurrency: 1,
      onProgress: (event) => {
        if (event.phase === 'start') {
          startEvents.push({ materialPath: event.materialPath, rendererName: event.rendererName });
        }
      },
    });

    expect(startEvents).toHaveLength(4);
    expect(startEvents[0]?.rendererName).toBe('fake');
    expect(startEvents[1]?.rendererName).toBe('alt');
    expect(startEvents[0]?.materialPath).toBe(startEvents[1]?.materialPath);
    expect(startEvents[2]?.rendererName).toBe('fake');
    expect(startEvents[3]?.rendererName).toBe('alt');
    expect(startEvents[2]?.materialPath).toBe(startEvents[3]?.materialPath);
    expect(startEvents[0]?.materialPath).not.toBe(startEvents[2]?.materialPath);
  });

  it('deletes all-black renders and marks them as empty failures', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(path.join(adapterDir, 'dist/index.js'), createAdapterModulePngWriter(BLACK_PIXEL_PNG_BASE64), 'utf8');

    const result = await createReferences({
      thirdPartyRoot,
      renderers: [createPngWriterRenderer(BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    const outputPngPath = path.join(materialDir, 'fake.png');
    await expect(access(outputPngPath)).rejects.toThrow('ENOENT');
    await expect(access(path.join(materialDir, 'fake.webp'))).rejects.toThrow('ENOENT');
    expect(result.rendered).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rendererName).toBe('fake');
    expect(result.failures[0]?.error.message).toContain('Render output is empty');
  });

  it('fails early when materialx-samples directory is missing', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');

    await mkdir(path.join(root, 'adapters'), { recursive: true });

    await expect(
      createReferences({
        thirdPartyRoot,
        renderers: [],
        concurrency: 1,
      }),
    ).rejects.toThrow('Missing required materialx-samples directory');
  });

  it('fails early when an adapter prerequisite check fails', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      `
export function createAdapter() {
  return {
    name: 'fake',
    version: '0.0.1',
    async checkPrerequisites() {
      return { success: false, message: 'Missing fake prerequisite.' };
    },
    async start() {},
    async shutdown() {},
    async generateImage() {},
  };
}
`,
      'utf8',
    );

    await expect(
      createReferences({
        thirdPartyRoot,
        renderers: [createFailingPrerequisiteRenderer('fake')],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('Renderer prerequisites are not met');
  });

  it('fails before renderer start when material xml is malformed', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'broken');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const { renderer, state } = createTrackingRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(path.join(materialDir, 'material.mtlx'), '<materialx version="1.39">', 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    await expect(
      createReferences({
        thirdPartyRoot,
        renderers: [renderer],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('MaterialX pre-render validation failed');
    expect(state.startCalls).toBe(0);
    expect(state.started).toBe(false);
  });

  it('fails before renderer start when unsupported nodes are present', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'unsupported');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const { renderer, state } = createTrackingRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(
      path.join(materialDir, 'material.mtlx'),
      '<materialx version="1.39"><totally_unknown_node name="mystery" /></materialx>',
      'utf8',
    );
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    await expect(
      createReferences({
        thirdPartyRoot,
        renderers: [renderer],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('Unknown node category');
    expect(state.startCalls).toBe(0);
    expect(state.started).toBe(false);
  });

  it('fails before renderer start when a referenced texture file is missing', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'missing-texture');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const { renderer, state } = createTrackingRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(
      path.join(materialDir, 'material.mtlx'),
      [
        '<materialx version="1.39">',
        '  <image name="albedo" type="color3">',
        '    <input name="file" type="filename" value="textures/albedo.png" />',
        '  </image>',
        '</materialx>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    await expect(
      createReferences({
        thirdPartyRoot,
        renderers: [renderer],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('Missing texture file');
    expect(state.startCalls).toBe(0);
    expect(state.started).toBe(false);
  });

  it('continues rendering and writes warnings for URI texture references', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'materialx-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'uri-texture');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(
      path.join(materialDir, 'material.mtlx'),
      [
        '<materialx version="1.39">',
        '  <image name="albedo" type="color3">',
        '    <input name="file" type="filename" value="https://example.com/albedo.png" />',
        '  </image>',
        '</materialx>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    try {
      const result = await createReferences({
        thirdPartyRoot,
        renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
        rendererNames: ['fake'],
        concurrency: 1,
      });

      expect(result.rendered).toBe(1);
      expect(result.failures).toHaveLength(0);
      expect(stderrSpy).toHaveBeenCalled();
      const warningOutput = stderrSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(warningOutput).toContain('Skipping texture existence check for URI');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
