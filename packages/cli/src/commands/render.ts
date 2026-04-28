import path from 'node:path';
import { availableParallelism } from 'node:os';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { createReferences } from '@material-fidelity/core';
import type { CreateReferencesProgressEvent, CreateReferencesResult, FidelityRenderer } from '@material-fidelity/core';
import {
  createIoBlenderMtlxRenderer,
  createRenderer as createBlenderRenderer,
} from '@material-fidelity/renderer-blender';
import { createRenderer as createMaterialXJsRenderer } from '@material-fidelity/renderer-materialxjs';
import { createRenderer as createMaterialXViewRenderer } from '@material-fidelity/renderer-materialxview';
import {
  createCurrentRenderer as createThreeJsCurrentRenderer,
  createRenderer as createThreeJsNewRenderer,
} from '@material-fidelity/renderer-threejs';
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

function formatElapsed(seconds: number): string {
  return humanizeTime(Math.max(0, seconds), { unitSeparator: ' ' });
}

function getDefaultConcurrency(): number {
  return Math.max(1, availableParallelism());
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
  return `${entry.materialLabel} | ${entry.rendererName} | ${entry.status}${durationPart}${errorPart}`;
}

function normalizeRendererNames(rawRenderers: unknown): string[] {
  const rendererValues = rawRenderers == null ? [] : Array.isArray(rawRenderers) ? rawRenderers : [rawRenderers];
  return [
    ...new Set(
      rendererValues
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeStringList(rawValues: unknown): string[] {
  const values = rawValues == null ? [] : Array.isArray(rawValues) ? rawValues : [rawValues];
  return [
    ...new Set(
      values
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
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

function renderDiagnosticLogs(logs: { level: string; source: string; message: string }[] | undefined): string[] {
  if (!logs || logs.length === 0) {
    return [];
  }
  return logs.map((entry) => `  [${entry.source}:${entry.level}] ${entry.message}`);
}

interface InkCreateReferencesAppProps {
  args: {
    renderers: FidelityRenderer[];
    thirdPartyRoot: string;
    rendererNames: string[];
    concurrency: number;
    materialSelectors: string[];
    skipExisting: boolean;
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
    const materialsRoot = path.join(args.thirdPartyRoot, 'material-samples', 'materials');

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

      const elapsed = formatElapsed((event.durationMs ?? 0) / 1000);
      setTotal(event.total);
      setCompleted(event.completed);
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
      skipExisting: args.skipExisting,
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

  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
  const active = Math.max(0, started - completed);
  const effectiveCompleted = Math.min(total, completed + active * 0.5);
  const etaSeconds = useMemo(() => {
    if (effectiveCompleted < 1 || total <= effectiveCompleted) {
      return null;
    }
    const secondsPerRender = elapsedSeconds / effectiveCompleted;
    return Math.max(0, secondsPerRender * (total - effectiveCompleted));
  }, [effectiveCompleted, elapsedSeconds, total]);

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
      `${renderProgressBar(completed, total)}  ${completed}/${total} complete, ${active} active`,
    ),
    createElement(
      Text,
      { color: stopping ? 'yellow' : 'gray' },
      `Elapsed: ${formatElapsed(elapsedSeconds)} | ETA: ${etaSeconds == null ? '?' : formatElapsed(etaSeconds)} | Ctrl-C to stop`,
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
  command: 'render',
  describe: 'Render reference PNG images for each MaterialX sample material.',
  builder: (yargs) =>
    yargs
      .option('renderers', {
        type: 'array',
        describe: 'Renderer names to use. Supports repeated values and comma-separated lists.',
      })
      .option('concurrency', {
        type: 'number',
        default: getDefaultConcurrency(),
        describe: 'Number of materials to render in parallel. Defaults to the recommended available parallelism.',
      })
      .option('materials', {
        type: 'array',
        describe:
          'Material selectors matched against material directory names. Supports repeated values, comma-separated values, or regex (`re:...` or `/.../flags`).',
      })
      .option('skip-existing', {
        type: 'boolean',
        default: false,
        describe: 'Only render outputs whose renderer/sample PNG does not already exist.',
      })
      .option('filter', {
        type: 'string',
        describe: 'Deprecated alias for --materials with a single substring selector.',
      }),
  handler: async (argv) => {
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    const thirdPartyRoot = resolveThirdPartyRoot(invocationCwd);
    const renderers: FidelityRenderer[] = [
      createBlenderRenderer({ thirdPartyRoot }),
      createIoBlenderMtlxRenderer({ thirdPartyRoot }),
      createMaterialXJsRenderer({ thirdPartyRoot }),
      createMaterialXViewRenderer(),
      createThreeJsNewRenderer({ thirdPartyRoot }),
      createThreeJsCurrentRenderer({ thirdPartyRoot }),
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
      concurrency: Math.max(1, argv.concurrency ?? getDefaultConcurrency()),
      materialSelectors: [...new Set(materialSelectors)],
      skipExisting: argv.skipExisting ?? false,
      filter: argv.filter,
    };
    const materialsRoot = path.join(thirdPartyRoot, 'material-samples', 'materials');
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
            if (!event.success) {
              for (const line of renderDiagnosticLogs(event.logs)) {
                process.stderr.write(`${line}\n`);
              }
            }
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
        for (const line of renderDiagnosticLogs(failure.logs)) {
          process.stderr.write(`${line}\n`);
        }
      }
      process.exitCode = 1;
    }
  },
});
