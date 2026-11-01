#!/usr/bin/env node
/**
 * Fails a CI job when a SARIF report (CodeQL, gitleaks, Trivy …) contains a result at or above a
 * security-severity threshold (CVSS-style: 7.0 = High, 9.0 = Critical). Prints every result to the job
 * summary either way. Final session part B (docs/SECURITY.md §9).
 *
 * Usage: node scripts/sarif-gate.mjs <file-or-directory> [--fail-at 7.0] [--accept accepted.json]
 *
 * `--accept` names a reviewed allow-list: [{ "rule": "<rule id>", "path": "<file>", "reason": "…" }]. A
 * matching result is reported as accepted instead of blocking; every entry needs a reason, and entries
 * that no longer match anything are listed so the file stays current.
 */
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const target = args.find(
  (a, i) => !a.startsWith('--') && !['--fail-at', '--accept'].includes(args[i - 1]),
);
const failAtIndex = args.indexOf('--fail-at');
const failAt = failAtIndex >= 0 ? Number(args[failAtIndex + 1]) : 7.0;
const acceptIndex = args.indexOf('--accept');
const accepted = acceptIndex >= 0 ? JSON.parse(readFileSync(args[acceptIndex + 1], 'utf8')) : [];
for (const a of accepted)
  if (!a.rule || !a.path || !a.reason) {
    console.error(`Accepted result without rule, path or reason: ${JSON.stringify(a)}`);
    process.exit(2);
  }
const used = new Set();
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
      const path = loc?.artifactLocation?.uri ?? '';
      const match = accepted.findIndex((a) => a.rule === ruleId && a.path === path);
      if (match >= 0) used.add(match);
      rows.push({
        score,
        ruleId,
        where,
        message: (result.message?.text ?? '').split('\n')[0],
        accepted: match >= 0 ? accepted[match].reason : null,
      });
    }
  }
}

rows.sort((a, b) => b.score - a.score);
const blocking = rows.filter((r) => r.score >= failAt && !r.accepted);
const stale = accepted.filter((_, i) => !used.has(i));
const lines = [
  `### SARIF gate (${files.length} file(s), fail at ≥ ${failAt})`,
  '',
  `${rows.length} result(s), ${blocking.length} blocking.`,
  '',
  ...rows.map(
    (r) =>
      `- ${r.accepted ? '✅ accepted' : r.score >= failAt ? '❌' : 'ℹ️'} ${r.score.toFixed(1)} \`${r.ruleId}\` ${r.where} — ${r.message}${r.accepted ? ` (reason: ${r.accepted})` : ''}`,
  ),
  ...stale.map((a) => `- ⚠️ accepted entry no longer matches: \`${a.rule}\` ${a.path}`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
process.exit(blocking.length ? 1 : 0);
