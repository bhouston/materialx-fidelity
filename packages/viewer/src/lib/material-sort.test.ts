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

  it('scores quality as zero when a selected renderer result is missing', () => {
    const sample = material('sample', {
      first: { hasImage: true, psnr: 31 },
      second: { hasImage: false, psnr: 24 },
    });

    expect(getMaterialQuality(sample, ['first', 'second'])).toBe(0);
  });

  it('sorts by metric using selected renderers only', () => {
    const missingSelectedResult = material('missing', {
      first: { hasImage: true, psnr: 35 },
      second: { hasImage: false, psnr: 18 },
      ignored: { hasImage: true, psnr: 2 },
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
      sortMaterials([highSelectedPsnr, lowSelectedPsnr, missingSelectedResult], 'psnr', ['first', 'second']).map(
        (entry) => entry.name,
      ),
    ).toEqual(['missing', 'low', 'high']);
    expect(
      sortMaterials([missingSelectedResult, lowSelectedPsnr, highSelectedPsnr], 'psnr-reversed', [
        'first',
        'second',
      ]).map((entry) => entry.name),
    ).toEqual(['high', 'low', 'missing']);
  });
});
