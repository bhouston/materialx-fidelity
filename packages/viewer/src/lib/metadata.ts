import {
  DEFAULT_SITE_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  getResolvedBaseUrl,
  trimTrailingSlash,
} from '#/lib/site-config';

export type MetadataItem =
  | { title?: string; name?: string; content?: string; property?: string; charSet?: string }
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

export type HeadLinkItem = {
  rel: string;
  href: string;
  type?: string;
  title?: string;
};

export type HeadScriptItem = {
  type: string;
  children: string;
};

export interface MetadataOptions {
  title: string;
  baseUrl?: string;

  description?: string;
  canonicalUrl?: string;

  ogType?: 'website' | 'article' | 'profile';
  ogUrl?: string;
  ogImage?: string;

  twitterCard?: 'summary' | 'summary_large_image';
  twitterImage?: string;

  /** Relative to site root (e.g. `/Preview.webp`) unless an absolute URL. */
  imageUrl?: string;

  /** When true, emits `<meta name="robots" content="none">`. */
  noindex?: boolean;
}

export interface HeadOptions extends MetadataOptions {
  jsonLd?: Record<string, unknown>;
  links?: HeadLinkItem[];
  scripts?: HeadScriptItem[];
}

function defaultOgImage(baseUrl: string): string {
  const path = DEFAULT_SITE_IMAGE.startsWith('/') ? DEFAULT_SITE_IMAGE : `/${DEFAULT_SITE_IMAGE}`;
  return baseUrl ? `${trimTrailingSlash(baseUrl)}${path}` : path;
}

/**
 * Page-level meta tags following the same layering as bhouston-website: resolved base URL,
 * Open Graph, and Twitter Cards.
 */
export const getMeta = (options: MetadataOptions): MetadataItem[] => {
  const baseUrl = getResolvedBaseUrl(options);

  const ogType = options.ogType ?? 'website';
  const description = options.description ?? SITE_DESCRIPTION;

  const canonicalUrl =
    options.canonicalUrl ??
    options.ogUrl ??
    (baseUrl ? `${trimTrailingSlash(baseUrl)}/` : '');

  const ogUrl = options.ogUrl ?? canonicalUrl;

  const ogImage = options.ogImage ?? options.imageUrl ?? defaultOgImage(baseUrl);
  const twitterImage = options.twitterImage ?? options.imageUrl ?? defaultOgImage(baseUrl);

  const twitterCard = options.twitterCard ?? 'summary_large_image';

  const metadata: MetadataItem[] = [];

  metadata.push({ title: options.title });
  metadata.push({ name: 'description', content: description });

  if (options.noindex) {
    metadata.push({ name: 'robots', content: 'none' });
  }

  metadata.push({ property: 'og:title', content: options.title });
  metadata.push({ property: 'og:description', content: description });
  metadata.push({ property: 'og:type', content: ogType });
  if (ogUrl) {
    metadata.push({ property: 'og:url', content: ogUrl });
  }
  metadata.push({ property: 'og:image', content: ogImage });
  metadata.push({ property: 'og:site_name', content: SITE_NAME });
  metadata.push({ property: 'og:image:type', content: 'image/webp' });

  metadata.push({ name: 'twitter:card', content: twitterCard });
  metadata.push({ name: 'twitter:title', content: options.title });
  metadata.push({ name: 'twitter:description', content: description });
  metadata.push({ name: 'twitter:image', content: twitterImage });
  metadata.push({
    name: 'twitter:image:alt',
    content: 'Screenshot of the MaterialX fidelity viewer comparing renderer outputs.',
  });

  const twitterSite =
    typeof import.meta.env.VITE_TWITTER_SITE === 'string' ? import.meta.env.VITE_TWITTER_SITE.trim() : '';
  if (twitterSite.length > 0) {
    metadata.push({ name: 'twitter:site', content: twitterSite });
  }

  return metadata;
};

/**
 * Route `head` payload: meta entries, canonical link, optional JSON-LD script (see bhouston-website `getHead`).
 */
export const getHead = (options: HeadOptions) => {
  const baseUrl = getResolvedBaseUrl(options);

  const canonicalUrl =
    options.canonicalUrl ??
    options.ogUrl ??
    (baseUrl ? `${trimTrailingSlash(baseUrl)}/` : '');

  const meta = getMeta(options);

  const links: HeadLinkItem[] = [];
  if (canonicalUrl) {
    links.push({ rel: 'canonical', href: canonicalUrl });
  }
  links.push(...(options.links ?? []));

  const scripts: HeadScriptItem[] = [...(options.scripts ?? [])];
  if (options.jsonLd) {
    scripts.push({
      type: 'application/ld+json',
      children: JSON.stringify(options.jsonLd),
    });
  }

  return {
    meta,
    ...(links.length > 0 ? { links } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  };
};
