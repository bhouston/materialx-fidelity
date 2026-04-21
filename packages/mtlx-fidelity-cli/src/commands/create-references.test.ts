import { beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from './create-references.js';
import type { createReferences } from '@mtlx-fidelity/core';

const { createReferencesMock } = vi.hoisted(() => ({
  createReferencesMock: vi.fn<typeof createReferences>(),
}));

vi.mock('@mtlx-fidelity/core', () => ({
  createReferences: createReferencesMock,
}));

describe('create-references command', () => {
  beforeEach(() => {
    createReferencesMock.mockReset();
    createReferencesMock.mockResolvedValue({
      adapterName: 'materialxview',
      rendered: 3,
      failures: [],
    });
  });

  it('invokes core createReferences with parsed options', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_234);

    try {
      await command.handler({
        adapter: 'materialxview',
        'third-party-root': '../',
        thirdPartyRoot: '../',
        'adapters-root': './adapters',
        adaptersRoot: './adapters',
        'screen-width': 256,
        screenWidth: 256,
        'screen-height': 256,
        screenHeight: 256,
        concurrency: 2,
        'background-color': '0,0,0',
        backgroundColor: '0,0,0',
        _: [],
        $0: 'mtlx-fidelity',
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'Rendered 3 images with adapter "materialxview". Failures: 0. Time: 1.23 s\n',
      );
    } finally {
      dateNowSpy.mockRestore();
      stdoutWriteSpy.mockRestore();
    }

    expect(createReferencesMock).toHaveBeenCalledTimes(1);
    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      adapterName: 'materialxview',
      thirdPartyRoot: expect.any(String),
      concurrency: 2,
      backgroundColor: '0,0,0',
      screenWidth: 256,
      screenHeight: 256,
    });
  });

  it('accepts a normalized rgb background value', async () => {
    await command.handler({
      adapter: 'materialxview',
      'third-party-root': '../',
      thirdPartyRoot: '../',
      'adapters-root': './adapters',
      adaptersRoot: './adapters',
      'screen-width': 256,
      screenWidth: 256,
      'screen-height': 256,
      screenHeight: 256,
      concurrency: 1,
      'background-color': '0.1, 0.2,0.3',
      backgroundColor: '0.1, 0.2,0.3',
      _: [],
      $0: 'mtlx-fidelity',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      backgroundColor: '0.1,0.2,0.3',
    });
  });

  it('rejects invalid background values', async () => {
    await expect(
      command.handler({
        adapter: 'materialxview',
        'third-party-root': '../',
        thirdPartyRoot: '../',
        'adapters-root': './adapters',
        adaptersRoot: './adapters',
        'screen-width': 256,
        screenWidth: 256,
        'screen-height': 256,
        screenHeight: 256,
        concurrency: 1,
        'background-color': '1,2',
        backgroundColor: '1,2',
        _: [],
        $0: 'mtlx-fidelity',
      }),
    ).rejects.toThrow('Invalid --background-color');
    await expect(
      command.handler({
        adapter: 'materialxview',
        'third-party-root': '../',
        thirdPartyRoot: '../',
        'adapters-root': './adapters',
        adaptersRoot: './adapters',
        'screen-width': 256,
        screenWidth: 256,
        'screen-height': 256,
        screenHeight: 256,
        concurrency: 1,
        'background-color': '0.2,1.1,0.4',
        backgroundColor: '0.2,1.1,0.4',
        _: [],
        $0: 'mtlx-fidelity',
      }),
    ).rejects.toThrow('Invalid --background-color');
  });
});
