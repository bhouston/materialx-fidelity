export interface GenerateImageOptions {
  mtlxPath: string;
  outputPngPath: string;
  modelPath: string;
  environmentHdrPath: string;
  backgroundColor: string;
  screenWidth: number;
  screenHeight: number;
}

export interface FidelityAdapter {
  name: string;
  version: string;
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  generateImage: (options: GenerateImageOptions) => Promise<void>;
}

export interface AdapterContext {
  thirdPartyRoot: string;
}

export interface AdapterModule {
  createAdapter: (context?: AdapterContext) => Promise<FidelityAdapter> | FidelityAdapter;
}

export interface LoadAdaptersOptions {
  adaptersRoot: string;
  context?: AdapterContext;
}

export interface CreateReferencesOptions {
  adaptersRoot: string;
  thirdPartyRoot: string;
  adapterName: string;
  concurrency: number;
  backgroundColor: string;
  screenWidth: number;
  screenHeight: number;
}

export interface RenderFailure {
  materialPath: string;
  outputPngPath: string;
  error: Error;
}

export interface CreateReferencesResult {
  adapterName: string;
  rendered: number;
  failures: RenderFailure[];
}
