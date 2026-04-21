import { access, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { AdapterContext, FidelityAdapter, GenerateImageOptions } from '@mtlx-fidelity/core';

interface RuntimeState {
  baseUrl: string;
  browser: Browser;
  context: BrowserContext;
  server: ViteDevServer;
}

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';

function toFsUrlPath(absolutePath: string): string {
  return `/@fs/${absolutePath.replaceAll('\\', '/')}`;
}

async function assertFileExists(filePath: string): Promise<void> {
  await access(filePath);
}

async function resolveThreeRoot(thirdPartyRoot: string): Promise<string> {
  const candidates = [join(thirdPartyRoot, 'three.js'), join(thirdPartyRoot, 'threejs')];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }

  throw new Error(`Unable to locate Three.js root under ${thirdPartyRoot}. Tried: ${candidates.join(', ')}`);
}

function readGlobalError(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const value = Reflect.get(globalThis, '__MTLX_CAPTURE_ERROR__');
    return typeof value === 'string' ? value : undefined;
  });
}

class ThreeJsAdapter implements FidelityAdapter {
  public readonly name = 'threejs';
  public readonly version = '0.1.0';
  private readonly thirdPartyRoot: string;
  private runtimeState: RuntimeState | undefined;

  public constructor(context: AdapterContext) {
    this.thirdPartyRoot = context.thirdPartyRoot;
  }

  public async start(): Promise<void> {
    if (this.runtimeState) {
      return;
    }

    const threeRoot = await resolveThreeRoot(this.thirdPartyRoot);
    const samplesRoot = join(this.thirdPartyRoot, 'MaterialX-Samples');
    const viewerRoot = join(samplesRoot, 'viewer');

    const threeWebGpuPath = join(threeRoot, 'build', 'three.webgpu.js');
    const threeTslPath = join(threeRoot, 'build', 'three.tsl.js');
    const materialXLoaderPath = join(threeRoot, 'examples', 'jsm', 'loaders', 'MaterialXLoader.js');
    const gltfLoaderPath = join(threeRoot, 'examples', 'jsm', 'loaders', 'GLTFLoader.js');
    const hdrLoaderPath = join(threeRoot, 'examples', 'jsm', 'loaders', 'HDRLoader.js');
    const envPath = join(viewerRoot, VIEWER_HDR_FILENAME);
    const modelPath = join(viewerRoot, VIEWER_MODEL_FILENAME);

    await Promise.all([
      assertFileExists(threeWebGpuPath),
      assertFileExists(threeTslPath),
      assertFileExists(materialXLoaderPath),
      assertFileExists(gltfLoaderPath),
      assertFileExists(hdrLoaderPath),
      assertFileExists(envPath),
      assertFileExists(modelPath),
    ]);

    const viewerAppRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
    const server = await createServer({
      appType: 'spa',
      root: viewerAppRoot,
      logLevel: 'error',
      plugins: [react()],
      resolve: {
        alias: [
          {
            find: 'three/webgpu',
            replacement: threeWebGpuPath,
          },
          {
            find: 'three/tsl',
            replacement: threeTslPath,
          },
          {
            find: 'three/addons/',
            replacement: `${join(threeRoot, 'examples', 'jsm').replaceAll('\\', '/')}/`,
          },
          {
            find: 'three',
            replacement: threeWebGpuPath,
          },
        ],
      },
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        fs: {
          allow: [viewerAppRoot, this.thirdPartyRoot],
        },
      },
    });

    await server.listen();
    const baseUrl = server.resolvedUrls?.local.at(0);
    if (!baseUrl) {
      await server.close();
      throw new Error('Unable to resolve the Three.js viewer server URL.');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 512, height: 512 },
      deviceScaleFactor: 1,
    });

    this.runtimeState = {
      baseUrl,
      browser,
      context,
      server,
    };
  }

  public async shutdown(): Promise<void> {
    if (!this.runtimeState) {
      return;
    }

    const { context, browser, server } = this.runtimeState;
    this.runtimeState = undefined;
    await Promise.allSettled([context.close(), browser.close(), server.close()]);
  }

  public async generateImage(options: GenerateImageOptions): Promise<void> {
    if (!this.runtimeState) {
      throw new Error('Adapter has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const page = await this.runtimeState.context.newPage();
    try {
      await page.setViewportSize({
        width: options.screenWidth,
        height: options.screenHeight,
      });

      const url = new URL('/index.html', this.runtimeState.baseUrl);
      url.searchParams.set('mtlxPath', toFsUrlPath(options.mtlxPath));
      url.searchParams.set('modelPath', toFsUrlPath(options.modelPath));
      url.searchParams.set('environmentHdrPath', toFsUrlPath(options.environmentHdrPath));
      url.searchParams.set('backgroundColor', options.backgroundColor);
      url.searchParams.set('screenWidth', String(options.screenWidth));
      url.searchParams.set('screenHeight', String(options.screenHeight));

      await page.goto(url.toString(), { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Reflect.get(globalThis, '__MTLX_CAPTURE_DONE__') === true, undefined, {
        timeout: 60_000,
      });

      const renderError = await readGlobalError(page);
      if (renderError) {
        throw new Error(renderError);
      }

      await page.screenshot({
        path: options.outputPngPath,
        type: 'png',
      });
    } finally {
      await page.close();
    }
  }
}

export function createAdapter(context?: AdapterContext): FidelityAdapter {
  if (!context) {
    throw new Error('ThreeJS adapter requires adapter context with thirdPartyRoot.');
  }

  return new ThreeJsAdapter(context);
}
