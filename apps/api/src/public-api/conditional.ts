import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import type { Dated } from './public-api.service';

/**
 * Sends a public API response with validators: a weak ETag of the body and Last-Modified (newest
 * change among the returned rows). `If-None-Match` / `If-Modified-Since` answer 304 without a body,
 * so scheduled refreshes (Power BI, sync jobs) transfer only what changed.
 */
export function sendConditional(
  req: Request,
  res: Response,
  dated: Dated<unknown>,
  type: 'json' | 'xml' | 'svg' = 'json',
): void {
  const payload =
    type === 'json'
      ? Buffer.from(JSON.stringify(dated.body))
      : Buffer.isBuffer(dated.body)
        ? dated.body
        : Buffer.from(String(dated.body));
  const etag = `W/"${createHash('sha1').update(payload).digest('base64url')}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (dated.lastModified) res.setHeader('Last-Modified', dated.lastModified.toUTCString());

  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const notModified =
    typeof inm === 'string'
      ? inm
          .split(',')
          .map((t) => t.trim())
          .some((t) => t === etag || t === '*' || t === etag.slice(2))
      : typeof ims === 'string' && !!dated.lastModified
        ? Math.floor(dated.lastModified.getTime() / 1000) <= Math.floor(Date.parse(ims) / 1000)
        : false;
  if (notModified) {
    res.status(304).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    type === 'json'
      ? 'application/json; charset=utf-8'
      : type === 'xml'
        ? 'application/xml; charset=utf-8'
        : 'image/svg+xml; charset=utf-8',
  );
  if (type === 'svg')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; font-src data:",
    );
  res.status(200).end(payload);
}
