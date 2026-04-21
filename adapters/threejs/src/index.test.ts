import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAdapter } from './index.js';

const { createServerMock, launchMock } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  launchMock: vi.fn(),
}));

vi.mock('vite', () => ({
  createServer: createServerMock,
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: launchMock,
  },
}));

vi.mock('@vitejs/plugin-react', () => ({
  default: () => ({ name: 'react-test-plugin' }),
}));

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function createFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'x', 'utf8');
}

beforeEach(() => {
  createServerMock.mockReset();
  launchMock.mockReset();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })));
});

describe('threejs adapter', () => {
  it('creates a new page for each render and closes it', async () => {
    const thirdPartyRoot = await makeTempDir('third-party-');
    const samplesRoot = path.join(thirdPartyRoot, 'MaterialX-Samples');
    const viewerRoot = path.join(samplesRoot, 'viewer');

    await createFile(path.join(thirdPartyRoot, 'three.js', 'build', 'three.webgpu.js'));
    await createFile(path.join(thirdPartyRoot, 'three.js', 'build', 'three.tsl.js'));
    await createFile(path.join(thirdPartyRoot, 'three.js', 'examples', 'jsm', 'loaders', 'MaterialXLoader.js'));
    await createFile(path.join(thirdPartyRoot, 'three.js', 'examples', 'jsm', 'loaders', 'GLTFLoader.js'));
    await createFile(path.join(thirdPartyRoot, 'three.js', 'examples', 'jsm', 'loaders', 'HDRLoader.js'));
    await createFile(path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'));
    await createFile(path.join(viewerRoot, 'ShaderBall.glb'));

    const server = {
      listen: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      resolvedUrls: { local: ['http://127.0.0.1:4173/'], network: [] },
    };
    createServerMock.mockResolvedValue(server);

    const firstPage = {
      setViewportSize: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const secondPage = {
      setViewportSize: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    const browserContext = {
      newPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
      close: vi.fn(async () => undefined),
    };
    const browser = {
      newContext: vi.fn(async () => browserContext),
      close: vi.fn(async () => undefined),
    };
    launchMock.mockResolvedValue(browser);

    const adapter = createAdapter({ thirdPartyRoot });
    await adapter.start();

    const materialPath = path.join(samplesRoot, 'materials', 'example', 'material.mtlx');
    const outputOne = path.join(samplesRoot, 'materials', 'example', 'one.png');
    const outputTwo = path.join(samplesRoot, 'materials', 'example', 'two.png');
    await createFile(materialPath);

    await adapter.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputOne,
      modelPath: path.join(viewerRoot, 'ShaderBall.glb'),
      environmentHdrPath: path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
      screenWidth: 512,
      screenHeight: 512,
    });
    await adapter.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputTwo,
      modelPath: path.join(viewerRoot, 'ShaderBall.glb'),
      environmentHdrPath: path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
      screenWidth: 512,
      screenHeight: 512,
    });

    expect(browserContext.newPage).toHaveBeenCalledTimes(2);
    expect(firstPage.close).toHaveBeenCalledTimes(1);
    expect(secondPage.close).toHaveBeenCalledTimes(1);

    await adapter.shutdown();
    expect(browserContext.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
