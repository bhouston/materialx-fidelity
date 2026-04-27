import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useGoogleAnalytics } from 'tanstack-router-ga4';
import Header from '#/components/Header';
import { MaterialRow } from '#/components/MaterialRow';
import { RenderLogViewer } from '#/components/RenderLogViewer';
import type { ReportLogEntry } from '#/components/RenderLogViewer';
import { getViewerIndexData } from '#/lib/material-index';
import { getRendererMetadata } from '#/lib/renderer-metadata';

const getViewerData = createServerFn({
  method: 'GET',
}).handler(async () => getViewerIndexData());

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => {
    const materials = typeof search.materials === 'string' ? search.materials.trim() : '';
    return {
      materials: materials.length > 0 ? materials : undefined,
    };
  },
  loader: () => getViewerData(),
  component: App,
});

function normalizeMaterialFilters(materialFilter: string | undefined): string[] {
  if (!materialFilter) {
    return [];
  }

  return [
    ...new Set(
      materialFilter
        .split(',')
        .map((filter) => filter.trim().toLocaleLowerCase())
        .filter((filter) => filter.length > 0),
    ),
  ];
}

interface ReportIssue {
  level?: string;
  location?: string;
  message?: string;
}

interface ReportError {
  name?: string;
  message?: string;
  stack?: string;
}

interface RenderReport {
  rendererName?: string;
  status?: string;
  error?: ReportError | null;
  validationIssues?: ReportIssue[];
  issues?: ReportIssue[];
  logs?: ReportLogEntry[];
}

interface ActiveReportState {
  materialName: string;
  rendererName: string;
  reportUrl: string;
}

function App() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const ga = useGoogleAnalytics();
  const [materialFilterInput, setMaterialFilterInput] = useState(search.materials ?? '');
  const materialSearchTerms = normalizeMaterialFilters(search.materials);
  const [activeReport, setActiveReport] = useState<ActiveReportState | null>(null);
  const [activeReportData, setActiveReportData] = useState<RenderReport | null>(null);
  const [activeReportError, setActiveReportError] = useState<string | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const hasMaterialFilterChangedRef = useRef(false);
  const lastTrackedMaterialFilterRef = useRef(search.materials?.trim() ?? '');
  const filteredGroups = data.groups
    .map((group) => ({
      ...group,
      materials: group.materials.filter(
        (material) => {
          if (materialSearchTerms.length === 0) {
            return true;
          }
          const lowerName = material.name.toLocaleLowerCase();
          const lowerDisplayPath = material.displayPath.toLocaleLowerCase();
          return materialSearchTerms.some(
            (term) => lowerName.includes(term) || lowerDisplayPath.includes(term),
          );
        },
      ),
    }))
    .filter((group) => group.materials.length > 0);
  const filteredMaterials = filteredGroups.flatMap((group) =>
    group.materials.map((material) => ({
      ...material,
      type: group.type,
    })),
  );
  const shownMaterialCount = filteredGroups.reduce((total, group) => total + group.materials.length, 0);
  const totalMaterialCount = data.groups.reduce((total, group) => total + group.materials.length, 0);

  useEffect(() => {
    if (!activeReport) {
      return;
    }

    const abortController = new AbortController();
    const fetchReport = async () => {
      setIsReportLoading(true);
      setActiveReportData(null);
      setActiveReportError(null);
      try {
        const response = await fetch(activeReport.reportUrl, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`Failed to load report (${response.status})`);
        }
        const json = (await response.json()) as RenderReport;
        setActiveReportData(json);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        setActiveReportError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!abortController.signal.aborted) {
          setIsReportLoading(false);
        }
      }
    };

    void fetchReport();

    return () => {
      abortController.abort();
    };
  }, [activeReport]);

  useEffect(() => {
    setMaterialFilterInput(search.materials ?? '');
  }, [search.materials]);

  useEffect(() => {
    if (!hasMaterialFilterChangedRef.current) {
      return;
    }

    const normalizedFilter = search.materials?.trim() ?? '';
    if (normalizedFilter === lastTrackedMaterialFilterRef.current) {
      hasMaterialFilterChangedRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      ga.event('material_filter', {
        material_filter_value: normalizedFilter,
        material_filter_length: normalizedFilter.length,
        material_filter_is_empty: normalizedFilter.length === 0,
      });
      lastTrackedMaterialFilterRef.current = normalizedFilter;
      hasMaterialFilterChangedRef.current = false;
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [ga, search.materials]);

  useEffect(() => {
    if (!activeReport) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveReport(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeReport]);

  const trackMaterialAction = (
    action: 'download_mtlx' | 'open_live_viewer',
    material: {
      type: string;
      name: string;
      downloadMtlxZipUrl: string;
      liveViewerUrl: string;
    },
  ) => {
    const destinationUrl = action === 'download_mtlx' ? material.downloadMtlxZipUrl : material.liveViewerUrl;

    ga.event(action, {
      material_name: material.name,
      material_type: material.type,
      destination_url: destinationUrl,
    });
  };

  const updateFilters = (next: { materials: string | undefined }) => {
    navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        materials: next.materials,
      }),
    });
  };

  const handleMaterialSearchChange = (value: string) => {
    setMaterialFilterInput(value);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const trimmed = materialFilterInput.trim();
      const nextMaterials = trimmed.length > 0 ? materialFilterInput : undefined;
      if ((search.materials ?? '') === (nextMaterials ?? '')) {
        return;
      }
      hasMaterialFilterChangedRef.current = true;
      updateFilters({
        materials: nextMaterials,
      });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [materialFilterInput, search.materials]);

  return (
    <>
      <Header
        materialFilter={materialFilterInput}
        onMaterialFilterChange={handleMaterialSearchChange}
        shownMaterialCount={shownMaterialCount}
        totalMaterialCount={totalMaterialCount}
      />
      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 py-6 sm:px-6">
        <section>
        <p className="max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          This viewer lists{' '}
          <a
            className="underline underline-offset-2 hover:no-underline"
            href="https://materialx.org/"
            rel="noreferrer"
            target="_blank"
          >
            MaterialX
          </a>{' '}
          sample materials and compares renderer reference renders side-by-side so you can quickly spot visual
          differences and view render log/error output (click the <Info className="size-4 inline-block" /> icons).
        </p>
        <div className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          <p className="font-medium text-foreground">Enabled renderers:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {data.renderers.map((rendererName) => {
              const metadata = getRendererMetadata(rendererName);
              return (
                <li key={rendererName}>
                  <code className="font-semibold text-foreground">{rendererName}</code>
                  {metadata ? (
                    <>
                      {' - '}
                      <a
                        className="underline underline-offset-2 hover:no-underline"
                        href={metadata.packageUrl}
                        target="_blank"
                      >
                        {metadata.packageName}
                      </a>{' '}
                      - {metadata.observerDescription}
                    </>
                  ) : (
                    ' - Renderer is enabled but has no description metadata yet.'
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          <p>Want to contribute?</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/bhouston/material-fidelity"
                target="_blank"
              >
                Add your own renderer here.
              </a>
            </li>
            <li>
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/bhouston/material-samples"
                target="_blank"
              >
                Add more reference samples here.
              </a>
            </li>
          </ul>
        </div>
        <p className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          This is an independent project maintained by{' '}
          <a className="underline underline-offset-2 hover:no-underline" href="https://ben3d.ca" target="_blank">
            Ben Houston
          </a>
          , and sponsored by{' '}
          <a
            className="underline underline-offset-2 hover:no-underline"
            href="https://landofassets.com"
            target="_blank"
          >
            Land of Assets
          </a>
          .
        </p>
      </section>

      {data.errors.length > 0 && (
        <section className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <h2 className="text-base font-semibold">Configuration warnings</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {data.errors.map((errorMessage) => (
              <li key={errorMessage}>{errorMessage}</li>
            ))}
          </ul>
        </section>
      )}

        <section className="pt-2">
          {filteredMaterials.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              onOpenReport={setActiveReport}
              onTrackMaterialAction={trackMaterialAction}
              rendererGroups={data.rendererGroups}
            />
          ))}
        </section>

        {activeReport ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setActiveReport(null)}
            role="presentation"
          >
            <section
              aria-modal="true"
              className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-background shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Render report</h3>
                  <p className="text-sm text-muted-foreground">
                    {activeReport.materialName} - {activeReport.rendererName}
                  </p>
                </div>
                <button
                  aria-label="Close report dialog"
                  className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setActiveReport(null)}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </header>

              <div className="space-y-4 px-5 py-4 text-sm">
              {isReportLoading ? <p className="text-muted-foreground">Loading report...</p> : null}

              {activeReportError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                  {activeReportError}
                </p>
              ) : null}

              {activeReportData ? (
                <>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                      <p className="font-medium text-foreground">{activeReportData.status ?? 'unknown'}</p>
                    </div>
                  </div>

                  {activeReportData.error ? (
                    <section className="space-y-2">
                      <h4 className="font-semibold text-foreground">Error</h4>
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                        <p className="font-medium text-destructive">
                          {activeReportData.error.name ? `${activeReportData.error.name}: ` : ''}
                          {activeReportData.error.message ?? 'Unknown error'}
                        </p>
                        {activeReportData.error.stack ? (
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-destructive">
                            {activeReportData.error.stack}
                          </pre>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {(activeReportData.validationIssues?.length || activeReportData.issues?.length) && (
                    <section className="space-y-2">
                      <h4 className="font-semibold text-foreground">Validation issues</h4>
                      <ul className="space-y-2">
                        {(activeReportData.validationIssues ?? activeReportData.issues ?? []).map((issue, index) => (
                          <li
                            key={`${issue.location ?? 'issue'}-${index}`}
                            className="rounded-md border border-border px-3 py-2"
                          >
                            <p className="font-medium text-foreground">
                              {issue.level ?? 'issue'} {issue.location ? `- ${issue.location}` : ''}
                            </p>
                            <p className="mt-1 text-muted-foreground">{issue.message ?? 'No message provided.'}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="space-y-2">
                    <h4 className="font-semibold text-foreground">Log messages</h4>
                    <RenderLogViewer logs={activeReportData.logs} />
                  </section>
                </>
              ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </>
  );
}
