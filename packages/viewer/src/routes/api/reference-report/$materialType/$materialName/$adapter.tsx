import { createFileRoute } from '@tanstack/react-router';
import { readFile } from 'node:fs/promises';
import { resolveReferenceReportPath } from '#/lib/material-index';
import { referenceAssetGetResponse } from '#/lib/reference-asset-response.server';

export const Route = createFileRoute('/api/reference-report/$materialType/$materialName/$adapter')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const filePath = await resolveReferenceReportPath(params.materialType, params.materialName, params.adapter);
        if (!filePath) {
          return new Response('Not found', { status: 404 });
        }

        const bytes = await readFile(filePath);
        return referenceAssetGetResponse(request, bytes, 'application/json; charset=utf-8');
      },
    },
  },
});
