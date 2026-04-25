export class MaterialXLoader {
  issuePolicy: string;
  warningCallback: ((issue: unknown) => void) | null;
  materialName: string | null;
  constructor(manager?: unknown);
  setPath(path: string): this;
  setIssuePolicy(policy: string): this;
  setUnsupportedPolicy(policy: string): this;
  setWarningCallback(callback: ((issue: unknown) => void) | null): this;
  setMaterialName(materialName: string): this;
  load(url: string, onLoad: (result: unknown) => void, onProgress?: (event: unknown) => void, onError?: (error: unknown) => void): this;
  loadAsync(url: string, onProgress?: (event: unknown) => void): Promise<unknown>;
  parseBuffer(data: ArrayBuffer | Uint8Array | string, url?: string): unknown;
  parse(text: string, archiveResolver?: ((uri: string) => string | null) | null): unknown;
  clearArchiveResources(): void;
  dispose(): this;
}
