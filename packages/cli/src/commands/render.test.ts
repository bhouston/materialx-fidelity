import { beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from './render.js';
import type { createReferences } from '@material-fidelity/core';

const { availableParallelismMock, createReferencesMock } = vi.hoisted(() => ({
  availableParallelismMock: vi.fn<() => number>(() => 8),
  createReferencesMock: vi.fn<typeof createReferences>(),
}));

vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof import('node:os')>();
  return {
    ...actual,
    availableParallelism: availableParallelismMock,
  };
});

vi.mock('@material-fidelity/core', () => ({
  createReferences: createReferencesMock,
}));

vi.mock('@material-fidelity/renderer-blender', () => ({
  createRenderer: () => ({
    name: 'blender',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createIoBlenderMtlxRenderer: () => ({
    name: 'blender-io-mtlx',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

vi.mock('@material-fidelity/renderer-materialxview', () => ({
  createRenderer: () => ({
    name: 'materialxview',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

vi.mock('@material-fidelity/renderer-materialxjs', () => ({
  createRenderer: () => ({
    name: 'materialxjs',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

vi.mock('@material-fidelity/renderer-threejs', () => ({
  createRenderer: () => ({
    name: 'threejs-new',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createCurrentRenderer: () => ({
    name: 'threejs-current',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

describe('render command', () => {
  beforeEach(() => {
    availableParallelismMock.mockReset();
    availableParallelismMock.mockReturnValue(8);
    createReferencesMock.mockReset();
    createReferencesMock.mockResolvedValue({
      rendererNames: ['materialxview'],
      total: 6,
      attempted: 6,
      rendered: 6,
      failures: [],
      stopped: false,
    });
  });

  it('is invoked as render', () => {
    expect(command.command).toBe('render');
  });

  it('invokes core createReferences with parsed options', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_234);

    try {
      await command.handler({
        renderers: ['materialxview'],
        materials: undefined,
        'skip-existing': false,
        skipExisting: false,
        filter: undefined,
        concurrency: 2,
        _: [],
        $0: 'cli',
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'Rendered 6/6 images with renderers "materialxview". Failures: 0. Time: 1.23 s\n',
      );
    } finally {
      dateNowSpy.mockRestore();
      stdoutWriteSpy.mockRestore();
    }

    expect(createReferencesMock).toHaveBeenCalledTimes(1);
    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: ['materialxview'],
      thirdPartyRoot: expect.any(String),
      concurrency: 2,
      skipExisting: false,
    });
    expect(firstCall?.[0].thirdPartyRoot.endsWith('/third_party')).toBe(true);
    expect(firstCall?.[0].renderers).toHaveLength(6);
  });

  it('defaults concurrency to the recommended available parallelism', async () => {
    availableParallelismMock.mockReturnValue(8);

    const argv = {
      renderers: undefined,
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: undefined,
      _: [],
      $0: 'cli',
    } as unknown as Parameters<typeof command.handler>[0];

    await command.handler(argv);

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      concurrency: 8,
    });
  });

  it('keeps the default concurrency at least 1', async () => {
    availableParallelismMock.mockReturnValue(1);

    const argv = {
      renderers: undefined,
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: undefined,
      _: [],
      $0: 'cli',
    } as unknown as Parameters<typeof command.handler>[0];

    await command.handler(argv);

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      concurrency: 1,
    });
  });

  it('passes materials selectors through to core createReferences', async () => {
    await command.handler({
      renderers: ['materialxview,threejs-new'],
      materials: ['standard_surface', '/gltf_pbr/i'],
      'skip-existing': false,
      skipExisting: false,
      filter: 'stdlib',
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: ['materialxview', 'threejs-new'],
      materialSelectors: ['standard_surface', '/gltf_pbr/i', 'stdlib'],
    });
  });

  it('defaults to all renderers when --renderers is omitted', async () => {
    await command.handler({
      renderers: undefined,
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: [],
      materialSelectors: [],
    });
  });

  it('passes skipExisting through to core createReferences', async () => {
    await command.handler({
      renderers: undefined,
      materials: undefined,
      'skip-existing': true,
      skipExisting: true,
      filter: undefined,
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      skipExisting: true,
    });
  });
});
