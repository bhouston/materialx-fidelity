import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer } from './index.js';

type UnknownFn = (...args: unknown[]) => unknown;

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<UnknownFn>(),
  spawnSyncMock: vi.fn<UnknownFn>(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
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

function mockSuccessfulPrerequisites(): void {
  spawnSyncMock.mockImplementation((...args: unknown[]) => {
    const commandArgs = Array.isArray(args[1]) ? args[1] : [];
    if (commandArgs.includes('--version')) {
      return { status: 0, stdout: 'Blender 4.2.0\n', stderr: '' };
    }
    if (commandArgs.includes('--python-expr')) {
      return { status: 0, stdout: 'MATERIALX_VERSION=1.39.0\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
}

function mockSpawnExit(code: number, stdout = '', stderr = ''): void {
  spawnMock.mockImplementation(() => {
    const process = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) {
        process.stdout.emit('data', Buffer.from(stdout));
      }
      if (stderr) {
        process.stderr.emit('data', Buffer.from(stderr));
      }
      process.emit('close', code);
    });
    return process;
  });
}

function mockSpawnExitSequence(results: Array<{ code: number; stdout?: string; stderr?: string }>): void {
  for (const result of results) {
    spawnMock.mockImplementationOnce(() => {
      const process = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      process.stdout = new EventEmitter();
      process.stderr = new EventEmitter();
      queueMicrotask(() => {
        if (result.stdout) {
          process.stdout.emit('data', Buffer.from(result.stdout));
        }
        if (result.stderr) {
          process.stderr.emit('data', Buffer.from(result.stderr));
        }
        process.emit('close', result.code);
      });
      return process;
    });
  }
}

function getArgValue(args: string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (!value) {
    throw new Error(`Missing argument value for ${name}`);
  }
  return value;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnSyncMock.mockReset();
  delete process.env.BLENDER_EXECUTABLE;
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })));
});

describe('blender renderer', () => {
  it('reports missing Blender prerequisites', async () => {
    spawnSyncMock.mockReturnValue({ error: new Error('not found'), status: null, stdout: '', stderr: '' });

    const renderer = createRenderer({ thirdPartyRoot: '/tmp/third_party' });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unable to locate Blender executable');
  });

  it('reports missing bundled MaterialX module', async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 4.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 4.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'ModuleNotFoundError: MaterialX\n' });

    const renderer = createRenderer({ thirdPartyRoot: '/tmp/third_party' });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('bundled MaterialX module is unavailable');
  });

  it('passes render options to Blender and captures logs', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExit(
      0,
      [
        '00:00.302  blend            | Read blend: "/tmp/material-fidelity-blender-abc/template.blend"',
        "00:04.658  render           | Saved: '/tmp/example/blender-temp.png'",
        'render started',
        'render finished',
      ].join('\n'),
    );
    const thirdPartyRoot = await makeTempDir('blender-third-party-');
    const viewerRoot = path.join(thirdPartyRoot, 'material-samples', 'viewer');
    const materialsRoot = path.join(thirdPartyRoot, 'material-samples', 'materials', 'example');
    const materialPath = path.join(materialsRoot, 'example.mtlx');
    const outputPath = path.join(materialsRoot, 'blender-temp.png');
    const modelPath = path.join(viewerRoot, 'ShaderBall.glb');
    const environmentHdrPath = path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr');
    await Promise.all([createFile(materialPath), createFile(modelPath), createFile(environmentHdrPath)]);

    const renderer = createRenderer({ thirdPartyRoot });
    await renderer.start({ modelPath, environmentHdrPath, backgroundColor: '0,0,0' });
    const result = await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputPath,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [templateExecutable, templateArgs] = spawnMock.mock.calls[0] as [string, string[]];
    expect(templateExecutable).toBe('blender');
    expect(templateArgs).toEqual(
      expect.arrayContaining([
        '--background',
        '--factory-startup',
        '--template-output-path',
        expect.stringMatching(/template\.blend$/),
        '--model-path',
        modelPath,
        '--environment-hdr-path',
        environmentHdrPath,
        '--background-color',
        '0,0,0',
        '--third-party-root',
        thirdPartyRoot,
      ]),
    );

    const templatePath = getArgValue(templateArgs, '--template-output-path');
    const [renderExecutable, renderArgs] = spawnMock.mock.calls[1] as [string, string[]];
    expect(renderExecutable).toBe('blender');
    expect(renderArgs).toEqual(
      expect.arrayContaining([
        '--background',
        templatePath,
        '--mtlx-path',
        materialPath,
        '--output-png-path',
        outputPath,
        '--background-color',
        '0,0,0',
        '--third-party-root',
        thirdPartyRoot,
      ]),
    );
    expect(renderArgs).not.toContain('--model-path');
    expect(renderArgs).not.toContain('--environment-hdr-path');
    expect(result.logs.map((entry: { message: string }) => entry.message)).toEqual(['render started', 'render finished']);
  });

  it('requires PNG output paths', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExit(0, 'template created\n');
    const renderer = createRenderer({ thirdPartyRoot: '/tmp/third_party' });
    await renderer.start({
      modelPath: '/tmp/model.glb',
      environmentHdrPath: '/tmp/environment.hdr',
      backgroundColor: '0,0,0',
    });

    await expect(
      renderer.generateImage({
        mtlxPath: '/tmp/material.mtlx',
        outputPngPath: '/tmp/output.webp',
      }),
    ).rejects.toThrow('Output image must be .png');
  });

  it('attaches renderer logs to Blender failures', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitSequence([
      { code: 0, stdout: 'template created\n' },
      { code: 1, stdout: 'render started\n', stderr: 'render failed\n' },
    ]);
    const renderer = createRenderer({ thirdPartyRoot: '/tmp/third_party' });
    await renderer.start({
      modelPath: '/tmp/model.glb',
      environmentHdrPath: '/tmp/environment.hdr',
      backgroundColor: '0,0,0',
    });

    await expect(
      renderer.generateImage({
        mtlxPath: '/tmp/material.mtlx',
        outputPngPath: '/tmp/output.png',
      }),
    ).rejects.toMatchObject({
      message: 'render failed',
      rendererLogs: [
        { level: 'info', source: 'renderer', message: 'render started' },
        { level: 'warning', source: 'renderer', message: 'render failed' },
      ],
    });
  });

  it('removes the temporary template directory during shutdown', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExit(0, 'template created\n');
    const renderer = createRenderer({ thirdPartyRoot: '/tmp/third_party' });
    await renderer.start({
      modelPath: '/tmp/model.glb',
      environmentHdrPath: '/tmp/environment.hdr',
      backgroundColor: '0,0,0',
    });

    const [, templateArgs] = spawnMock.mock.calls[0] as [string, string[]];
    const templatePath = getArgValue(templateArgs, '--template-output-path');
    const templateDirectory = path.dirname(templatePath);
    await expect(access(templateDirectory)).resolves.toBeUndefined();

    await renderer.shutdown();

    await expect(access(templateDirectory)).rejects.toThrow();
  });
});
