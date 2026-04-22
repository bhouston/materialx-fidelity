import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRenderer } from './index.js';

type AsyncUnknownFn = (...args: unknown[]) => Promise<unknown>;

const { createServerMock, launchMock } = vi.hoisted(() => ({
  createServerMock: vi.fn<AsyncUnknownFn>(),
  launchMock: vi.fn<AsyncUnknownFn>(),
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

describe('materialxjs renderer', () => {
  it('creates a new page for each render and closes it', async () => {
    const thirdPartyRoot = await makeTempDir('third-party-');
    await createFile(path.join(thirdPartyRoot, 'materialx.js', 'README.md'));

    const server = {
      listen: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
      resolvedUrls: { local: ['http://127.0.0.1:4173/'], network: [] },
    };
    createServerMock.mockResolvedValue(server);

    const firstPage = {
      setViewportSize: vi.fn<() => Promise<void>>(async () => undefined),
      goto: vi.fn<() => Promise<void>>(async () => undefined),
      waitForFunction: vi.fn<() => Promise<void>>(async () => undefined),
      evaluate: vi.fn<() => Promise<void>>(async () => undefined),
      screenshot: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const secondPage = {
      setViewportSize: vi.fn<() => Promise<void>>(async () => undefined),
      goto: vi.fn<() => Promise<void>>(async () => undefined),
      waitForFunction: vi.fn<() => Promise<void>>(async () => undefined),
      evaluate: vi.fn<() => Promise<void>>(async () => undefined),
      screenshot: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };

    let pageCallCount = 0;
    const browserContext = {
      newPage: vi.fn<() => Promise<typeof firstPage>>(async () => {
        pageCallCount += 1;
        return pageCallCount === 1 ? firstPage : secondPage;
      }),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const probeBrowser = {
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const browser = {
      newContext: vi.fn<() => Promise<typeof browserContext>>(async () => browserContext),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    launchMock.mockResolvedValueOnce(probeBrowser).mockResolvedValueOnce(browser);

    const renderer = createRenderer({ thirdPartyRoot });
    await renderer.start();

    const materialPath = path.join(thirdPartyRoot, 'materialx-samples', 'materials', 'example', 'material.mtlx');
    const outputOne = path.join(thirdPartyRoot, 'materialx-samples', 'materials', 'example', 'one.png');
    const outputTwo = path.join(thirdPartyRoot, 'materialx-samples', 'materials', 'example', 'two.png');
    await createFile(materialPath);

    await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputOne,
      modelPath: path.join(thirdPartyRoot, 'materialx-samples', 'viewer', 'ShaderBall.glb'),
      environmentHdrPath: path.join(thirdPartyRoot, 'materialx-samples', 'viewer', 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
    });
    await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputTwo,
      modelPath: path.join(thirdPartyRoot, 'materialx-samples', 'viewer', 'ShaderBall.glb'),
      environmentHdrPath: path.join(thirdPartyRoot, 'materialx-samples', 'viewer', 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
    });

    expect(browserContext.newPage).toHaveBeenCalledTimes(2);
    expect(firstPage.close).toHaveBeenCalledTimes(1);
    expect(secondPage.close).toHaveBeenCalledTimes(1);

    await renderer.shutdown();
    expect(browserContext.close).toHaveBeenCalledTimes(1);
    expect(probeBrowser.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
