import { access, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type GenerateImageResult,
  type RenderLogEntry,
  type RendererContext,
  type RendererPrerequisiteCheckResult,
} from '@material-fidelity/core';

interface RuntimeState {
  baseUrl: string;
  browser: Browser;
  context: BrowserContext;
  server: ViteDevServer;
}

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';
const VIEWER_ENVIRONMENT_ROTATION_DEGREES = -90;
const GPU_BROWSER_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgpu', '--enable-unsafe-webgpu'];
const POST_IDLE_DELAY_MS = 150;
const POST_IDLE_RENDER_PASSES = 3;

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

async function renderAdditionalFrames(page: Page, passes: number): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await page.evaluate(() => {
      const forceRenderCandidate = Reflect.get(globalThis, '__MTLX_FORCE_RENDER__');
      const forceRender = typeof forceRenderCandidate === 'function' ? forceRenderCandidate : undefined;
      forceRender?.();
    });
    await page.waitForTimeout(16);
  }
}

async function disposePageScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const disposeCandidate = Reflect.get(globalThis, '__MTLX_DISPOSE_SCENE__');
    const disposeScene = typeof disposeCandidate === 'function' ? disposeCandidate : undefined;
    disposeScene?.();
    Reflect.deleteProperty(globalThis, '__MTLX_DISPOSE_SCENE__');
    Reflect.set(globalThis, '__MTLX_FORCE_RENDER__', undefined);
  });
}

function toLogLevel(type: string): RenderLogEntry['level'] {
  if (type === 'error') return 'error';
  if (type === 'warning') return 'warning';
  if (type === 'debug') return 'debug';
  return 'info';
}

function createRenderError(message: string, logs: RenderLogEntry[]): Error & { rendererLogs: RenderLogEntry[] } {
  const error = new Error(message) as Error & { rendererLogs: RenderLogEntry[] };
  error.rendererLogs = logs;
  return error;
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
  public readonly category = 'rasterizer';
  public readonly emptyReferenceImagePath: string;
  private readonly thirdPartyRoot: string;
  private prerequisitesValidated = false;
  private runtimeState: RuntimeState | undefined;

  public constructor(context: RendererContext) {
    this.thirdPartyRoot = context.thirdPartyRoot;
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    this.emptyReferenceImagePath = join(packageRoot, 'threejs-empty.png');
  }

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    if (this.prerequisitesValidated) {
      return { success: true };
    }

    try {
      const samplesRoot = join(this.thirdPartyRoot, 'material-samples');
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

    const samplesRoot = join(this.thirdPartyRoot, 'material-samples');
    const viewerRoot = join(samplesRoot, 'viewer');
    const envPath = join(viewerRoot, VIEWER_HDR_FILENAME);
    const modelPath = join(viewerRoot, VIEWER_MODEL_FILENAME);

    await Promise.all([assertFileExists(envPath), assertFileExists(modelPath)]);

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

  public async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.runtimeState) {
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const page = await this.runtimeState.context.newPage();
    const logs: RenderLogEntry[] = [];
    let browserError: Error | undefined;
    let resolveBrowserError: (() => void) | undefined;
    const browserErrorSignal = new Promise<void>((resolve) => {
      resolveBrowserError = resolve;
    });
    const recordBrowserError = (message: string): void => {
      if (browserError) {
        return;
      }
      browserError = createRenderError(message, logs);
      resolveBrowserError?.();
    };
    const onConsole = (message: ConsoleMessage): void => {
      const level = toLogLevel(message.type());
      logs.push({
        level,
        source: 'browser',
        message: message.text(),
      });
      if (level === 'error') {
        recordBrowserError(`Browser console error: ${message.text()}`);
      }
    };
    const onPageError = (error: Error): void => {
      logs.push({
        level: 'error',
        source: 'browser',
        message: error.message,
      });
      recordBrowserError(`Browser page error: ${error.message}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    try {
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
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
      await Promise.race([
        page.waitForFunction(() => Reflect.get(globalThis, '__MTLX_CAPTURE_DONE__') === true, undefined, {
          timeout: 60_000,
        }),
        browserErrorSignal,
      ]);

      const renderError = await readGlobalError(page);
      if (renderError) {
        throw createRenderError(renderError, logs);
      }
      if (browserError) {
        throw browserError;
      }
      await page.waitForTimeout(POST_IDLE_DELAY_MS);
      await renderAdditionalFrames(page, POST_IDLE_RENDER_PASSES);

      const postIdleRenderError = await readGlobalError(page);
      if (postIdleRenderError) {
        throw createRenderError(postIdleRenderError, logs);
      }
      if (browserError) {
        throw browserError;
      }

      await page.screenshot({
        path: options.outputPngPath,
        type: 'png',
      });
      return { logs };
    } catch (error) {
      if (error && typeof error === 'object' && 'rendererLogs' in error) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw createRenderError(message, logs);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      await Promise.allSettled([disposePageScene(page)]);
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
