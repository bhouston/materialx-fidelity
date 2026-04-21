import { dirname, extname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type RendererPrerequisiteCheckResult,
} from '@materialx-fidelity/core';

const EXECUTABLE_CANDIDATES = ['materialxview', 'MaterialXView'];

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

function execute(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    processHandle.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    processHandle.on('error', (error) => {
      reject(error);
    });

    processHandle.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = stderr.trim() || `Process exited with code ${String(code)}.`;
      reject(new Error(message));
    });
  });
}

class MaterialXViewRenderer implements FidelityRenderer {
  public readonly name = 'materialxview';
  public readonly version = '1.0.0';
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

  public async generateImage(options: GenerateImageOptions): Promise<void> {
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

    await execute(this.executable, args);
  }
}

export function createRenderer(): FidelityRenderer {
  return new MaterialXViewRenderer();
}
