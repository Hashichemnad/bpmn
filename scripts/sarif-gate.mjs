#!/usr/bin/env node
/**
 * Fails a CI job when a SARIF report (CodeQL, gitleaks, Trivy …) contains a result at or above a
 * security-severity threshold (CVSS-style: 7.0 = High, 9.0 = Critical). Prints every result to the job
 * summary either way. Final session part B (docs/SECURITY.md §9).
 *
 * Usage: node scripts/sarif-gate.mjs <file-or-directory> [--fail-at 7.0]
 */
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const failAtIndex = args.indexOf('--fail-at');
const failAt = failAtIndex >= 0 ? Number(args[failAtIndex + 1]) : 7.0;
if (!target) {
  console.error('Usage: sarif-gate.mjs <file-or-directory> [--fail-at 7.0]');
  process.exit(2);
}

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => f.endsWith('.sarif'))
      .map((f) => join(target, f))
  : [target];

const rows = [];
for (const file of files) {
  const sarif = JSON.parse(readFileSync(file, 'utf8'));
  for (const run of sarif.runs ?? []) {
    const severity = new Map();
    const components = [run.tool?.driver, ...(run.tool?.extensions ?? [])].filter(Boolean);
    for (const component of components) {
      for (const rule of component.rules ?? []) {
        const value = Number(rule.properties?.['security-severity']);
        severity.set(rule.id, Number.isFinite(value) ? value : null);
      }
    }
    for (const result of run.results ?? []) {
      const ruleId = result.ruleId ?? result.rule?.id ?? '?';
      const level = result.level ?? 'warning';
      // Without a security-severity (e.g. plain quality queries) the SARIF level decides: error → High.
      const score = severity.get(ruleId) ?? (level === 'error' ? 7.0 : 4.0);
      const loc = result.locations?.[0]?.physicalLocation;
      const where = loc
        ? `${loc.artifactLocation?.uri ?? '?'}:${loc.region?.startLine ?? '?'}`
        : '(no location)';
      rows.push({ score, ruleId, where, message: (result.message?.text ?? '').split('\n')[0] });
    }
  }
}

rows.sort((a, b) => b.score - a.score);
const blocking = rows.filter((r) => r.score >= failAt);
const lines = [
  `### SARIF gate (${files.length} file(s), fail at ≥ ${failAt})`,
  '',
  `${rows.length} result(s), ${blocking.length} blocking.`,
  '',
  ...rows.map(
    (r) =>
      `- ${r.score >= failAt ? '❌' : 'ℹ️'} ${r.score.toFixed(1)} \`${r.ruleId}\` ${r.where} — ${r.message}`,
  ),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
process.exit(blocking.length ? 1 : 0);
