import { afterEach, describe, expect, it } from 'vitest';
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
    const adaptersRoot = path.join(root, 'adapters');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');
    const includedDir = path.join(samplesRoot, 'materials', 'standard_surface', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(includedDir, 'material.mtlx'), '<material />', 'utf8');
    await writeFile(path.join(skippedDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');
    const includedDir = path.join(samplesRoot, 'materials', 'gltf_pbr', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(includedDir, 'material.mtlx'), '<material />', 'utf8');
    await writeFile(path.join(skippedDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');
    const materialOneDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-one');
    const materialTwoDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-two');

    await mkdir(materialOneDir, { recursive: true });
    await mkdir(materialTwoDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialOneDir, 'material.mtlx'), '<material />', 'utf8');
    await writeFile(path.join(materialTwoDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const fakeAdapterDir = path.join(adaptersRoot, 'fake');
    const altAdapterDir = path.join(adaptersRoot, 'alt');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(fakeAdapterDir, 'dist'), { recursive: true });
    await mkdir(path.join(altAdapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const firstMaterialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-one');
    const secondMaterialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'mat-two');
    const fakeAdapterDir = path.join(adaptersRoot, 'fake');
    const altAdapterDir = path.join(adaptersRoot, 'alt');

    await mkdir(firstMaterialDir, { recursive: true });
    await mkdir(secondMaterialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(fakeAdapterDir, 'dist'), { recursive: true });
    await mkdir(path.join(altAdapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(firstMaterialDir, 'material.mtlx'), '<material />', 'utf8');
    await writeFile(path.join(secondMaterialDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), '<material />', 'utf8');
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
    const adaptersRoot = path.join(root, 'adapters');

    await mkdir(adaptersRoot, { recursive: true });

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
    const adaptersRoot = path.join(root, 'adapters');
    const materialDir = path.join(samplesRoot, 'materials', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(adaptersRoot, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(path.join(materialDir, 'material.mtlx'), '<material />', 'utf8');
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
});
