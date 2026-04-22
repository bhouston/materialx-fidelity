import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { ExternalLink, DownloadIcon, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useGoogleAnalytics } from 'tanstack-router-ga4';
import { getViewerIndexData } from '#/lib/material-index';

const SURFACE_TYPES = ['gltf_pbr', 'open_pbr_surface', 'standard_surface'] as const;
type SurfaceType = (typeof SURFACE_TYPES)[number];

function toCsvSurfaceSelection(value: readonly SurfaceType[]): string | undefined {
  if (value.length === SURFACE_TYPES.length) {
    return undefined;
  }
  return value.join(',');
}

function toSelectedSurfaceTypes(rawValue: unknown): SurfaceType[] {
  if (typeof rawValue !== 'string') {
    return [...SURFACE_TYPES];
  }

  const selected = rawValue
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is SurfaceType => SURFACE_TYPES.includes(part as SurfaceType))
    .filter((part, index, array) => array.indexOf(part) === index);

  if (selected.length === 0) {
    return [...SURFACE_TYPES];
  }

  return selected;
}

const getViewerData = createServerFn({
  method: 'GET',
}).handler(async () => getViewerIndexData());

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => {
    const materials = typeof search.materials === 'string' ? search.materials.trim() : '';
    const selectedSurfaces = toSelectedSurfaceTypes(search.surfaces);
    return {
      materials: materials.length > 0 ? materials : undefined,
      surfaces: toCsvSurfaceSelection(selectedSurfaces),
    };
  },
  loader: () => getViewerData(),
  component: App,
});

function toAnchorId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface ReportLogEntry {
  level?: string;
  source?: string;
  message?: string;
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
  const selectedSurfaces = toSelectedSurfaceTypes(search.surfaces);
  const selectedSurfaceSet = new Set(selectedSurfaces);
  const materialSearch = search.materials?.trim().toLocaleLowerCase() ?? '';
  const [activeReport, setActiveReport] = useState<ActiveReportState | null>(null);
  const [activeReportData, setActiveReportData] = useState<RenderReport | null>(null);
  const [activeReportError, setActiveReportError] = useState<string | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const filteredGroups = data.groups
    .filter((group) => selectedSurfaceSet.has(group.type as SurfaceType))
    .map((group) => ({
      ...group,
      materials: group.materials.filter((material) => material.name.toLocaleLowerCase().includes(materialSearch)),
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
    action: 'download_mtlx' | 'open_live_viewer' | 'open_source',
    material: {
      type: string;
      name: string;
      downloadMtlxZipUrl: string;
      liveViewerUrl: string;
      sourceUrl: string;
    },
  ) => {
    const destinationUrl =
      action === 'download_mtlx'
        ? material.downloadMtlxZipUrl
        : action === 'open_live_viewer'
          ? material.liveViewerUrl
          : material.sourceUrl;

    ga.event(action, {
      material_name: material.name,
      material_type: material.type,
      destination_url: destinationUrl,
    });
  };

  const updateFilters = (next: { materials: string | undefined; surfaces: readonly SurfaceType[] }) => {
    navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        materials: next.materials,
        surfaces: toCsvSurfaceSelection(next.surfaces),
      }),
    });
  };

  const handleMaterialSearchChange = (value: string) => {
    const trimmed = value.trim();
    updateFilters({
      materials: trimmed.length > 0 ? value : undefined,
      surfaces: selectedSurfaces,
    });
  };

  const handleSurfaceToggle = (surfaceType: SurfaceType, checked: boolean) => {
    const nextSelected = checked
      ? [...new Set([...selectedSurfaces, surfaceType])]
      : selectedSurfaces.filter((value) => value !== surfaceType);
    const normalizedSelected = nextSelected.length > 0 ? nextSelected : [...SURFACE_TYPES];

    updateFilters({
      materials: search.materials,
      surfaces: normalizedSelected,
    });
  };

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
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
          differences and missing captures.
        </p>
        <div className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          <p className="font-medium text-foreground">Supported renderers:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/bhouston/MaterialX-FidelityTesting/tree/main/packages/renderer-materialxview"
                target="_blank"
              >
                @materialx-fidelity/renderer-materialxview
              </a>{' '}
              - Creates renders using the official{' '}
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/AcademySoftwareFoundation/MaterialX/blob/main/documents/DeveloperGuide/Viewer.md"
                target="_blank"
              >
                MaterialX Viewer
              </a>
              .
            </li>
            <li>
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/bhouston/MaterialX-FidelityTesting/tree/main/packages/renderer-threejs"
                target="_blank"
              >
                @materialx-fidelity/renderer-threejs
              </a>{' '}
              - Uses the MaterialXLoader from the{' '}
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://threejs.org/"
                target="_blank"
              >
                Three.js project
              </a>{' '}
              with the WebGPU Renderer.
            </li>
          </ul>
        </div>
        <div className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          <p>Want to contribute?</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/bhouston/materialx-fidelity"
                target="_blank"
              >
                Add your own renderer here.
              </a>
            </li>
            <li>
              <a
                className="underline underline-offset-2 hover:no-underline"
                href="https://github.com/bhouston/materialx-samples"
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

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Material name filter
            <input
              className="h-10 rounded-none border border-border bg-background px-3 text-sm font-normal text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              onChange={(event) => handleMaterialSearchChange(event.currentTarget.value)}
              placeholder="Search materials..."
              type="text"
              value={search.materials ?? ''}
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Surface types</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {SURFACE_TYPES.map((surfaceType) => (
                <label key={surfaceType} className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    checked={selectedSurfaceSet.has(surfaceType)}
                    className="size-4 border-border accent-primary"
                    onChange={(event) => handleSurfaceToggle(surfaceType, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{surfaceType}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Showing {shownMaterialCount} materials of {totalMaterialCount} total
        </p>
      </section>

      <div className="border-t border-border" />

      <section className="pt-2">
        <div className="border-t border-border">
          {filteredMaterials.map((material) => {
            const materialId = toAnchorId(`${material.type}-${material.name}`);
            return (
              <article
                key={`${material.type}/${material.name}`}
                className="border-b border-border py-4 last:border-b-0"
              >
                <div className="group flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 id={materialId} className="flex items-center gap-2 text-base font-semibold text-foreground">
                    <span>
                      {material.type} / {material.name}
                    </span>
                    <a
                      aria-label={`Link to ${material.type} / ${material.name}`}
                      className="text-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      href={`#${materialId}`}
                    >
                      #
                    </a>
                  </h3>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-sm">
                    <a
                      className="inline-flex items-center gap-1 rounded-none border border-border bg-muted/40 px-2.5 py-1.5 font-normal text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
                      download
                      href={material.downloadMtlxZipUrl}
                      onClick={() => trackMaterialAction('download_mtlx', material)}
                    >
                      <DownloadIcon className="size-3.5" />
                      <span>Download</span>
                    </a>
                    <a
                      className="inline-flex items-center gap-1 rounded-none border border-border bg-muted/40 px-2.5 py-1.5 font-normal text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
                      href={material.liveViewerUrl}
                      onClick={() => trackMaterialAction('open_live_viewer', material)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink aria-hidden="true" className="size-3.5" /> <span>Viewer</span>
                    </a>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto pb-2">
                  <div className="flex min-w-full justify-center gap-4">
                    {data.rendererGroups.map((rendererGroup, groupIndex) => (
                      <div key={rendererGroup.category} className="flex flex-none items-stretch gap-4">
                        {rendererGroup.renderers.map((rendererName) => {
                          const imageUrl = material.images[rendererName];
                          const reportUrl = material.reports[rendererName];
                          return (
                            <figure key={rendererName} className="flex w-[170px] flex-none flex-col gap-2 sm:w-[200px]">
                              <div className="relative">
                                {imageUrl ? (
                                  <img
                                    alt={`${material.name} rendered by ${rendererName}`}
                                    className="aspect-square w-full border border-border object-cover"
                                    loading="lazy"
                                    src={imageUrl}
                                  />
                                ) : (
                                  <div className="flex aspect-square w-full items-center justify-center border border-dashed border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    missing
                                  </div>
                                )}
                                {reportUrl ? (
                                  <button
                                    aria-label={`Show render report for ${material.name} on ${rendererName}`}
                                    className="absolute right-2 bottom-2 inline-flex size-7 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
                                    onClick={() =>
                                      setActiveReport({ materialName: material.name, rendererName, reportUrl })
                                    }
                                    type="button"
                                  >
                                    <Info className="size-4" />
                                  </button>
                                ) : null}
                              </div>
                              <figcaption className="text-center text-xs font-medium text-muted-foreground">
                                {rendererName}
                              </figcaption>
                            </figure>
                          );
                        })}
                        {groupIndex < data.rendererGroups.length - 1 ? (
                          <div aria-hidden="true" className="my-1 w-px self-stretch bg-border" />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
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
                    {activeReportData.logs && activeReportData.logs.length > 0 ? (
                      <ul className="space-y-2">
                        {activeReportData.logs.map((entry, index) => (
                          <li
                            key={`${entry.message ?? 'log'}-${index}`}
                            className="rounded-md border border-border px-3 py-2"
                          >
                            <p className="font-medium text-foreground">
                              {(entry.level ?? 'log').toUpperCase()}
                              {entry.source ? ` - ${entry.source}` : ''}
                            </p>
                            <p className="mt-1 text-muted-foreground">{entry.message ?? '(empty message)'}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No log messages.</p>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
