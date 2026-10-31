/**
 * Writes `<file>.gz` (gzip -9) and `<file>.br` (Brotli, quality 11) next to every text asset of
 * dist/assets after `vite build` (final session, part A). nginx serves these precompressed files
 * directly (gzip_static, and the `.br` locations in nginx.conf), so assets are compressed once at
 * build time with the best settings instead of on every request.
 *
 *   node apps/web/scripts/precompress.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const assets = new URL('../dist/assets/', import.meta.url).pathname;
let raw = 0;
let gz = 0;
let br = 0;
let files = 0;
for (const f of readdirSync(assets)) {
  if (!/\.(js|css|svg|json)$/.test(f)) continue;
  const buf = readFileSync(join(assets, f));
  const g = gzipSync(buf, { level: 9 });
  const b = brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  writeFileSync(join(assets, `${f}.gz`), g);
  writeFileSync(join(assets, `${f}.br`), b);
  raw += buf.length;
  gz += g.length;
  br += b.length;
  files++;
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`Precompressed ${files} assets: ${mb(raw)} → gzip ${mb(gz)}, brotli ${mb(br)}`);
