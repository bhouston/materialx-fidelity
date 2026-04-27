/** Trim trailing slashes for stable URL joins. */
export function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Public site origin for canonical URLs and absolute Open Graph images.
 *
 * **Configuration:** set the `BASE_URL` environment variable when running `vite build`
 * (see `vite.config.ts` → `import.meta.env.VITE_BASE_URL`). Docker passes `BASE_URL` into the
 * image build via `ARG`/`ENV` before `pnpm build`.
 *
 * On the client, when the bundle was built without `BASE_URL`, this falls back to
 * `window.location.origin` so local development still resolves absolute preview URLs.
 */
export function getResolvedBaseUrl(options?: { baseUrl?: string }): string {
  if (options?.baseUrl !== undefined && options.baseUrl.length > 0) {
    return trimTrailingSlash(options.baseUrl);
  }

  const fromEnv =
    typeof import.meta.env.VITE_BASE_URL === 'string' ? import.meta.env.VITE_BASE_URL.trim() : '';

  if (fromEnv.length > 0) {
    return trimTrailingSlash(fromEnv);
  }

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`;
  }

  return '';
}

/** Display name (`SITE_NAME` at build time; default in `vite.config.ts`). */
export const SITE_NAME = import.meta.env.VITE_SITE_NAME;

/** Meta / OG description (`SITE_DESCRIPTION` at build time; default in `vite.config.ts`). */
export const SITE_DESCRIPTION = import.meta.env.VITE_SITE_DESCRIPTION;

/** Social preview image path or URL (`DEFAULT_SITE_IMAGE` at build time; default `/Preview.webp`). */
export const DEFAULT_SITE_IMAGE = import.meta.env.VITE_DEFAULT_SITE_IMAGE;
