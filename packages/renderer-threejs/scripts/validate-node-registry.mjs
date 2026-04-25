import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { generateRegistry, resolvePaths, toSource } from './generate-node-registry.mjs';

const main = async () => {
  const { librariesDir, outputPath } = resolvePaths();
  const generated = toSource(await generateRegistry(librariesDir));
  const existing = await readFile(outputPath, 'utf8');

  if (generated !== existing) {
    throw new Error(
      `MaterialX node registry is stale. Run: pnpm --filter @material-fidelity/renderer-threejs generate:node-registry`,
    );
  }

  process.stdout.write(`MaterialX node registry is up to date (${outputPath}).\n`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
