import { createFileRoute } from '@tanstack/react-router';
import { readFile } from 'node:fs/promises';
import { resolveReferenceImagePath } from '#/lib/material-index';

export const Route = createFileRoute('/api/reference-image/$materialType/$materialName/$adapter')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const filePath = await resolveReferenceImagePath(params.materialType, params.materialName, params.adapter);
        if (!filePath) {
          return new Response('Not found', { status: 404 });
        }

        const bytes = await readFile(filePath);
        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': `public, max-age=${3600}`,
          },
        });
      },
    },
  },
});
