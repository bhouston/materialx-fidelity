import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileLoader } from 'three/webgpu';
import { XMLParser } from 'fast-xml-parser';
import { createMaterialXCompileRegistry } from '../viewer/src/vendor/materialx/compile/MaterialXCompileRegistry.js';
import { validateCategoryCoverage } from '../viewer/src/vendor/materialx/MaterialXNodeRegistry.js';
import { MtlXLibrary } from '../viewer/src/vendor/materialx/MaterialXNodeLibrary.js';
import { getSupportedSurfaceCategories, surfaceMapperRegistry } from '../viewer/src/vendor/materialx/MaterialXSurfaceRegistry.js';
import { parseMaterialXNodeTree } from '../viewer/src/vendor/materialx/parse/MaterialXParser.js';
import { ISSUE_POLICIES, MaterialXIssueCollector } from '../viewer/src/vendor/materialx/MaterialXWarnings.js';
import { createArchiveResolver } from '../viewer/src/vendor/materialx/MaterialXArchive.js';
import { MaterialXLoader } from '../viewer/src/vendor/MaterialXLoader.js';

function createDomLikeNode(nodeName, nodeValue) {
  const attributes = {};
  const children = [];

  for (const [key, value] of Object.entries(nodeValue || {})) {
    if (key.startsWith('@_')) {
      attributes[key.slice(2)] = value;
      continue;
    }
    const childNodes = Array.isArray(value) ? value : [value];
    for (const childNodeValue of childNodes) {
      if (childNodeValue === null || typeof childNodeValue !== 'object') continue;
      children.push(createDomLikeNode(key, childNodeValue));
    }
  }

  return {
    nodeName,
    children,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function createDomLikeDocument(text) {
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: false,
  });
  const parsedTree = xmlParser.parse(text);
  const rootNodeName = Object.keys(parsedTree).find((key) => key !== '?xml');
  if (!rootNodeName) {
    throw new Error('DOMParser mock could not locate a root XML element.');
  }
  return {
    documentElement: createDomLikeNode(rootNodeName, parsedTree[rootNodeName]),
  };
}

describe('materialx translator contracts', () => {
  const originalDOMParser = globalThis.DOMParser;

  beforeAll(() => {
    globalThis.DOMParser = class DOMParserMock {
      parseFromString(text) {
        return createDomLikeDocument(text);
      }
    };
  });

  afterAll(() => {
    globalThis.DOMParser = originalDOMParser;
  });

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

  it('maps cellnoise3d input to position semantics', () => {
    const cellnoise3d = MtlXLibrary.cellnoise3d;
    expect(cellnoise3d).toBeDefined();
    expect(cellnoise3d.params).toEqual(['position']);
    expect(typeof cellnoise3d.defaults.position).toBe('function');
  });

  it('maps fractal2d input to texcoord semantics', () => {
    const fractal2d = MtlXLibrary.fractal2d;
    expect(fractal2d).toBeDefined();
    expect(fractal2d.params).toEqual(['texcoord', 'octaves', 'lacunarity', 'diminish', 'amplitude']);
    expect(fractal2d.defaults.texcoord).toBeDefined();
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

  it('keeps callback load API behavior intact', () => {
    const setPathSpy = vi.spyOn(FileLoader.prototype, 'setPath').mockReturnThis();
    const setResponseTypeSpy = vi.spyOn(FileLoader.prototype, 'setResponseType').mockReturnThis();
    const fileLoadSpy = vi.spyOn(FileLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
      onLoad('xml payload');
      return this;
    });
    const loader = new MaterialXLoader().setPath('/assets/');
    const parseBufferSpy = vi.spyOn(loader, 'parseBuffer').mockReturnValue({ parsed: true });
    const onLoad = vi.fn();

    try {
      loader.load('material.mtlx', onLoad);
      expect(setPathSpy).toHaveBeenCalledWith('/assets/');
      expect(setResponseTypeSpy).toHaveBeenCalledWith('arraybuffer');
      expect(fileLoadSpy).toHaveBeenCalledWith('material.mtlx', expect.any(Function), undefined, expect.any(Function));
      expect(parseBufferSpy).toHaveBeenCalledWith('xml payload', 'material.mtlx');
      expect(onLoad).toHaveBeenCalledWith({ parsed: true });
    } finally {
      setPathSpy.mockRestore();
      setResponseTypeSpy.mockRestore();
      fileLoadSpy.mockRestore();
    }
  });

  it('supports loadAsync and propagates load errors', async () => {
    const loader = new MaterialXLoader();
    const loadSpy = vi.spyOn(loader, 'load');
    const resolvedMaterial = { material: true };
    loadSpy.mockImplementationOnce((url, onLoad) => {
      onLoad(resolvedMaterial);
      return loader;
    });
    await expect(loader.loadAsync('ok.mtlx')).resolves.toBe(resolvedMaterial);

    const loadFailure = new Error('load failed');
    loadSpy.mockImplementationOnce((url, onLoad, onProgress, onError) => {
      onError(loadFailure);
      return loader;
    });
    await expect(loader.loadAsync('broken.mtlx')).rejects.toThrow('load failed');
  });

  it('applies strictness policies to unsupported nodes and missing references in real parse flow', () => {
    const unsupportedSurfaceMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <future_surface name="future_surface_1" />
  <surfacematerial name="mat_unsupported">
    <input name="surfaceshader" nodename="future_surface_1" />
  </surfacematerial>
</materialx>`;

    const missingReferenceMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <surfacematerial name="mat_missing_ref">
    <input name="surfaceshader" nodename="does_not_exist" />
  </surfacematerial>
</materialx>`;

    const warnLoader = new MaterialXLoader().setIssuePolicy(ISSUE_POLICIES.WARN);
    const unsupportedWarnResult = warnLoader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx');
    expect(unsupportedWarnResult.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-node', category: 'future_surface' })]),
    );

    const missingWarnResult = warnLoader.parseBuffer(missingReferenceMtlx, 'missing-ref.mtlx');
    expect(missingWarnResult.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-reference', nodeName: 'surfaceshader' })]),
    );

    const strictLoader = new MaterialXLoader().setIssuePolicy(ISSUE_POLICIES.ERROR_CORE);
    expect(() => strictLoader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx')).toThrow(/unsupported node categories/i);
    expect(() => strictLoader.parseBuffer(missingReferenceMtlx, 'missing-ref.mtlx')).toThrow(/missing references/i);
  });

  it('treats ignored mapped surface inputs as fatal only in error-all parse flow', () => {
    const ignoredInputMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <standard_surface name="std_surface">
    <input name="base" value="0.4" />
    <input name="future_input" value="1.0" />
  </standard_surface>
  <surfacematerial name="mat_std">
    <input name="surfaceshader" nodename="std_surface" />
  </surfacematerial>
</materialx>`;

    const warnLoader = new MaterialXLoader().setIssuePolicy(ISSUE_POLICIES.WARN);
    const warnResult = warnLoader.parseBuffer(ignoredInputMtlx, 'ignored-input.mtlx');
    expect(warnResult.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ignored-surface-input', category: 'standard_surface' })]),
    );

    const strictCoreLoader = new MaterialXLoader().setIssuePolicy(ISSUE_POLICIES.ERROR_CORE);
    expect(() => strictCoreLoader.parseBuffer(ignoredInputMtlx, 'ignored-input.mtlx')).not.toThrow();

    const strictAllLoader = new MaterialXLoader().setIssuePolicy(ISSUE_POLICIES.ERROR_ALL);
    expect(() => strictAllLoader.parseBuffer(ignoredInputMtlx, 'ignored-input.mtlx')).toThrow(/ignored surface inputs/i);
  });

  it('supports missing material failure path via loader-level materialName selection', () => {
    const materialMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <standard_surface name="std_surface" />
  <surfacematerial name="mat_present">
    <input name="surfaceshader" nodename="std_surface" />
  </surfacematerial>
</materialx>`;

    const warnLoader = new MaterialXLoader().setMaterialName('mat_missing').setIssuePolicy(ISSUE_POLICIES.WARN);
    const warnResult = warnLoader.parseBuffer(materialMtlx, 'missing-material.mtlx');
    expect(warnResult.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing-material' })]));

    const strictAllLoader = new MaterialXLoader().setMaterialName('mat_missing').setIssuePolicy(ISSUE_POLICIES.ERROR_ALL);
    expect(() => strictAllLoader.parseBuffer(materialMtlx, 'missing-material.mtlx')).toThrow(/missing materials/i);
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
