import { access, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type RendererContext,
  type RendererPrerequisiteCheckResult,
} from '@materialx-fidelity/core';

interface RuntimeState {
  baseUrl: string;
  browser: Browser;
  context: BrowserContext;
  server: ViteDevServer;
}

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';
const VIEWER_ENVIRONMENT_ROTATION_DEGREES = -90;
const GPU_BROWSER_ARGS = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-webgpu',
  '--enable-unsafe-webgpu',
];

function toFsUrlPath(absolutePath: string): string {
  return `/@fs/${absolutePath.replaceAll('\\', '/')}`;
}

async function assertFileExists(filePath: string): Promise<void> {
  await access(filePath);
}

async function findMissingFiles(filePaths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const filePath of filePaths) {
    try {
      await access(filePath);
    } catch {
      missing.push(filePath);
    }
  }
  return missing;
}

function readGlobalError(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const value = Reflect.get(globalThis, '__MTLX_CAPTURE_ERROR__');
    return typeof value === 'string' ? value : undefined;
  });
}

function buildGpuBrowserArgs(): string[] {
  if (process.platform === 'darwin') {
    return [...GPU_BROWSER_ARGS, '--use-angle=metal'];
  }

  return GPU_BROWSER_ARGS;
}

async function launchGpuBrowser(): Promise<Browser> {
  const args = buildGpuBrowserArgs();

  try {
    // Prefer the system Chrome channel for better hardware acceleration support.
    return await chromium.launch({
      channel: 'chrome',
      headless: true,
      args,
    });
  } catch {
    // Fallback to bundled Chromium if Chrome channel is not available.
    return chromium.launch({
      headless: true,
      args,
    });
  }
}

class ThreeJsRenderer implements FidelityRenderer {
  public readonly name = 'threejs';
  public readonly version = '0.1.0';
  private readonly thirdPartyRoot: string;
  private prerequisitesValidated = false;
  private runtimeState: RuntimeState | undefined;

  public constructor(context: RendererContext) {
    this.thirdPartyRoot = context.thirdPartyRoot;
  }

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    if (this.prerequisitesValidated) {
      return { success: true };
    }

    try {
      const samplesRoot = join(this.thirdPartyRoot, 'materialx-samples');
      const viewerRoot = join(samplesRoot, 'viewer');
      const missingFiles = await findMissingFiles([
        join(viewerRoot, VIEWER_HDR_FILENAME),
        join(viewerRoot, VIEWER_MODEL_FILENAME),
      ]);
      if (missingFiles.length > 0) {
        return { success: false, message: `Missing required viewer assets: ${missingFiles.join(', ')}` };
      }

      const browser = await launchGpuBrowser();
      await browser.close();
      this.prerequisitesValidated = true;
      return { success: true };
    } catch (error) {
      this.prerequisitesValidated = false;
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  public async start(): Promise<void> {
    if (this.runtimeState) {
      return;
    }

    if (!this.prerequisitesValidated) {
      const checkResult = await this.checkPrerequisites();
      if (!checkResult.success) {
        throw new Error(checkResult.message ?? 'Three.js prerequisites are not satisfied.');
      }
    }

    const samplesRoot = join(this.thirdPartyRoot, 'materialx-samples');
    const viewerRoot = join(samplesRoot, 'viewer');
    const envPath = join(viewerRoot, VIEWER_HDR_FILENAME);
    const modelPath = join(viewerRoot, VIEWER_MODEL_FILENAME);

    await Promise.all([
      assertFileExists(envPath),
      assertFileExists(modelPath),
    ]);

    const viewerAppRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
    const server = await createServer({
      appType: 'spa',
      root: viewerAppRoot,
      logLevel: 'error',
      plugins: [react()],
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

    const browser = await launchGpuBrowser();
    const context = await browser.newContext({
      viewport: { width: REFERENCE_IMAGE_WIDTH, height: REFERENCE_IMAGE_HEIGHT },
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
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const page = await this.runtimeState.context.newPage();
    try {
      await page.setViewportSize({
        width: REFERENCE_IMAGE_WIDTH,
        height: REFERENCE_IMAGE_HEIGHT,
      });

      const url = new URL('/index.html', this.runtimeState.baseUrl);
      url.searchParams.set('mtlxPath', toFsUrlPath(options.mtlxPath));
      url.searchParams.set('modelPath', toFsUrlPath(options.modelPath));
      url.searchParams.set('environmentHdrPath', toFsUrlPath(options.environmentHdrPath));
      url.searchParams.set('environmentRotationDegrees', String(VIEWER_ENVIRONMENT_ROTATION_DEGREES));
      url.searchParams.set('backgroundColor', options.backgroundColor);

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

export function createRenderer(context?: RendererContext): FidelityRenderer {
  if (!context) {
    throw new Error('ThreeJS renderer requires renderer context with thirdPartyRoot.');
  }

  return new ThreeJsRenderer(context);
}
