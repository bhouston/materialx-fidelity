import { Info } from 'lucide-react';
import type { MaterialViewModel } from '#/lib/material-index';
import { cn } from '#/lib/utils';

interface MaterialCellProps {
  material: MaterialViewModel;
  rendererName: string;
  shouldRenderContent: boolean;
  onOpenReport: (report: { materialName: string; rendererName: string; reportUrl: string }) => void;
}

function formatMetricValue(value: number | null | undefined, digits = 3): string {
  return value == null ? '-' : value.toFixed(digits);
}

type MetricSeverity = 'none' | 'warning' | 'error';

function getPsnrSeverity(value: number | null): MetricSeverity {
  if (value === null) {
    return 'none';
  }

  if (value <= 20) {
    return 'error';
  }
  if (value <= 24) {
    return 'warning';
  }
  return 'none';
}

function getPsnrRegionClassName(severity: MetricSeverity): string {
  if (severity === 'error') {
    return 'bg-red-100/80 dark:bg-red-950/30';
  }

  if (severity === 'warning') {
    return 'bg-orange-100/80 dark:bg-orange-950/30';
  }

  return '';
}

function getPsnrTextClassName(severity: MetricSeverity): string {
  if (severity === 'error') {
    return 'text-red-950 dark:text-red-100';
  }

  if (severity === 'warning') {
    return 'text-orange-950 dark:text-orange-100';
  }

  return 'text-foreground';
}

function RendererMetrics({
  metrics,
  severity,
}: {
  metrics: MaterialViewModel['metrics'][string];
  severity: MetricSeverity;
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-y-0.5 text-[11px] leading-4 text-muted-foreground',
        getPsnrRegionClassName(severity),
      )}
    >
      <div className="flex justify-between gap-1">
        <dt>PSNR</dt>
        <dd className={cn('font-mono', getPsnrTextClassName(severity))}>{formatMetricValue(metrics?.psnr, 1)}</dd>
      </div>
    </dl>
  );
}

function getReportButtonClassName(summary: MaterialViewModel['reportSummaries'][string]): string {
  if (summary?.severity === 'error') {
    return 'border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:text-white dark:hover:bg-red-700';
  }

  if (summary?.severity === 'warning') {
    return 'border-orange-400 bg-orange-400 text-black hover:bg-orange-500 dark:border-orange-400 dark:bg-orange-400 dark:text-black dark:hover:bg-orange-500';
  }

  return 'border-border bg-background/85 text-foreground hover:bg-background';
}

export function MaterialCell({ material, rendererName, shouldRenderContent, onOpenReport }: MaterialCellProps) {
  if (!shouldRenderContent) {
    return (
      <figure className="flex w-[170px] flex-none flex-col gap-2 p-1.5 sm:w-[200px]">
        <div className="flex aspect-square w-full items-center justify-center border border-dashed border-border bg-muted/20 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          not loaded
        </div>
        <figcaption className="text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{rendererName}</p>
        </figcaption>
      </figure>
    );
  }

  const imageUrl = material.images[rendererName];
  const reportUrl = material.reports[rendererName];
  const reportSummary = material.reportSummaries[rendererName] ?? null;
  const metrics = material.metrics[rendererName] ?? null;
  const psnrSeverity = getPsnrSeverity(metrics?.psnr ?? null);

  return (
    <figure
      className={cn('flex w-[170px] flex-none flex-col gap-2 p-1.5 sm:w-[200px]', getPsnrRegionClassName(psnrSeverity))}
    >
      <div className="relative">
        {imageUrl ? (
          <img
            alt={`${material.name} rendered by ${rendererName}`}
            className="aspect-square w-full border border-border object-cover"
            loading="lazy"
            src={imageUrl}
          />
        ) : (
          <div
            className="flex aspect-square w-full items-center justify-center border border-dashed border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            missing
          </div>
        )}
        {reportUrl ? (
          <button
            aria-label={`Show render report for ${material.name} on ${rendererName}`}
            className={cn(
              'absolute right-2 bottom-2 inline-flex size-7 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition-colors',
              getReportButtonClassName(reportSummary),
            )}
            onClick={() => onOpenReport({ materialName: material.name, rendererName, reportUrl })}
            type="button"
          >
            <Info className="size-4" />
          </button>
        ) : null}
      </div>
      <RendererMetrics metrics={metrics} severity={psnrSeverity} />
      <figcaption className={cn('text-center text-xs text-muted-foreground', getPsnrRegionClassName(psnrSeverity))}>
        <p className="font-medium text-foreground">{rendererName}</p>
      </figcaption>
    </figure>
  );
}
