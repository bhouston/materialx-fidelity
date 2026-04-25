import { FileLoader, Loader } from 'three/webgpu';

import { MaterialXDocument } from './materialx/MaterialXDocument.js';
import { MaterialXIssueCollector, normalizeIssuePolicy } from './materialx/MaterialXWarnings.js';
import { isZipBuffer, readMtlxArchive, createArchiveResolver } from './materialx/MaterialXArchive.js';

const _textDecoder = new TextDecoder();

class MaterialXLoader extends Loader {
  constructor(manager) {
    super(manager);
    this.issuePolicy = 'warn';
    this.warningCallback = null;
    this.materialName = null;
    this.archiveDisposer = null;
  }

  setIssuePolicy(policy) {
    this.issuePolicy = normalizeIssuePolicy(policy);
    return this;
  }

  setUnsupportedPolicy(policy) {
    return this.setIssuePolicy(policy);
  }

  setWarningCallback(callback) {
    this.warningCallback = callback;
    return this;
  }

  setMaterialName(materialName) {
    this.materialName = materialName;
    return this;
  }

  clearArchiveResources() {
    if (this.archiveDisposer) {
      this.archiveDisposer();
      this.archiveDisposer = null;
    }
  }

  dispose() {
    this.clearArchiveResources();
    return this;
  }

  load(url, onLoad, onProgress, onError) {
    const _onError = function (e) {
      if (onError) {
        onError(e);
      } else {
        console.error(e);
      }
    };

    new FileLoader(this.manager)
      .setPath(this.path)
      .setResponseType('arraybuffer')
      .load(
        url,
        (data) => {
          try {
            onLoad(this.parseBuffer(data, url));
          } catch (e) {
            _onError(e);
          }
        },
        onProgress,
        _onError,
      );

    return this;
  }

  loadAsync(url, onProgress) {
    return new Promise((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }

  parseBuffer(data, url = '') {
    this.clearArchiveResources();

    let text;
    let archiveResolver = null;

    if (data && (isZipBuffer(data) || /\.mtlx\.zip$/i.test(url))) {
      const archive = readMtlxArchive(data);
      text = archive.text;
      const resolver = createArchiveResolver(archive.files);
      archiveResolver = resolver.resolve;
      this.archiveDisposer = resolver.dispose;
    } else if (typeof data === 'string') {
      text = data;
    } else if (data instanceof Uint8Array) {
      text = _textDecoder.decode(data);
    } else {
      text = _textDecoder.decode(new Uint8Array(data));
    }

    return this.parse(text, archiveResolver);
  }

  parse(text, archiveResolver = null) {
    const issueCollector = new MaterialXIssueCollector({
      issuePolicy: this.issuePolicy,
      onWarning: this.warningCallback,
    });

    const document = new MaterialXDocument(this.manager, this.path, issueCollector, archiveResolver);
    const result = document.parse(text, this.materialName);

    issueCollector.throwIfNeeded();
    return result;
  }
}

export { MaterialXLoader };
