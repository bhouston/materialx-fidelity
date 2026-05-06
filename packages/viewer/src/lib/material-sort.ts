import type { MaterialViewModel } from '#/lib/material-index';

export const DEFAULT_MATERIAL_SORT = 'default';

export const MATERIAL_SORT_OPTIONS = [
  { value: DEFAULT_MATERIAL_SORT, label: 'Default' },
  { value: 'name', label: 'Name' },
  { value: 'name-reversed', label: 'Name (Reversed)' },
  { value: 'psnr', label: 'PSNR' },
  { value: 'psnr-reversed', label: 'PSNR (Reversed)' },
] as const;

export type MaterialSortValue = (typeof MATERIAL_SORT_OPTIONS)[number]['value'];

const MATERIAL_SORT_VALUES = new Set<MaterialSortValue>(MATERIAL_SORT_OPTIONS.map((option) => option.value));

export function parseMaterialSort(value: string | undefined): MaterialSortValue {
  return value && MATERIAL_SORT_VALUES.has(value as MaterialSortValue)
    ? (value as MaterialSortValue)
    : DEFAULT_MATERIAL_SORT;
}

export function toMaterialSortSearchValue(value: MaterialSortValue): string | undefined {
  return value === DEFAULT_MATERIAL_SORT ? undefined : value;
}

export function getMaterialQuality(material: MaterialViewModel, selectedRenderers: string[]): number | null {
  if (selectedRenderers.length === 0) {
    return null;
  }

  let lowestPsnr = Number.POSITIVE_INFINITY;

  for (const rendererName of selectedRenderers) {
    const psnr = material.metrics[rendererName]?.psnr;
    if (psnr == null || !Number.isFinite(psnr)) {
      continue;
    }

    lowestPsnr = Math.min(lowestPsnr, psnr);
  }

  return Number.isFinite(lowestPsnr) ? lowestPsnr : null;
}

function compareMaterialNames(left: MaterialViewModel, right: MaterialViewModel): number {
  return left.displayPath.localeCompare(right.displayPath, undefined, { numeric: true, sensitivity: 'base' });
}

function compareMaterialQuality(
  left: MaterialViewModel,
  right: MaterialViewModel,
  selectedRenderers: string[],
  direction: 1 | -1,
): number {
  const leftQuality = getMaterialQuality(left, selectedRenderers);
  const rightQuality = getMaterialQuality(right, selectedRenderers);

  if (leftQuality === null && rightQuality === null) {
    return compareMaterialNames(left, right);
  }

  if (leftQuality === null) {
    return 1;
  }

  if (rightQuality === null) {
    return -1;
  }

  const qualityDelta = (leftQuality - rightQuality) * direction;
  return qualityDelta === 0 ? compareMaterialNames(left, right) : qualityDelta;
}

export function sortMaterials(
  materials: MaterialViewModel[],
  sortValue: MaterialSortValue,
  selectedRenderers: string[],
): MaterialViewModel[] {
  switch (sortValue) {
    case 'name':
      return materials.toSorted(compareMaterialNames);
    case 'name-reversed':
      return materials.toSorted((left, right) => compareMaterialNames(right, left));
    case 'psnr':
      return materials.toSorted((left, right) => compareMaterialQuality(left, right, selectedRenderers, 1));
    case 'psnr-reversed':
      return materials.toSorted((left, right) => compareMaterialQuality(left, right, selectedRenderers, -1));
    case DEFAULT_MATERIAL_SORT:
      return materials;
  }
}
