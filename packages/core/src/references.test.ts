import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createReferences } from './references.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('createReferences', () => {
  it('renders a png named after the adapter beside each material', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'MaterialX-Samples');
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
      JSON.stringify({ name: '@test/fake-adapter', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      `
import { writeFile } from 'node:fs/promises';
export function createAdapter() {
  return {
    name: 'fake',
    version: '0.0.1',
    async start() {},
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, 'png');
    },
  };
}
`,
      'utf8',
    );

    const result = await createReferences({
      adaptersRoot,
      thirdPartyRoot,
      adapterName: 'fake',
      concurrency: 2,
      backgroundColor: '0,0,0',
      screenWidth: 512,
      screenHeight: 512,
    });

    const outputPngPath = path.join(materialDir, 'fake.png');
    await access(outputPngPath);
    const outputData = await readFile(outputPngPath, 'utf8');

    expect(outputData).toBe('png');
    expect(result.adapterName).toBe('fake');
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('requires the expected viewer hdr and mesh filenames', async () => {
    const root = await makeTempDir('fidelity-');
    const thirdPartyRoot = path.join(root, 'third-party');
    const samplesRoot = path.join(thirdPartyRoot, 'MaterialX-Samples');
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
      JSON.stringify({ name: '@test/fake-adapter', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      `
export function createAdapter() {
  return {
    name: 'fake',
    version: '0.0.1',
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
        adaptersRoot,
        thirdPartyRoot,
        adapterName: 'fake',
        concurrency: 1,
        backgroundColor: '0,0,0',
        screenWidth: 512,
        screenHeight: 512,
      }),
    ).rejects.toThrow('Missing required viewer assets');
  });
});
