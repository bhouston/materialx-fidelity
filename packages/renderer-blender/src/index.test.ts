import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIoBlenderMtlxRenderer, createRenderer } from './index.js';

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

function mockSuccessfulPrerequisites(version = '4.2.0'): void {
  spawnSyncMock.mockImplementation((...args: unknown[]) => {
    const commandArgs = Array.isArray(args[1]) ? args[1] : [];
    if (commandArgs.includes('--version')) {
      return { status: 0, stdout: `Blender ${version}\n`, stderr: '' };
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

function mockSpawnExitAndCreateTemplate(code: number, stdout = '', stderr = ''): void {
  spawnMock.mockImplementation((...args: unknown[]) => {
    const commandArgs = Array.isArray(args[1]) ? args[1] : [];
    const process = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    queueMicrotask(async () => {
      if (commandArgs.includes('--template-output-path')) {
        await createFile(getArgValue(commandArgs, '--template-output-path'));
      }
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
    spawnMock.mockImplementationOnce((...args: unknown[]) => {
      const commandArgs = Array.isArray(args[1]) ? args[1] : [];
      const process = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      process.stdout = new EventEmitter();
      process.stderr = new EventEmitter();
      queueMicrotask(async () => {
        if (commandArgs.includes('--template-output-path')) {
          await createFile(getArgValue(commandArgs, '--template-output-path'));
        }
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
  it('exposes the default and io_blender_mtlx renderer names', () => {
    expect(createRenderer({ thirdPartyRoot: '/tmp/third_party' }).name).toBe('blender');
    expect(createIoBlenderMtlxRenderer({ thirdPartyRoot: '/tmp/third_party' }).name).toBe('blender-io-mtlx');
  });

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

  it('requires Blender 5.0+ for the io_blender_mtlx renderer', async () => {
    mockSuccessfulPrerequisites('4.2.0');
    const thirdPartyRoot = await makeTempDir('blender-third-party-');
    await createFile(path.join(thirdPartyRoot, 'io_blender_mtlx', 'bl_env', 'addons', 'io_data_mtlx', '__init__.py'));

    const renderer = createIoBlenderMtlxRenderer({ thirdPartyRoot });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Blender 5.0.0+ is required');
  });

  it('reports missing io_blender_mtlx add-on files', async () => {
    mockSuccessfulPrerequisites('5.0.0');
    const thirdPartyRoot = await makeTempDir('blender-third-party-');

    const renderer = createIoBlenderMtlxRenderer({ thirdPartyRoot });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('io_blender_mtlx');
  });

  it('passes render options to Blender and captures logs', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitSequence([
      { code: 0, stdout: 'template created\n' },
      {
        code: 0,
        stdout: [
          '00:00.302  blend            | Read blend: "/tmp/material-fidelity-blender-abc/template.blend"',
          "00:04.658  render           | Saved: '/tmp/example/blender-temp.png'",
          'render started',
          'render finished',
        ].join('\n'),
      },
    ]);
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

  it('uses the io_blender_mtlx render script for the add-on renderer', async () => {
    mockSuccessfulPrerequisites('5.0.0');
    mockSpawnExitSequence([
      { code: 0, stdout: 'template created\n' },
      { code: 0, stdout: 'render finished\n' },
    ]);
    const thirdPartyRoot = await makeTempDir('blender-third-party-');
    const viewerRoot = path.join(thirdPartyRoot, 'material-samples', 'viewer');
    const materialsRoot = path.join(thirdPartyRoot, 'material-samples', 'materials', 'example');
    const materialPath = path.join(materialsRoot, 'example.mtlx');
    const outputPath = path.join(materialsRoot, 'blender-io-mtlx.png');
    const modelPath = path.join(viewerRoot, 'ShaderBall.glb');
    const environmentHdrPath = path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr');
    await Promise.all([
      createFile(materialPath),
      createFile(modelPath),
      createFile(environmentHdrPath),
      createFile(path.join(thirdPartyRoot, 'io_blender_mtlx', 'bl_env', 'addons', 'io_data_mtlx', '__init__.py')),
    ]);

    const renderer = createIoBlenderMtlxRenderer({ thirdPartyRoot });
    await renderer.start({ modelPath, environmentHdrPath, backgroundColor: '0,0,0' });
    await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputPath,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [, templateArgs] = spawnMock.mock.calls[0] as [string, string[]];
    const [, renderArgs] = spawnMock.mock.calls[1] as [string, string[]];
    expect(getArgValue(templateArgs, '--python')).toMatch(/render_materialx_io_blender_mtlx\.py$/);
    expect(getArgValue(renderArgs, '--python')).toMatch(/render_materialx_io_blender_mtlx\.py$/);
    expect(renderArgs).toEqual(expect.arrayContaining(['--third-party-root', thirdPartyRoot]));
  });

  it('requires PNG output paths', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitAndCreateTemplate(0, 'template created\n');
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
    mockSpawnExitAndCreateTemplate(0, 'template created\n');
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

    await expect(access(templateDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports template creation when Blender exits without writing the template file', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExit(0, 'template skipped\n');
    const renderer = createRenderer({ thirdPartyRoot: '/tmp/third_party' });

    await expect(
      renderer.start({
        modelPath: '/tmp/model.glb',
        environmentHdrPath: '/tmp/environment.hdr',
        backgroundColor: '0,0,0',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Blender template was not created'),
      rendererLogs: [{ level: 'info', source: 'renderer', message: 'template skipped' }],
    });
  });
});
