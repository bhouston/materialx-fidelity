import { dirname, extname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type GenerateImageResult,
  type RenderLogEntry,
  type RendererPrerequisiteCheckResult,
} from '@materialx-fidelity/core';

const EXECUTABLE_CANDIDATES = ['materialxview', 'MaterialXView'];
const MATERIALXVIEW_SEARCH_PATH_ENV = 'MATERIALXVIEW_SEARCH_PATH';

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--help'], {
    stdio: 'ignore',
    timeout: 3000,
    shell: false,
  });

  return !result.error;
}

function resolveExecutable(): string {
  const match = EXECUTABLE_CANDIDATES.find((candidate) => commandExists(candidate));
  if (!match) {
    throw new Error(
      `Unable to locate materialx viewer executable on PATH. Tried: ${EXECUTABLE_CANDIDATES.join(', ')}.`,
    );
  }

  return match;
}

function createRenderError(message: string, logs: RenderLogEntry[]): Error & { rendererLogs: RenderLogEntry[] } {
  const error = new Error(message) as Error & { rendererLogs: RenderLogEntry[] };
  error.rendererLogs = logs;
  return error;
}

function execute(executable: string, args: string[]): Promise<RenderLogEntry[]> {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const logs: RenderLogEntry[] = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const flushBufferedLines = (buffer: string, level: RenderLogEntry['level']): string => {
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      for (const line of lines) {
        const message = line.trim();
        if (!message) {
          continue;
        }
        logs.push({ level, source: 'renderer', message });
      }
      return remainder;
    };

    processHandle.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = flushBufferedLines(stdoutBuffer, 'info');
    });
    processHandle.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      stderrBuffer = flushBufferedLines(stderrBuffer, 'warning');
    });

    processHandle.on('error', (error) => {
      reject(createRenderError(error.message, logs));
    });

    processHandle.on('close', (code) => {
      stdoutBuffer = flushBufferedLines(`${stdoutBuffer}\n`, 'info');
      stderrBuffer = flushBufferedLines(`${stderrBuffer}\n`, 'warning');

      if (code === 0) {
        resolve(logs);
        return;
      }

      const message =
        logs.at(-1)?.message ||
        `materialxview exited with code ${String(code)}${code === null ? ' (terminated by signal)' : ''}.`;
      reject(createRenderError(message, logs));
    });
  });
}

class MaterialXViewRenderer implements FidelityRenderer {
  public readonly name = 'materialxview';
  public readonly version = '1.0.0';
  public readonly category = 'raytracer';
  public readonly emptyReferenceImagePath = fileURLToPath(new URL('../materialxview-empty.png', import.meta.url));
  private executable: string | undefined;

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    try {
      this.executable = resolveExecutable();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  public async start(): Promise<void> {
    if (this.executable) {
      return;
    }

    const checkResult = await this.checkPrerequisites();
    if (!checkResult.success) {
      throw new Error(checkResult.message ?? 'MaterialXView prerequisites are not satisfied.');
    }
  }

  public async shutdown(): Promise<void> {}

  public async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.executable) {
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const args = [
      '--material',
      options.mtlxPath,
      '--mesh',
      options.modelPath,
      '--envRad',
      options.environmentHdrPath,
      '--drawEnvironment',
      'true',
      '--screenColor',
      options.backgroundColor,
      '--screenWidth',
      String(REFERENCE_IMAGE_WIDTH),
      '--screenHeight',
      String(REFERENCE_IMAGE_HEIGHT),
      '--enableDirectLight',
      'false',
      '--shadowMap',
      'false',
      '--captureFilename',
      options.outputPngPath,
    ];

    const additionalSearchPath = process.env[MATERIALXVIEW_SEARCH_PATH_ENV]?.trim();
    if (additionalSearchPath) {
      args.push('--path', additionalSearchPath);
    }

    const logs = await execute(this.executable, args);
    return { logs };
  }
}

export function createRenderer(): FidelityRenderer {
  return new MaterialXViewRenderer();
}
