import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ExternalLink } from 'lucide-react'
import { getViewerIndexData } from '#/lib/material-index'

const getViewerData = createServerFn({
  method: 'GET',
}).handler(async () => getViewerIndexData())

export const Route = createFileRoute('/')({
  loader: () => getViewerData(),
  component: App,
})

function toAnchorId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function App() {
  const data = Route.useLoaderData()

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
      <section>
        <p className="max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          This viewer lists MaterialX sample materials and compares renderer reference renders side-by-side so you can
          quickly spot visual differences and missing captures.
        </p>
        <p className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          Want to compare your own renderer? Contributions are welcome - see the{' '}
          <a
            className="underline underline-offset-2 hover:no-underline"
            href="https://github.com/bhouston/MaterialX-FidelityTesting"
            rel="noreferrer"
            target="_blank"
          >
            GitHub repository
          </a>{' '}
          for integration details.
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

      <div className="border-t border-border" />

      {data.groups.map((group) => {
        const groupId = toAnchorId(group.type)
        return (
          <section key={group.type} className="pt-2">
            <h2 id={groupId} className="group flex items-center gap-2 text-xl font-semibold capitalize text-foreground">
              <span>{group.type}</span>
              <a
                aria-label={`Link to ${group.type}`}
                className="text-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                href={`#${groupId}`}
              >
                #
              </a>
            </h2>

            <div className="mt-3 border-t border-border">
              {group.materials.map((material) => {
                const materialId = `${groupId}-${toAnchorId(material.name)}`
                return (
                  <article key={`${material.type}/${material.name}`} className="border-b border-border py-4 last:border-b-0">
                    <div className="group flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 id={materialId} className="flex items-center gap-2 text-base font-semibold text-foreground">
                        <span>{material.name}</span>
                        <a
                          aria-label={`Link to ${material.name}`}
                          className="text-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                          href={`#${materialId}`}
                        >
                          #
                        </a>
                      </h3>
                      <a
                        className="ml-auto inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2 hover:no-underline"
                        href={material.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span>Source</span>
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </div>

                    <div className="mt-3 overflow-x-auto pb-2">
                      <div className="flex min-w-full justify-center gap-4">
                        {data.renderers.map((rendererName) => {
                          const imageUrl = material.images[rendererName]
                          return (
                            <figure key={rendererName} className="flex w-[170px] flex-none flex-col gap-2 sm:w-[200px]">
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
                              <figcaption className="text-center text-xs font-medium text-muted-foreground">{rendererName}</figcaption>
                            </figure>
                          )
                        })}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </main>
  )
}
