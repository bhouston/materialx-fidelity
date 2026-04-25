import { generatedSlimNodeCategories } from './generated/MaterialXNodeRegistry.generated.js';

const surfaceFallbackCategories = ['surfacematerial', 'standard_surface', 'gltf_pbr', 'open_pbr_surface'];

const materialXNodeCategories = new Set([...generatedSlimNodeCategories, ...surfaceFallbackCategories]);

function hasMaterialXCategory(category) {
  return materialXNodeCategories.has(category);
}

function validateCategoryCoverage({
  compileCategories = [],
  surfaceCategories = [],
  allowUnknownCompileCategories = [],
} = {}) {
  const allowUnknownCompileSet = new Set(allowUnknownCompileCategories);
  const unknownCompile = [];
  const unknownSurface = [];

  for (const category of compileCategories) {
    if (!hasMaterialXCategory(category) && !allowUnknownCompileSet.has(category)) {
      unknownCompile.push(category);
    }
  }

  for (const category of surfaceCategories) {
    if (!hasMaterialXCategory(category)) {
      unknownSurface.push(category);
    }
  }

  if (unknownCompile.length === 0 && unknownSurface.length === 0) {
    return;
  }

  const details = [];
  if (unknownCompile.length > 0) {
    details.push(`unknown compile categories: ${unknownCompile.toSorted().join(', ')}`);
  }
  if (unknownSurface.length > 0) {
    details.push(`unknown surface categories: ${unknownSurface.toSorted().join(', ')}`);
  }

  throw new Error(`MaterialX translator registry validation failed (${details.join('; ')}).`);
}

export {
  materialXNodeCategories,
  hasMaterialXCategory,
  validateCategoryCoverage,
};
