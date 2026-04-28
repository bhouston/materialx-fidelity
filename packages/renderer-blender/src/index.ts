import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type GenerateImageResult,
  type RenderLogEntry,
  type RendererContext,
  type RendererPrerequisiteCheckResult,
  type RendererStartOptions,
} from '@material-fidelity/core';

const BLENDER_EXECUTABLE_ENV = 'BLENDER_EXECUTABLE';
const EXECUTABLE_CANDIDATES = [
  'blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/Applications/Blender 4.5.app/Contents/MacOS/Blender',
  '/Applications/Blender 4.4.app/Contents/MacOS/Blender',
  '/Applications/Blender 4.3.app/Contents/MacOS/Blender',
  '/Applications/Blender 4.2.app/Contents/MacOS/Blender',
  '/Applications/Blender 4.1.app/Contents/MacOS/Blender',
  '/Applications/Blender 4.0.app/Contents/MacOS/Blender',
];

function isExecutablePath(candidate: string): boolean {
  if (!candidate.includes('/') && !candidate.includes('\\')) {
    return true;
  }

  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  if (!isExecutablePath(command)) {
    return false;
  }

  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 5000,
    shell: false,
  });

  return !result.error && result.status === 0;
}

function resolveExecutable(): string {
  const configuredExecutable = process.env[BLENDER_EXECUTABLE_ENV]?.trim();
  const candidates = configuredExecutable ? [configuredExecutable, ...EXECUTABLE_CANDIDATES] : EXECUTABLE_CANDIDATES;
  const match = candidates.find((candidate) => commandExists(candidate));
  if (!match) {
    throw new Error(
      `Unable to locate Blender executable. Set ${BLENDER_EXECUTABLE_ENV} or add blender to PATH. Tried: ${candidates.join(', ')}.`,
    );
  }

  return match;
}

function parseBlenderVersion(output: string): { major: number; minor: number; patch: number } | undefined {
  const match = output.match(/Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
  };
}

function isSupportedBlenderVersion(version: { major: number; minor: number; patch: number }): boolean {
  void version.patch;
  return version.major > 4 || (version.major === 4 && version.minor >= 0);
}

function createRenderError(message: string, logs: RenderLogEntry[]): Error & { rendererLogs: RenderLogEntry[] } {
  const error = new Error(message) as Error & { rendererLogs: RenderLogEntry[] };
  error.rendererLogs = logs;
  return error;
}

function collectOutputLines(value: string, level: RenderLogEntry['level']): RenderLogEntry[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((message) => shouldIncludeRendererLogMessage(message))
    .map((message) => ({ level, source: 'renderer', message }));
}

function shouldIncludeRendererLogMessage(message: string): boolean {
  return !(
    /^\d{2}:\d{2}\.\d{3}\s+blend\s+\|\s+Read blend:/.test(message) ||
    /^\d{2}:\d{2}\.\d{3}\s+render\s+\|\s+Saved:/.test(message)
  );
}

function checkBlenderRuntime(executable: string): RendererPrerequisiteCheckResult {
  const versionResult = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    shell: false,
  });
  if (versionResult.error) {
    return { success: false, message: versionResult.error.message };
  }
  if (versionResult.status !== 0) {
    return { success: false, message: `Blender --version exited with code ${String(versionResult.status)}.` };
  }

  const version = parseBlenderVersion(versionResult.stdout);
  if (!version) {
    return { success: false, message: `Unable to parse Blender version from: ${versionResult.stdout.trim()}` };
  }
  if (!isSupportedBlenderVersion(version)) {
    return {
      success: false,
      message: `Blender ${version.major}.${version.minor}.${version.patch} is not supported. Blender 4.0+ is required.`,
    };
  }

  const materialXResult = spawnSync(
    executable,
    [
      '--background',
      '--factory-startup',
      '--python-expr',
      'import MaterialX as mx; print("MATERIALX_VERSION=" + mx.getVersionString())',
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      shell: false,
    },
  );
  if (materialXResult.error) {
    return { success: false, message: materialXResult.error.message };
  }
  if (materialXResult.status !== 0) {
    const logs = [...collectOutputLines(materialXResult.stdout, 'info'), ...collectOutputLines(materialXResult.stderr, 'warning')];
    const detail = logs.at(-1)?.message ?? `Blender exited with code ${String(materialXResult.status)}.`;
    return { success: false, message: `Blender bundled MaterialX module is unavailable: ${detail}` };
  }

  return { success: true };
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
        if (!shouldIncludeRendererLogMessage(message)) {
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

      const message = logs.at(-1)?.message ?? `Blender exited with code ${String(code)}.`;
      reject(createRenderError(message, logs));
    });
  });
}

class BlenderRenderer implements FidelityRenderer {
  public readonly name = 'blender';
  public readonly version = '0.1.0';
  public readonly category = 'pathtracer';
  public readonly emptyReferenceImagePath: string;
  private readonly packageRoot: string;
  private readonly thirdPartyRoot: string;
  private executable: string | undefined;
  private prerequisitesValidated = false;
  private templateDirectory: string | undefined;
  private templatePath: string | undefined;
  private startOptions: RendererStartOptions | undefined;

  public constructor(context: RendererContext) {
    this.thirdPartyRoot = context.thirdPartyRoot;
    this.packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    this.emptyReferenceImagePath = join(this.packageRoot, 'blender-empty.png');
  }

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    if (this.prerequisitesValidated && this.executable) {
      return { success: true };
    }

    try {
      const executable = resolveExecutable();
      const scriptPath = join(this.packageRoot, 'blender', 'render_materialx.py');
      const missingFiles: string[] = [];
      for (const filePath of [scriptPath]) {
        try {
          await access(filePath, fsConstants.R_OK);
        } catch {
          missingFiles.push(filePath);
        }
      }
      if (missingFiles.length > 0) {
        return { success: false, message: `Missing required renderer files: ${missingFiles.join(', ')}` };
      }

      const runtimeCheck = checkBlenderRuntime(executable);
      if (!runtimeCheck.success) {
        this.prerequisitesValidated = false;
        return runtimeCheck;
      }

      this.executable = executable;
      this.prerequisitesValidated = true;
      return { success: true };
    } catch (error) {
      this.prerequisitesValidated = false;
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  public async start(options: RendererStartOptions): Promise<void> {
    if (this.executable && this.prerequisitesValidated && this.templatePath) {
      return;
    }

    const checkResult = await this.checkPrerequisites();
    if (!checkResult.success) {
      throw new Error(checkResult.message ?? 'Blender prerequisites are not satisfied.');
    }

    if (!this.executable) {
      throw new Error('Blender executable was not resolved during prerequisite validation.');
    }

    const scriptPath = join(this.packageRoot, 'blender', 'render_materialx.py');
    const templateDirectory = await mkdtemp(join(tmpdir(), 'material-fidelity-blender-'));
    const templatePath = join(templateDirectory, 'template.blend');
    const args = [
      '--background',
      '--factory-startup',
      '--python',
      scriptPath,
      '--',
      '--template-output-path',
      templatePath,
      '--model-path',
      options.modelPath,
      '--environment-hdr-path',
      options.environmentHdrPath,
      '--background-color',
      options.backgroundColor,
      '--width',
      String(REFERENCE_IMAGE_WIDTH),
      '--height',
      String(REFERENCE_IMAGE_HEIGHT),
      '--third-party-root',
      this.thirdPartyRoot,
    ];

    try {
      await execute(this.executable, args);
      this.templateDirectory = templateDirectory;
      this.templatePath = templatePath;
      this.startOptions = options;
    } catch (error) {
      await rm(templateDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    const templateDirectory = this.templateDirectory;
    this.templateDirectory = undefined;
    this.templatePath = undefined;
    this.startOptions = undefined;
    if (templateDirectory) {
      await rm(templateDirectory, { recursive: true, force: true });
    }
  }

  public async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.executable || !this.templatePath || !this.startOptions) {
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const scriptPath = join(this.packageRoot, 'blender', 'render_materialx.py');
    const args = [
      '--background',
      this.templatePath,
      '--python',
      scriptPath,
      '--',
      '--mtlx-path',
      options.mtlxPath,
      '--output-png-path',
      options.outputPngPath,
      '--background-color',
      this.startOptions.backgroundColor,
      '--width',
      String(REFERENCE_IMAGE_WIDTH),
      '--height',
      String(REFERENCE_IMAGE_HEIGHT),
      '--third-party-root',
      this.thirdPartyRoot,
    ];

    const logs = await execute(this.executable, args);
    return { logs };
  }
}

export function createRenderer(context: RendererContext): FidelityRenderer {
  return new BlenderRenderer(context);
}
