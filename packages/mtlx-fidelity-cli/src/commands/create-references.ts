import path from 'node:path';
import { createReferences } from '@mtlx-fidelity/core';
import { humanizeTime } from 'humanize-units';
import { defineCommand } from 'yargs-file-commands';

function resolveBackgroundColor(backgroundColor: string): string {
  const components = backgroundColor.split(',').map((component) => component.trim());
  if (components.length !== 3) {
    throw new Error('Invalid --background-color. Expected format "r,g,b" with three numbers in [0,1].');
  }

  const numericComponents = components.map((component) => Number(component));
  if (
    numericComponents.some(
      (component) => Number.isNaN(component) || !Number.isFinite(component) || component < 0 || component > 1,
    )
  ) {
    throw new Error('Invalid --background-color. Expected format "r,g,b" with three numbers in [0,1].');
  }

  return numericComponents.join(',');
}

export const command = defineCommand({
  command: 'create-references',
  describe: 'Generate reference PNG images for each MaterialX sample material.',
  builder: (yargs) =>
    yargs
      .option('adapter', {
        type: 'string',
        demandOption: true,
        describe: 'Adapter name to use for rendering.',
      })
      .option('third-party-root', {
        type: 'string',
        default: '../',
        describe: 'Path containing third-party repositories such as MaterialX-Samples and threejs.',
      })
      .option('adapters-root', {
        type: 'string',
        default: './adapters',
        describe: 'Path to the adapters directory.',
      })
      .option('screen-width', {
        type: 'number',
        default: 512,
        describe: 'Reference image width in pixels.',
      })
      .option('screen-height', {
        type: 'number',
        default: 512,
        describe: 'Reference image height in pixels.',
      })
      .option('concurrency', {
        type: 'number',
        default: 1,
        describe: 'Number of materials to render in parallel.',
      })
      .option('background-color', {
        type: 'string',
        default: '0,0,0',
        describe: 'Background color as "r,g,b" where each number is in [0,1].',
      }),
  handler: async (argv) => {
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    const thirdPartyRoot = path.resolve(invocationCwd, argv['third-party-root']);
    const adaptersRoot = path.resolve(invocationCwd, argv['adapters-root']);
    const startedAt = Date.now();

    const result = await createReferences({
      adaptersRoot,
      thirdPartyRoot,
      adapterName: argv.adapter,
      concurrency: Math.max(1, argv.concurrency),
      backgroundColor: resolveBackgroundColor(argv['background-color']),
      screenWidth: argv['screen-width'],
      screenHeight: argv['screen-height'],
    });
    const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
    const elapsedFormatted = humanizeTime(elapsedSeconds, { unitSeparator: ' ' });

    process.stdout.write(
      `Rendered ${result.rendered} images with adapter "${result.adapterName}". Failures: ${result.failures.length}. Time: ${elapsedFormatted}\n`,
    );

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        process.stderr.write(`FAILED ${failure.materialPath}: ${failure.error.message}\n`);
      }
      process.exitCode = 1;
    }
  },
});
