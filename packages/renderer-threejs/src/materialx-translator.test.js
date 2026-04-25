import { describe, expect, it, vi } from 'vitest';
import { createMaterialXCompileRegistry } from '../viewer/src/vendor/materialx/compile/MaterialXCompileRegistry.js';
import { validateCategoryCoverage } from '../viewer/src/vendor/materialx/MaterialXNodeRegistry.js';
import { getSupportedSurfaceCategories, surfaceMapperRegistry } from '../viewer/src/vendor/materialx/MaterialXSurfaceRegistry.js';
import { parseMaterialXNodeTree } from '../viewer/src/vendor/materialx/parse/MaterialXParser.js';
import { ISSUE_POLICIES, MaterialXIssueCollector } from '../viewer/src/vendor/materialx/MaterialXWarnings.js';
import { createArchiveResolver } from '../viewer/src/vendor/materialx/MaterialXArchive.js';
import { MaterialXLoader } from '../viewer/src/vendor/MaterialXLoader.js';

describe('materialx translator contracts', () => {
  it('builds a stable compile registry', () => {
    const registry = createMaterialXCompileRegistry();
    expect(registry.has('image')).toBe(true);
    expect(registry.has('transformmatrix')).toBe(true);
    expect(registry.has('gltf_colorimage')).toBe(true);
    expect(registry.has('separate2')).toBe(false);
    expect(registry.has('separate3')).toBe(false);
    expect(registry.has('separate4')).toBe(false);
    expect(registry.has('open_pbr_surface')).toBe(false);
  });

  it('builds a typed surface registry', () => {
    expect(surfaceMapperRegistry.size).toBeGreaterThan(0);
    expect(getSupportedSurfaceCategories()).toEqual(expect.arrayContaining(['standard_surface', 'gltf_pbr', 'open_pbr_surface']));
  });

  it('parses xml-like tree into a typed tree shape', () => {
    class FakeNode {
      constructor(nodeXML, nodePath) {
        this.children = [];
        this.nodeXML = nodeXML;
        this.name = nodeXML.getAttribute('name') ?? nodeXML.nodeName;
        this.nodePath = nodePath ? `${nodePath}/${this.name}` : this.name;
      }

      add(node) {
        this.children.push(node);
      }
    }

    const xmlTree = {
      nodeName: 'materialx',
      getAttribute: () => null,
      children: [
        {
          nodeName: 'nodegraph',
          getAttribute: (name) => (name === 'name' ? 'graph' : null),
          children: [
            {
              nodeName: 'image',
              getAttribute: (name) => (name === 'name' ? 'albedo' : null),
              children: [
                {
                  nodeName: 'input',
                  getAttribute: (name) => {
                    if (name === 'name') return 'file';
                    if (name === 'value') return 'foo.png';
                    return null;
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const indexed = new Map();
    const root = parseMaterialXNodeTree(
      xmlTree,
      (nodeXML, nodePath) => new FakeNode(nodeXML, nodePath),
      (node) => indexed.set(node.nodePath, node),
    );

    expect(root.nodePath).toBe('materialx');
    expect(indexed.has('materialx/graph/albedo/file')).toBe(true);
  });

  it('supports strict core issue policy for unsupported and invalid nodes', () => {
    const collector = new MaterialXIssueCollector({ issuePolicy: ISSUE_POLICIES.ERROR_CORE });
    collector.addUnsupportedNode('unknown_node', 'nodeA');
    collector.addInvalidValue('nodeA', 'bad value');
    expect(() => collector.throwIfNeeded()).toThrow(/translation failed in error-core mode/i);
  });

  it('keeps warn policy non-throwing for translator issues', () => {
    const collector = new MaterialXIssueCollector({ issuePolicy: ISSUE_POLICIES.WARN });
    collector.addUnsupportedNode('unknown_node', 'nodeA');
    collector.addMissingReference('nodeA', 'materialx/graph/missing');
    collector.addInvalidValue('nodeA', 'bad value');
    expect(() => collector.throwIfNeeded()).not.toThrow();
  });

  it('supports loader-level strictness policy configuration', () => {
    const loader = new MaterialXLoader();
    loader.setIssuePolicy('error-all');
    expect(loader.issuePolicy).toBe('error-all');
    loader.setUnsupportedPolicy('error');
    expect(loader.issuePolicy).toBe('error-core');
  });

  it('treats ignored surface inputs as fatal only in error-all mode', () => {
    const errorCoreCollector = new MaterialXIssueCollector({ issuePolicy: ISSUE_POLICIES.ERROR_CORE });
    errorCoreCollector.addIgnoredSurfaceInput('open_pbr_surface', 'surfaceA', 'future_input');
    expect(() => errorCoreCollector.throwIfNeeded()).not.toThrow();

    const errorAllCollector = new MaterialXIssueCollector({ issuePolicy: ISSUE_POLICIES.ERROR_ALL });
    errorAllCollector.addIgnoredSurfaceInput('open_pbr_surface', 'surfaceA', 'future_input');
    expect(() => errorAllCollector.throwIfNeeded()).toThrow(/ignored surface inputs/i);
  });

  it('maps legacy error policy alias to error-core behavior', () => {
    const collector = new MaterialXIssueCollector({ unsupportedPolicy: 'error' });
    collector.addInvalidValue('nodeA', 'bad value');
    expect(() => collector.throwIfNeeded()).toThrow(/error-core mode/i);
  });

  it('validates handler and surface categories against generated registry', () => {
    const compileRegistry = createMaterialXCompileRegistry();
    expect(() =>
      validateCategoryCoverage({
        compileCategories: [...compileRegistry.keys()],
        surfaceCategories: getSupportedSurfaceCategories(),
        allowUnknownCompileCategories: ['hextiledimage', 'hextilednormalmap', 'gltf_anisotropy_image'],
      }),
    ).not.toThrow();
  });

  it('fails coverage validation for unknown compile and surface categories', () => {
    expect(() =>
      validateCategoryCoverage({
        compileCategories: ['definitely_unknown_compile_category'],
        surfaceCategories: ['definitely_unknown_surface_category'],
      }),
    ).toThrow(/unknown compile categories/i);
  });

  it('revokes archive object urls on resolver dispose', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const resolver = createArchiveResolver(new Map([['textures/test.png', new Uint8Array([1, 2, 3])]]));
      expect(resolver.resolve('textures/test.png')).toBe('blob:test-url');
      resolver.dispose();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('clears archive resources at parse boundaries and dispose', () => {
    const loader = new MaterialXLoader();
    const archiveDisposer = vi.fn();
    loader.archiveDisposer = archiveDisposer;
    vi.spyOn(loader, 'parse').mockReturnValue({});

    loader.parseBuffer('<materialx/>', 'plain.mtlx');
    expect(archiveDisposer).toHaveBeenCalledTimes(1);

    const nextArchiveDisposer = vi.fn();
    loader.archiveDisposer = nextArchiveDisposer;
    loader.dispose();
    expect(nextArchiveDisposer).toHaveBeenCalledTimes(1);
  });
});
