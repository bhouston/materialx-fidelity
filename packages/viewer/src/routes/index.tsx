import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getViewerIndexData } from '#/lib/material-index'

const getViewerData = createServerFn({
  method: 'GET',
}).handler(async () => getViewerIndexData())

export const Route = createFileRoute('/')({
  loader: () => getViewerData(),
  component: App,
})

function App() {
  const data = Route.useLoaderData()

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-8 sm:px-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          MaterialX Fidelity Reference Viewer
        </h1>
        <p className="mt-4 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
          This viewer lists MaterialX sample materials and compares renderer reference renders side-by-side so you can
          quickly spot visual differences and missing captures. It follows the spirit of the{' '}
          <a
            className="underline underline-offset-2 hover:no-underline"
            href="https://github.khronos.org/glTF-Render-Fidelity/"
            rel="noreferrer"
            target="_blank"
          >
            Khronos glTF Render Fidelity
          </a>{' '}
          comparison format while focusing on MaterialX sample content.
        </p>
        <p className="mt-3 text-xs text-muted-foreground sm:text-sm">
          Source materials: {data.resolvedThirdPartyRoot}/materialx-samples/materials
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

      {data.groups.map((group) => (
        <section key={group.type} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-xl font-semibold capitalize text-foreground">{group.type}</h2>

          <div className="flex flex-col gap-5">
            {group.materials.map((material) => (
              <article key={`${material.type}/${material.name}`} className="rounded-xl border border-border bg-background p-4">
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-base font-semibold text-foreground">{material.name}</h3>
                  <a
                    className="text-sm text-primary underline underline-offset-2 hover:no-underline"
                    href={material.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View in materialx-samples
                  </a>
                </div>

                <div className="flex flex-wrap gap-4">
                  {data.renderers.map((rendererName) => {
                    const imageUrl = material.images[rendererName]
                    return (
                      <figure key={rendererName} className="flex w-[170px] flex-col gap-2 sm:w-[200px]">
                        {imageUrl ? (
                          <img
                            alt={`${material.name} rendered by ${rendererName}`}
                            className="aspect-square w-full rounded-md border border-border object-cover"
                            loading="lazy"
                            src={imageUrl}
                          />
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-white text-sm font-semibold uppercase tracking-wide text-slate-700">
                            missing
                          </div>
                        )}
                        <figcaption className="text-center text-xs font-medium text-muted-foreground">{rendererName}</figcaption>
                      </figure>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
