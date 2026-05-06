import { DownloadIcon, ExternalLink, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MaterialViewModel, RendererCategoryGroupViewModel } from '#/lib/material-index';
import { MaterialCell } from './MaterialCell';

function toAnchorId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface MaterialRowProps {
  material: MaterialViewModel;
  rendererGroups: RendererCategoryGroupViewModel[];
  onTrackMaterialAction: (action: 'download_mtlx' | 'open_live_viewer', material: MaterialViewModel) => void;
  onInspectMaterial: (material: { materialName: string; materialSourceUrl: string }) => void;
  onOpenReport: (report: { materialName: string; rendererName: string; reportUrl: string }) => void;
}

export function MaterialRow({
  material,
  rendererGroups,
  onTrackMaterialAction,
  onInspectMaterial,
  onOpenReport,
}: MaterialRowProps) {
  const materialId = toAnchorId(material.id);
  const rowContentRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderContent, setShouldRenderContent] = useState(false);

  useEffect(() => {
    const rowContent = rowContentRef.current;
    if (!rowContent || shouldRenderContent) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      setShouldRenderContent(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRenderContent(true);
          observer.disconnect();
        }
      },
      { rootMargin: '900px 0px' },
    );
    observer.observe(rowContent);
    return () => {
      observer.disconnect();
    };
  }, [shouldRenderContent]);

  return (
    <article className="border-b border-border py-4 last:border-b-0">
      <div className="group flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={materialId} className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span>{material.displayPath}</span>
          <a
            aria-label={`Link to ${material.displayPath}`}
            className="text-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            href={`#${materialId}`}
          >
            #
          </a>
        </h3>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-sm">
          <button
            className="inline-flex items-center gap-1 rounded-none border border-border bg-muted/40 px-2.5 py-1.5 font-normal text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
            onClick={() =>
              onInspectMaterial({
                materialName: material.displayPath,
                materialSourceUrl: material.materialSourceUrl,
              })
            }
            type="button"
          >
            <FileText className="size-3.5" />
            <span>Source</span>
          </button>
          <a
            className="inline-flex items-center gap-1 rounded-none border border-border bg-muted/40 px-2.5 py-1.5 font-normal text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
            download
            href={material.downloadMtlxZipUrl}
            onClick={() => onTrackMaterialAction('download_mtlx', material)}
          >
            <DownloadIcon className="size-3.5" />
            <span>Download</span>
          </a>
          <a
            className="inline-flex items-center gap-1 rounded-none border border-border bg-muted/40 px-2.5 py-1.5 font-normal text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
            href={material.liveViewerUrl}
            onClick={() => onTrackMaterialAction('open_live_viewer', material)}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" /> <span>Viewer</span>
          </a>
        </div>
      </div>

      <div className="mt-3 -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6" ref={rowContentRef}>
        <div className="flex w-max min-w-full justify-start gap-px lg:justify-center">
          {rendererGroups.map((rendererGroup, groupIndex) => (
            <div key={rendererGroup.category} className="flex flex-none items-stretch gap-px">
              {rendererGroup.renderers.map((rendererName) => (
                <MaterialCell
                  key={rendererName}
                  material={material}
                  onOpenReport={onOpenReport}
                  rendererName={rendererName}
                  shouldRenderContent={shouldRenderContent}
                />
              ))}
              {groupIndex < rendererGroups.length - 1 ? (
                <div aria-hidden="true" className="mx-2 my-1 w-0.5 self-stretch bg-border/80" />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
