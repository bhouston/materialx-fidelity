import { beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from './create-references.js';
import type { createReferences } from '@material-fidelity/core';

const { createReferencesMock } = vi.hoisted(() => ({
  createReferencesMock: vi.fn<typeof createReferences>(),
}));

vi.mock('@material-fidelity/core', () => ({
  createReferences: createReferencesMock,
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

describe('create-references command', () => {
  beforeEach(() => {
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

  it('invokes core createReferences with parsed options', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_234);

    try {
      await command.handler({
        renderers: ['materialxview'],
        materials: undefined,
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
    });
    expect(firstCall?.[0].thirdPartyRoot.endsWith('/third_party')).toBe(true);
    expect(firstCall?.[0].renderers).toHaveLength(4);
  });

  it('passes materials selectors through to core createReferences', async () => {
    await command.handler({
      renderers: ['materialxview,threejs-new'],
      materials: ['standard_surface', '/gltf_pbr/i'],
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
});
