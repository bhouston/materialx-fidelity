/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VIEWER_RENDERERS: string;
  readonly VITE_BASE_URL: string;
  readonly VITE_SITE_NAME: string;
  readonly VITE_SITE_DESCRIPTION: string;
  readonly VITE_DEFAULT_SITE_IMAGE: string;
  readonly VITE_TWITTER_SITE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
