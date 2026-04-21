import path from 'node:path';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { createReferences } from '@materialx-fidelity/core';
import type { CreateReferencesProgressEvent, CreateReferencesResult, FidelityRenderer } from '@materialx-fidelity/core';
import { createRenderer as createMaterialXViewRenderer } from '@materialx-fidelity/renderer-materialxview';
import { createRenderer as createThreeJsRenderer } from '@materialx-fidelity/renderer-threejs';
import { humanizeTime } from 'humanize-units';
import { defineCommand } from 'yargs-file-commands';

function inferRepoRoot(invocationCwd: string): string {
  if (path.basename(invocationCwd) === 'cli' && path.basename(path.dirname(invocationCwd)) === 'packages') {
    return path.dirname(path.dirname(invocationCwd));
  }

  return invocationCwd;
}

function resolveThirdPartyRoot(invocationCwd: string): string {
  const repoRoot = inferRepoRoot(invocationCwd);
  return path.join(repoRoot, 'third_party');
}

function formatElapsed(ms: number): string {
  const elapsedSeconds = Math.max(0, ms / 1000);
  return humanizeTime(elapsedSeconds, { unitSeparator: ' ' });
}

function formatMaterialLabel(materialPath: string, materialsRoot: string): string {
  const materialDirectory = path.dirname(materialPath);
  const relativePath = path.relative(materialsRoot, materialDirectory);
  return relativePath.length > 0 ? relativePath : materialDirectory;
}

function renderProgressBar(completed: number, total: number, width = 28): string {
  if (total <= 0) {
    return `[${' '.repeat(width)}] 0.0%`;
  }
  const ratio = Math.min(1, Math.max(0, completed / total));
  const filled = Math.round(ratio * width);
  return `[${'='.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}] ${(ratio * 100).toFixed(1)}%`;
}

interface RenderLogLine {
  key: string;
  rendererName: string;
  materialLabel: string;
  status: 'IN PROGRESS' | 'SUCCESS' | 'FAILED';
  durationText?: string;
  errorMessage?: string;
}

function renderLogLineText(entry: RenderLogLine): string {
  const durationPart = entry.durationText ? ` (${entry.durationText})` : '';
  const errorPart = entry.errorMessage ? ` - ${entry.errorMessage}` : '';
  return `${entry.rendererName} | ${entry.materialLabel} | ${entry.status}${durationPart}${errorPart}`;
}

function normalizeRendererNames(rawRenderers: unknown): string[] {
  const rendererValues = rawRenderers == null ? [] : Array.isArray(rawRenderers) ? rawRenderers : [rawRenderers];
  return [...new Set(rendererValues.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean))];
}

function normalizeStringList(rawValues: unknown): string[] {
  const values = rawValues == null ? [] : Array.isArray(rawValues) ? rawValues : [rawValues];
  return [...new Set(values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean))];
}

function renderLogLineColor(entry: RenderLogLine): string {
  if (entry.status === 'SUCCESS') {
    return 'green';
  }
  if (entry.status === 'FAILED') {
    return 'red';
  }
  return 'white';
}

interface InkCreateReferencesAppProps {
  args: {
    renderers: FidelityRenderer[];
    thirdPartyRoot: string;
    rendererNames: string[];
    concurrency: number;
    materialSelectors: string[];
    filter?: string;
  };
  onComplete: (result: CreateReferencesResult) => void;
  onError: (error: Error) => void;
}

function InkCreateReferencesApp({ args, onComplete, onError }: InkCreateReferencesAppProps) {
  const { exit } = useApp();
  const [total, setTotal] = useState(0);
  const [started, setStarted] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [durationTotalMs, setDurationTotalMs] = useState(0);
  const [renderLogs, setRenderLogs] = useState<RenderLogLine[]>([]);
  const [stopping, setStopping] = useState(false);
  const [statusLine, setStatusLine] = useState('Preparing render plan...');
  const stopRequestedRef = useRef(false);

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === 'c') {
      stopRequestedRef.current = true;
      setStopping(true);
      setStatusLine('Stopping after in-flight renders complete...');
    }
  });

  useEffect(() => {
    let active = true;
    const materialsRoot = path.join(args.thirdPartyRoot, 'materialx-samples', 'materials');

    const applyProgress = (event: CreateReferencesProgressEvent) => {
      if (!active) {
        return;
      }

      if (event.phase === 'start') {
        const label = formatMaterialLabel(event.materialPath, materialsRoot);
        const logEntryKey = `${event.rendererName}:${event.materialPath}`;
        setTotal(event.total);
        setStarted(event.started);
        setCompleted(event.completed);
        setStatusLine(`Rendering ${event.rendererName} | ${label}`);
        setRenderLogs((previous) => [
          ...previous,
          {
            key: logEntryKey,
            rendererName: event.rendererName,
            materialLabel: label,
            status: 'IN PROGRESS',
          },
        ]);
        return;
      }

      const elapsed = formatElapsed(event.durationMs ?? 0);
      setTotal(event.total);
      setCompleted(event.completed);
      setDurationTotalMs((value) => value + (event.durationMs ?? 0));
      setRenderLogs((previous) =>
        previous.map((entry) =>
          entry.key === `${event.rendererName}:${event.materialPath}`
            ? {
                ...entry,
                status: event.success ? 'SUCCESS' : 'FAILED',
                durationText: elapsed,
                errorMessage: event.success ? undefined : (event.error?.message ?? 'Unknown error'),
              }
            : entry,
        ),
      );
    };

    void createReferences({
      renderers: args.renderers,
      thirdPartyRoot: args.thirdPartyRoot,
      rendererNames: args.rendererNames,
      concurrency: args.concurrency,
      materialSelectors: args.materialSelectors,
      filter: args.filter,
      shouldStop: () => stopRequestedRef.current,
      onPlan: (event) => {
        if (!active) {
          return;
        }
        setTotal(event.materialPaths.length);
        setStatusLine(`Queued ${event.materialPaths.length} materials`);
      },
      onProgress: applyProgress,
    })
      .then((result) => {
        if (!active) {
          return;
        }
        onComplete(result);
        exit();
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        onError(error instanceof Error ? error : new Error(String(error)));
        exit();
      });

    return () => {
      active = false;
    };
  }, [args, exit, onComplete, onError]);

  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const etaMs = useMemo(() => {
    if (completed === 0 || total <= completed) {
      return 0;
    }
    const averageMs = durationTotalMs / completed;
    return Math.max(0, averageMs * (total - completed));
  }, [completed, durationTotalMs, total]);

  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(
      Text,
      { color: 'cyan' },
      `Renderers: ${args.rendererNames.length > 0 ? args.rendererNames.join(', ') : 'all (built-in)'}`,
    ),
    createElement(Text, { color: 'gray' }, statusLine),
    createElement(Text, { color: 'white' }, ''),
    ...renderLogs.map((entry) =>
      createElement(Text, { key: entry.key, color: renderLogLineColor(entry) }, renderLogLineText(entry)),
    ),
    createElement(Text, { color: 'white' }, ''),
    createElement(
      Text,
      undefined,
      `${renderProgressBar(completed, total)}  ${completed}/${total} complete, ${started - completed} active`,
    ),
    createElement(
      Text,
      { color: stopping ? 'yellow' : 'gray' },
      `Elapsed: ${formatElapsed(elapsedMs)} | ETA: ${formatElapsed(etaMs)} | Ctrl-C to stop`,
    ),
  );
}

async function runCreateReferencesWithInk(args: InkCreateReferencesAppProps['args']): Promise<CreateReferencesResult> {
  return new Promise<CreateReferencesResult>((resolve, reject) => {
    const app = render(
      createElement(InkCreateReferencesApp, {
        args,
        onComplete: resolve,
        onError: reject,
      }),
    );

    void app.waitUntilExit();
  });
}

export const command = defineCommand({
  command: 'create-references',
  describe: 'Generate reference PNG images for each MaterialX sample material.',
  builder: (yargs) =>
    yargs
      .option('renderers', {
        type: 'array',
        describe: 'Renderer names to use. Supports repeated values and comma-separated lists.',
      })
      .option('concurrency', {
        type: 'number',
        default: 1,
        describe: 'Number of materials to render in parallel.',
      })
      .option('materials', {
        type: 'array',
        describe: 'Material selectors. Supports repeated values, comma-separated values, or regex (`re:...` or `/.../flags`).',
      })
      .option('filter', {
        type: 'string',
        describe: 'Deprecated alias for --materials with a single substring selector.',
      }),
  handler: async (argv) => {
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    const thirdPartyRoot = resolveThirdPartyRoot(invocationCwd);
    const renderers: FidelityRenderer[] = [
      createMaterialXViewRenderer(),
      createThreeJsRenderer({ thirdPartyRoot }),
    ];
    const startedAt = Date.now();
    const materialSelectors = normalizeStringList(argv.materials);
    if (argv.filter && argv.filter.trim().length > 0) {
      materialSelectors.push(argv.filter);
    }
    const commandArgs = {
      renderers,
      thirdPartyRoot,
      rendererNames: normalizeRendererNames(argv.renderers),
      concurrency: Math.max(1, argv.concurrency),
      materialSelectors: [...new Set(materialSelectors)],
      filter: argv.filter,
    };
    const materialsRoot = path.join(thirdPartyRoot, 'materialx-samples', 'materials');
    const isInteractive = process.stdout.isTTY && !process.env.CI;
    const result = isInteractive
      ? await runCreateReferencesWithInk(commandArgs)
      : await createReferences({
          ...commandArgs,
          onProgress: (event) => {
            if (event.phase !== 'finish') {
              return;
            }
            const elapsed = formatElapsed(event.durationMs ?? 0);
            const status = event.success ? 'SUCCESS' : 'FAILED';
            const materialLabel = formatMaterialLabel(event.materialPath, materialsRoot);
            process.stdout.write(
              `${event.rendererName} | ${materialLabel} | ${status} (${elapsed}) ${event.completed}/${event.total}\n`,
            );
          },
        });
    const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
    const elapsedFormatted = humanizeTime(elapsedSeconds, { unitSeparator: ' ' });

    process.stdout.write(
      `Rendered ${result.rendered}/${result.total} images with renderers ${result.rendererNames.map((name) => `"${name}"`).join(', ')}. Failures: ${result.failures.length}. Time: ${elapsedFormatted}${result.stopped ? ' (stopped early)' : ''}\n`,
    );

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        process.stderr.write(`FAILED ${failure.rendererName} | ${failure.materialPath}: ${failure.error.message}\n`);
      }
      process.exitCode = 1;
    }
  },
});
