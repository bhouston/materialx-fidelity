import { describe, expect, it } from 'vitest';
import { createMaterialXCompileRegistry } from '../viewer/src/vendor/materialx/compile/MaterialXCompileRegistry.js';
import { validateCategoryCoverage } from '../viewer/src/vendor/materialx/MaterialXNodeRegistry.js';
import { getSupportedSurfaceCategories, surfaceMapperRegistry } from '../viewer/src/vendor/materialx/MaterialXSurfaceRegistry.js';
import { parseMaterialXNodeTree } from '../viewer/src/vendor/materialx/parse/MaterialXParser.js';
import { MaterialXIssueCollector } from '../viewer/src/vendor/materialx/MaterialXWarnings.js';

describe('materialx translator contracts', () => {
  it('builds a stable compile registry', () => {
    const registry = createMaterialXCompileRegistry();
    expect(registry.has('image')).toBe(true);
    expect(registry.has('transformmatrix')).toBe(true);
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

  it('supports strict issue policy for unsupported and invalid nodes', () => {
    const collector = new MaterialXIssueCollector({ unsupportedPolicy: 'error' });
    collector.addUnsupportedNode('unknown_node', 'nodeA');
    collector.addInvalidValue('nodeA', 'bad value');
    expect(() => collector.throwIfNeeded()).toThrow(/MaterialX translation failed/i);
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
});
