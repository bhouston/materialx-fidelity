import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listDirectories } from './fs-utils.js';
import type { AdapterModule, FidelityAdapter, LoadAdaptersOptions } from './types.js';

interface AdapterPackageJson {
  name?: string;
  main?: string;
}

function assertAdapterShape(adapter: FidelityAdapter, adapterDir: string): void {
  if (!adapter.name || !adapter.version) {
    throw new Error(`Adapter from ${adapterDir} is missing required name/version metadata.`);
  }

  if (typeof adapter.start !== 'function' || typeof adapter.shutdown !== 'function' || typeof adapter.generateImage !== 'function') {
    throw new Error(`Adapter "${adapter.name}" from ${adapterDir} does not implement required methods.`);
  }
}

export async function loadAdapters(options: LoadAdaptersOptions): Promise<Map<string, FidelityAdapter>> {
  const adapterDirs = await listDirectories(options.adaptersRoot);
  const adapters = new Map<string, FidelityAdapter>();

  for (const adapterDir of adapterDirs) {
    const packageJsonPath = path.join(adapterDir, 'package.json');
    let packageJsonRaw: string;

    try {
      packageJsonRaw = await readFile(packageJsonPath, 'utf8');
    } catch {
      continue;
    }

    const packageJson = JSON.parse(packageJsonRaw) as AdapterPackageJson;
    if (!packageJson.main) {
      throw new Error(`Adapter package at ${adapterDir} is missing a "main" field.`);
    }

    const mainPath = path.resolve(adapterDir, packageJson.main);
    await access(mainPath);

    const imported = (await import(pathToFileURL(mainPath).href)) as Partial<AdapterModule>;
    if (typeof imported.createAdapter !== 'function') {
      throw new Error(`Adapter package at ${adapterDir} must export a named "createAdapter" function.`);
    }

    const adapter = await imported.createAdapter(options.context);
    assertAdapterShape(adapter, adapterDir);

    if (adapters.has(adapter.name)) {
      throw new Error(`Duplicate adapter name detected: "${adapter.name}".`);
    }

    adapters.set(adapter.name, adapter);
  }

  return adapters;
}
