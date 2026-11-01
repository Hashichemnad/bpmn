#!/usr/bin/env node
/**
 * Licence check of every production dependency (web, api, renderer, shared) — final session part B.
 *
 * Fails when a shipped package has a copyleft licence (GPL, AGPL, LGPL, SSPL, EUPL, OSL, CDDL, EPL …) or a
 * licence that is neither on the allow-list nor reviewed below. SPDX expressions are honoured:
 * "A OR B" passes when one side is allowed (e.g. jszip "MIT OR GPL-3.0-or-later" is used under MIT),
 * "A AND B" only when both are.
 *
 * Usage: node scripts/check-licenses.mjs            (runs `pnpm licenses list --prod --json`)
 *        node scripts/check-licenses.mjs file.json  (reads a saved listing)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Permissive licences allowed in the shipped application. */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'MIT/X11',
  'ISC',
  '0BSD',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Zlib',
  'PSF-2.0',
  'Python-2.0',
  'OFL-1.1', // self-hosted fonts (Inter, IBM Plex Sans Arabic)
  'CC-BY-4.0',
]);

/**
 * Packages without a machine-readable SPDX licence, reviewed by hand (docs/SECURITY.md §9).
 * The bpmn.io licence is permissive (MIT-style) with one condition: the bpmn.io watermark shown by the
 * viewer / editor must stay visible and unchanged — ProcessHub never hides it.
 */
const REVIEWED = {
  'bpmn-js': 'bpmn.io licence (MIT-style, watermark must stay visible)',
  'dmn-js': 'bpmn.io licence (MIT-style, watermark must stay visible)',
  'dmn-js-boxed-expression': 'bpmn.io licence',
  'dmn-js-decision-table': 'bpmn.io licence',
  'dmn-js-drd': 'bpmn.io licence',
  'dmn-js-literal-expression': 'bpmn.io licence',
  'dmn-js-shared': 'bpmn.io licence',
  'form-js': 'bpmn.io licence',
  buffers: 'MIT/X11 (licence text in the README, no package.json field)',
  'component-props': 'MIT (licence in the repository, no package.json field)',
};

function allowed(expression) {
  const expr = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/\s+OR\s+/i.test(expr)) return expr.split(/\s+OR\s+/i).some(allowed);
  if (/\s+AND\s+/i.test(expr)) return expr.split(/\s+AND\s+/i).every(allowed);
  return ALLOWED.has(expr.replace(/^\(|\)$/g, ''));
}

const raw = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
const listing = JSON.parse(raw);

const problems = [];
let count = 0;
for (const [licence, packages] of Object.entries(listing)) {
  for (const pkg of packages) {
    count += 1;
    if (allowed(licence)) continue;
    if (REVIEWED[pkg.name]) continue;
    problems.push(`${pkg.name}@${(pkg.versions ?? []).join(',')}: ${licence}`);
  }
}

if (problems.length) {
  console.error(`Licence check failed — ${problems.length} package(s) need a review:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    'Allowed: permissive licences only (see scripts/check-licenses.mjs, docs/SECURITY.md §9).',
  );
  process.exit(1);
}
console.log(
  `Licence check passed: ${count} production packages, no copyleft or unreviewed licences.`,
);
