import { createHash } from 'node:crypto';

function strongEtagFromMd5Content(bytes: Buffer): string {
  const hex = createHash('md5').update(bytes).digest('hex');
  return `"${hex}"`;
}

function ifNoneMatchIncludesStrongEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch?.trim()) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  const canonical = etag.startsWith('W/') ? etag.slice(2) : etag;
  for (const raw of trimmed.split(',')) {
    const token = raw.trim();
    const tokenCanonical = token.startsWith('W/') ? token.slice(2) : token;
    if (tokenCanonical === canonical) return true;
  }
  return false;
}

function cacheControlForReferenceAsset(): string {
  return process.env.NODE_ENV === 'production' ? 'max-age=3600, edge max-age=86400, stale-while-revalidate=3600' : 'public, max-age=60';
}

/** GET response for reference images/reports: MD5 strong ETag and 304 when If-None-Match matches. */
export function referenceAssetGetResponse(request: Request, bytes: Buffer, contentType: string): Response {
  const etag = strongEtagFromMd5Content(bytes);
  const cacheControl = cacheControlForReferenceAsset();
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatchIncludesStrongEtag(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': cacheControl,
      },
    });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': bytes.length.toString(),
      'Cache-Control': cacheControl,
      ETag: etag,
    },
  });
}
