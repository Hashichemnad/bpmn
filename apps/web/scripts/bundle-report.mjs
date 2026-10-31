/**
 * Bundle size report (final session, part A): the JavaScript a browser loads before the first screen
 * (the entry chunk of dist/index.html and every chunk it imports statically) and the largest lazy
 * chunks, gzip and brotli. `--budget=<KB>` fails when the initial JavaScript (gzip) is larger.
 *
 *   pnpm --filter @processhub/web build && node apps/web/scripts/bundle-report.mjs --budget=250
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url).pathname;
const budget = Number(process.argv.find((a) => a.startsWith('--budget='))?.slice(9) ?? 0);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/<script type="module"[^>]*src="\/([^"]+)"/)[1];

const size = (file) => {
  const buf = readFileSync(join(dist, file));
  return {
    raw: buf.length,
    gz: gzipSync(buf, { level: 9 }).length,
    br: brotliCompressSync(buf).length,
  };
};
// Static imports only (`import … from "./x.js"` / `import "./x.js"`), not `import("./x.js")`.
const staticImports = (file) =>
  [
    ...readFileSync(join(dist, file), 'utf8').matchAll(
      /(?:^|[;}\s])import\s*(?:[\w${},*\s]+from\s*)?["']\.\/([^"']+\.js)["']/g,
    ),
  ].map((m) => join('assets', m[1]));
const initial = new Set();
const walk = (f) => {
  if (initial.has(f)) return;
  initial.add(f);
  for (const d of staticImports(f)) walk(d);
};
walk(entry);
const kb = (n) => (n / 1024).toFixed(1);
let total = { raw: 0, gz: 0, br: 0 };
console.log('Initial JavaScript (entry + static imports):');
for (const f of [...initial].sort()) {
  const s = size(f);
  total = { raw: total.raw + s.raw, gz: total.gz + s.gz, br: total.br + s.br };
  console.log(
    `  ${f.padEnd(48)} ${kb(s.raw).padStart(8)} KB  gzip ${kb(s.gz).padStart(7)} KB  br ${kb(s.br).padStart(7)} KB`,
  );
}
console.log(
  `  ${'TOTAL'.padEnd(48)} ${kb(total.raw).padStart(8)} KB  gzip ${kb(total.gz).padStart(7)} KB  br ${kb(total.br).padStart(7)} KB`,
);
const lazy = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js') && !initial.has(join('assets', f)))
  .map((f) => ({ f, ...size(join('assets', f)) }))
  .sort((a, b) => b.gz - a.gz);
console.log(`\nLazy chunks: ${lazy.length}, largest:`);
for (const c of lazy.slice(0, 12))
  console.log(`  ${c.f.padEnd(48)} ${kb(c.raw).padStart(8)} KB  gzip ${kb(c.gz).padStart(7)} KB`);
if (budget && total.gz / 1024 > budget) {
  console.error(`\nInitial JavaScript ${kb(total.gz)} KB gzip is over the budget of ${budget} KB.`);
  process.exit(1);
}
