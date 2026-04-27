import { createFileRoute } from '@tanstack/react-router';
import { readFile } from 'node:fs/promises';
import { resolveReferenceReportPath } from '#/lib/material-index';

export const Route = createFileRoute('/api/reference-report/$materialType/$materialName/$adapter')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const filePath = await resolveReferenceReportPath(params.materialType, params.materialName, params.adapter);
        if (!filePath) {
          return new Response('Not found', { status: 404 });
        }

        const bytes = await readFile(filePath);
        const cacheControl =
          process.env.NODE_ENV === 'production'
            ? 'public, max-age=86400'
            : 'no-store';
        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': bytes.length.toString(),
            'Cache-Control': cacheControl,
          },
        });
      },
    },
  },
});
