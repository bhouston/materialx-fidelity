export interface ReportLogEntry {
  level?: string;
  source?: string;
  message?: string;
}

interface RenderLogViewerProps {
  logs?: ReportLogEntry[];
}

function normalizeLogLevel(level?: string): 'warning' | 'error' | 'info' {
  const normalizedLevel = level?.trim().toLowerCase();
  if (normalizedLevel === 'warning' || normalizedLevel === 'warn') {
    return 'warning';
  }
  if (normalizedLevel === 'error' || normalizedLevel === 'fatal') {
    return 'error';
  }
  return 'info';
}

function getLogLevelTextClass(level: 'warning' | 'error' | 'info'): string {
  if (level === 'warning') {
    return 'text-orange-800 dark:text-orange-300';
  }
  if (level === 'error') {
    return 'text-red-800 dark:text-red-300';
  }
  return 'text-foreground';
}

export function RenderLogViewer({ logs }: RenderLogViewerProps) {
  if (!logs || logs.length === 0) {
    return <p className="text-muted-foreground">No log messages.</p>;
  }

  return (
    <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/10 p-3">
      <div className="min-w-max space-y-1 font-mono text-xs leading-5">
        {logs.map((entry, index) => {
          const level = normalizeLogLevel(entry.level);
          const levelLabel = level.toUpperCase();
          const sourceLabel = entry.source?.trim().length ? entry.source.trim() : '-';
          const message = (entry.message ?? '(empty message)').replace(/\r?\n/g, '\\n');
          return (
            <p key={`${entry.message ?? 'log'}-${index}`} className={`whitespace-pre ${getLogLevelTextClass(level)}`}>
              {`${levelLabel} [${sourceLabel}] ${message}`}
            </p>
          );
        })}
      </div>
    </div>
  );
}
