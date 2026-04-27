import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';
import { nitro } from 'nitro/vite';

import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

const viewerRenderers = process.env.VIEWER_RENDERERS ?? '';

/** Injected into the client bundle; override via env at build time (see Dockerfile `ARG` / `ENV`). */
const DEFAULT_SITE_NAME = 'MaterialX Fidelity Test Suite';
const DEFAULT_SITE_DESCRIPTION =
  'Browse MaterialX sample materials and compare renderer reference output side-by-side to spot visual differences and inspect render logs.';
const DEFAULT_SITE_IMAGE = '/Preview.webp';
/** Default `twitter:site` handle; override with `TWITTER_SITE` when building. */
const DEFAULT_TWITTER_SITE = '@BenHouston3D';

const env = process.env;

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  define: {
    'import.meta.env.VITE_VIEWER_RENDERERS': JSON.stringify(viewerRenderers),
    /** Public origin (`https://…`) for canonical URLs and absolute OG/Twitter images. Set `BASE_URL` when building. */
    'import.meta.env.VITE_BASE_URL': JSON.stringify(env.BASE_URL ?? ''),
    'import.meta.env.VITE_SITE_NAME': JSON.stringify(env.SITE_NAME || DEFAULT_SITE_NAME),
    'import.meta.env.VITE_SITE_DESCRIPTION': JSON.stringify(env.SITE_DESCRIPTION || DEFAULT_SITE_DESCRIPTION),
    'import.meta.env.VITE_DEFAULT_SITE_IMAGE': JSON.stringify(env.DEFAULT_SITE_IMAGE || DEFAULT_SITE_IMAGE),
    /** Twitter/X handle for `twitter:site`; defaults to @BenHouston3D unless `TWITTER_SITE` is set when building. */
    'import.meta.env.VITE_TWITTER_SITE': JSON.stringify(env.TWITTER_SITE?.trim() || DEFAULT_TWITTER_SITE),
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    nitro({
      preset: 'node-server',
      routeRules: {
        '/assets/**': {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
          },
        },
      },
    }),
  ],
});

export default config;
