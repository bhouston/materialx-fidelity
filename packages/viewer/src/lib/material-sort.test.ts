import { describe, expect, it } from 'vitest';
import type { MaterialViewModel } from '#/lib/material-index';
import {
  DEFAULT_MATERIAL_SORT,
  getMaterialQuality,
  parseMaterialSort,
  sortMaterials,
  toMaterialSortSearchValue,
} from '#/lib/material-sort';

function material(
  displayPath: string,
  rendererData: Record<string, { hasImage: boolean; psnr: number | null | undefined }>,
): MaterialViewModel {
  return {
    id: displayPath,
    type: 'nodes',
    name: displayPath,
    displayPath,
    sourceUrl: '',
    liveViewerUrl: '',
    downloadMtlxZipUrl: '',
    materialSourceUrl: '',
    images: Object.fromEntries(
      Object.entries(rendererData).map(([rendererName, data]) => [
        rendererName,
        data.hasImage ? `/${rendererName}.png` : null,
      ]),
    ),
    imageHashes: {},
    reports: {},
    reportSummaries: {},
    metrics: Object.fromEntries(
      Object.entries(rendererData).map(([rendererName, data]) => [
        rendererName,
        data.psnr === undefined
          ? null
          : {
              psnr: data.psnr,
            },
      ]),
    ),
  };
}

describe('material sort', () => {
  it('normalizes sort query values', () => {
    expect(parseMaterialSort(undefined)).toBe(DEFAULT_MATERIAL_SORT);
    expect(parseMaterialSort('')).toBe(DEFAULT_MATERIAL_SORT);
    expect(parseMaterialSort('name')).toBe('name');
    expect(parseMaterialSort('unknown')).toBe(DEFAULT_MATERIAL_SORT);
    expect(toMaterialSortSearchValue(DEFAULT_MATERIAL_SORT)).toBeUndefined();
    expect(toMaterialSortSearchValue('psnr')).toBe('psnr');
  });

  it('scores quality as the lowest selected renderer PSNR', () => {
    const sample = material('sample', {
      first: { hasImage: true, psnr: 31 },
      second: { hasImage: true, psnr: 24 },
      ignored: { hasImage: true, psnr: 12 },
    });

    expect(getMaterialQuality(sample, ['first', 'second'])).toBe(24);
  });

  it('skips missing selected renderer PSNR values when scoring quality', () => {
    const sample = material('sample', {
      first: { hasImage: true, psnr: 31 },
      second: { hasImage: false, psnr: 24 },
      third: { hasImage: true, psnr: null },
    });

    expect(getMaterialQuality(sample, ['first', 'second', 'third'])).toBe(24);
  });

  it('scores quality as unknown when no selected renderer has a known PSNR', () => {
    const sample = material('sample', {
      first: { hasImage: false, psnr: undefined },
      second: { hasImage: true, psnr: null },
    });

    expect(getMaterialQuality(sample, ['first', 'second'])).toBeNull();
  });

  it('sorts by PSNR using selected renderers only', () => {
    const partialSelectedResult = material('partial', {
      first: { hasImage: true, psnr: 35 },
      second: { hasImage: false, psnr: undefined },
      ignored: { hasImage: true, psnr: 2 },
    });
    const unknownSelectedPsnr = material('unknown', {
      first: { hasImage: false, psnr: undefined },
      second: { hasImage: true, psnr: null },
      ignored: { hasImage: true, psnr: 1 },
    });
    const lowSelectedPsnr = material('low', {
      first: { hasImage: true, psnr: 21 },
      second: { hasImage: true, psnr: 34 },
      ignored: { hasImage: false, psnr: undefined },
    });
    const highSelectedPsnr = material('high', {
      first: { hasImage: true, psnr: 36 },
      second: { hasImage: true, psnr: 37 },
      ignored: { hasImage: true, psnr: 1 },
    });

    expect(
      sortMaterials([unknownSelectedPsnr, highSelectedPsnr, lowSelectedPsnr, partialSelectedResult], 'psnr', [
        'first',
        'second',
      ]).map((entry) => entry.name),
    ).toEqual(['low', 'partial', 'high', 'unknown']);
    expect(
      sortMaterials([unknownSelectedPsnr, partialSelectedResult, lowSelectedPsnr, highSelectedPsnr], 'psnr-reversed', [
        'first',
        'second',
      ]).map((entry) => entry.name),
    ).toEqual(['high', 'partial', 'low', 'unknown']);
  });
});
