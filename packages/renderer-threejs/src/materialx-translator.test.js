import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import {
  ClampToEdgeWrapping,
  FileLoader,
  MirroredRepeatWrapping,
  RepeatWrapping,
} from '../../../third_party/three.js/build/three.webgpu.js';
import { MaterialXLoader } from '../../../third_party/three.js/examples/jsm/loaders/MaterialXLoader.js';
import { createArchiveResolver } from '../../../third_party/three.js/examples/jsm/loaders/materialx/MaterialXArchive.js';
import { MaterialXDocument } from '../../../third_party/three.js/examples/jsm/loaders/materialx/MaterialXDocument.js';
import {
  ISSUE_POLICIES,
  MaterialXIssueCollector,
} from '../../../third_party/three.js/examples/jsm/loaders/materialx/MaterialXWarnings.js';
import { parseMaterialXNodeTree } from '../../../third_party/three.js/examples/jsm/loaders/materialx/parse/MaterialXParser.js';

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

function readNodeSample(name) {
  return readFileSync(
    new URL(`../../../third_party/material-samples/materials/nodes/${name}/${name}.mtlx`, import.meta.url),
    'utf8',
  );
}

function readMaterialSample(relativePath) {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

describe('vendored three.js MaterialX translator contracts', () => {
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
      expect(parseBufferSpy).toHaveBeenCalledWith('xml payload', 'material.mtlx', {});
      expect(onLoad).toHaveBeenCalledWith({ parsed: true });
    } finally {
      setPathSpy.mockRestore();
      setResponseTypeSpy.mockRestore();
      fileLoadSpy.mockRestore();
    }
  });

  it('configures MaterialX UV-space helpers from loader options', () => {
    const defaultDocument = new MaterialXDocument(undefined, '', new MaterialXIssueCollector({}));
    const uvNode = {};

    expect(defaultDocument.uvSpace).toBe('bottom-left');
    expect(defaultDocument.compileContext.mxToBottomLeftUvSpace(uvNode)).toBe(uvNode);
    expect(defaultDocument.compileContext.mxFromBottomLeftUvSpace(uvNode)).toBe(uvNode);
    expect(defaultDocument.compileContext.mxToUvSpace).toBeUndefined();
    expect(defaultDocument.compileContext.mxFromUvSpace).toBeUndefined();

    const topLeftDocument = new MaterialXDocument(undefined, '', new MaterialXIssueCollector({}), null, 'top-left');
    expect(topLeftDocument.uvSpace).toBe('top-left');
    expect(topLeftDocument.compileContext.mxToBottomLeftUvSpace).not.toBe(
      defaultDocument.compileContext.mxToBottomLeftUvSpace,
    );
    expect(topLeftDocument.compileContext.mxFromBottomLeftUvSpace).not.toBe(
      defaultDocument.compileContext.mxFromBottomLeftUvSpace,
    );

    const loader = new MaterialXLoader();
    expect(() => loader.parseBuffer('<materialx version="1.38" />', 'material.mtlx', { uvSpace: 'upper-left' })).toThrow(
      /Unsupported MaterialX uvSpace/,
    );
  });

  it('maps image address modes to texture wrapping per axis', () => {
    const document = new MaterialXDocument({ getHandler: () => null }, '', new MaterialXIssueCollector({}));
    document.textureLoader.load = vi.fn();
    document.parseNode(
      createDomLikeDocument(`
<materialx version="1.38">
  <nodegraph name="graph">
    <image name="image1" type="color3">
      <input name="file" type="filename" value="textures/checker.png" />
      <input name="uaddressmode" type="string" value="clamp" />
      <input name="vaddressmode" type="string" value="mirror" />
    </image>
    <image name="image2" type="color3">
      <input name="file" type="filename" value="textures/checker.png" />
      <input name="uaddressmode" type="string" value="periodic" />
      <input name="vaddressmode" type="string" value="constant" />
    </image>
  </nodegraph>
</materialx>`).documentElement,
    );

    const firstTexture = document.getMaterialXNode('materialx/graph/image1/file').getTexture();
    const secondTexture = document.getMaterialXNode('materialx/graph/image2/file').getTexture();

    expect(firstTexture.wrapS).toBe(ClampToEdgeWrapping);
    expect(firstTexture.wrapT).toBe(MirroredRepeatWrapping);
    expect(secondTexture.wrapS).toBe(RepeatWrapping);
    expect(secondTexture.wrapT).toBe(ClampToEdgeWrapping);
    expect(secondTexture).not.toBe(firstTexture);
  });

  it('supports loadAsync options and propagates load errors', async () => {
    const loader = new MaterialXLoader();
    const loadSpy = vi.spyOn(loader, 'load');
    const resolvedMaterial = { material: true };
    const options = { issuePolicy: ISSUE_POLICIES.ERROR_CORE };
    loadSpy.mockImplementationOnce((url, onLoad) => {
      onLoad(resolvedMaterial);
      return loader;
    });
    await expect(loader.loadAsync('ok.mtlx', options)).resolves.toBe(resolvedMaterial);
    expect(loadSpy).toHaveBeenCalledWith('ok.mtlx', expect.any(Function), undefined, expect.any(Function), options);

    const loadFailure = new Error('load failed');
    loadSpy.mockImplementationOnce((url, onLoad, onProgress, onError) => {
      onError(loadFailure);
      return loader;
    });
    await expect(loader.loadAsync('broken.mtlx')).rejects.toThrow('load failed');
  });

  it('parses implicit boolean-to-float connections without surfacing issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readNodeSample('convert_invalid_implicit_boolean_to_float'),
      'convert_invalid_implicit_boolean_to_float.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['M_convert_invalid_implicit_boolean_to_float']);
    expect(result.report.issues).toEqual([]);
  });

  it('parses implicit float-to-boolean connections without surfacing issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readNodeSample('convert_invalid_implicit_float_to_boolean'),
      'convert_invalid_implicit_float_to_boolean.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['M_convert_invalid_implicit_float_to_boolean']);
    expect(result.report.issues).toEqual([]);
  });

  it('parses artistic_ior helper nodes without surfacing issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readNodeSample('artistic_ior'),
      'artistic_ior.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['M_artistic_ior']);
    expect(result.report.issues).toEqual([]);
  });

  it('parses artistic_ior multioutput nodegraphs without surfacing issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readMaterialSample(
        'third_party/material-samples/materials/surfaces/standard_surface/showcase_graph_pbr_helpers/showcase_graph_pbr_helpers.mtlx',
      ),
      'showcase_graph_pbr_helpers.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['showcase_graph_pbr_helpers']);
    expect(result.report.issues).toEqual([]);
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

    const warnLoader = new MaterialXLoader();
    const unsupportedWarnResult = warnLoader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx');
    expect(unsupportedWarnResult.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-node', category: 'future_surface' })]),
    );

    const missingWarnResult = warnLoader.parseBuffer(missingReferenceMtlx, 'missing-ref.mtlx');
    expect(missingWarnResult.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-reference', nodeName: 'surfaceshader' })]),
    );

    const strictLoader = new MaterialXLoader();
    expect(() =>
      strictLoader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx', { issuePolicy: ISSUE_POLICIES.ERROR_CORE }),
    ).toThrow(/unsupported node categories/i);
    expect(() =>
      strictLoader.parseBuffer(missingReferenceMtlx, 'missing-ref.mtlx', { issuePolicy: ISSUE_POLICIES.ERROR_CORE }),
    ).toThrow(/missing references/i);
  });

  it('supports missing material failure path via loader options', () => {
    const materialMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <standard_surface name="std_surface" />
  <surfacematerial name="mat_present">
    <input name="surfaceshader" nodename="std_surface" />
  </surfacematerial>
</materialx>`;

    const warnLoader = new MaterialXLoader();
    const warnResult = warnLoader.parseBuffer(materialMtlx, 'missing-material.mtlx', { materialName: 'mat_missing' });
    expect(warnResult.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing-material' })]));

    const strictAllLoader = new MaterialXLoader();
    expect(() =>
      strictAllLoader.parseBuffer(materialMtlx, 'missing-material.mtlx', {
        issuePolicy: ISSUE_POLICIES.ERROR_ALL,
        materialName: 'mat_missing',
      }),
    ).toThrow(/missing materials/i);
  });

  it('treats ignored surface inputs as fatal only in error-all mode', () => {
    const errorCoreCollector = new MaterialXIssueCollector({ issuePolicy: ISSUE_POLICIES.ERROR_CORE });
    errorCoreCollector.addIgnoredSurfaceInput('open_pbr_surface', 'surfaceA', 'future_input');
    expect(() => errorCoreCollector.throwIfNeeded()).not.toThrow();

    const errorAllCollector = new MaterialXIssueCollector({ issuePolicy: ISSUE_POLICIES.ERROR_ALL });
    errorAllCollector.addIgnoredSurfaceInput('open_pbr_surface', 'surfaceA', 'future_input');
    expect(() => errorAllCollector.throwIfNeeded()).toThrow(/ignored surface inputs/i);
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