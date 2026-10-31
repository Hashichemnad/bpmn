#!/usr/bin/env node
/**
 * Translation check for CI (final session, part A): English and Arabic files of the web app
 * (apps/web/src/locales/{en,ar}/*.json) must have the same files and keys, no empty texts, the
 * same {{placeholders}} (plural forms: Arabic may write the number in words), every plural key
 * has its `_other` form, and Arabic texts must not be untranslated copies of the English ones
 * (except the proper nouns / symbols listed in ALLOWED_SAME). Exit code 1 lists every problem.
 *
 *   node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../apps/web/src/locales/', import.meta.url).pathname;
/** Keys whose Arabic text may equal the English one (product names, formats, symbols). */
const ALLOWED_SAME = new Set([
  'admin:email.secure',
  'admin:auth.providers.ENTRA',
  'ai:settings.providers.anthropic',
  'diagrams:type.SIPOC',
  'diagrams:sipoc.letter.suppliers',
  'diagrams:sipoc.letter.inputs',
  'diagrams:sipoc.letter.steps',
  'diagrams:sipoc.letter.outputs',
  'diagrams:sipoc.letter.customers',
  'diagrams:handbook.includeSipoc',
  'docs:export.markdown',
  'governance:reviewState.NONE',
  'governance:notifications.title.WORKFLOW_message',
  'imports:visio.type',
  'kpi:dataSource.SALESFORCE',
  'kpi:calculated.none',
  'mining:mapping.formats.iso',
  'mining:analysis.excel',
  'mining:sim.alwaysOpen',
  'modeler:exportBpmn',
  'workflow:dashboard.excel',
]);
const ARABIC = /[؀-ۿ]/;
const PLACEHOLDER = /\{\{\s*([\w.]+)[^}]*\}\}/g;

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
const load = (lng) =>
  new Map(
    readdirSync(join(dir, lng))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [
        f.replace(/\.json$/, ''),
        new Map(flatten(JSON.parse(readFileSync(join(dir, lng, f), 'utf8')))),
      ]),
  );

const PLURAL = /_(zero|one|two|few|many|other)$/;
/** Plural keys share a base key; `{{count}}` may be written out in words in some forms. */
const base = (k) => k.replace(PLURAL, '');
const NUMBER_VARS = new Set(['count', 'formatted']);
const placeholdersOf = (s, plural) =>
  [...String(s).matchAll(PLACEHOLDER)]
    .map((m) => m[1])
    .filter((v) => !plural || !NUMBER_VARS.has(v))
    .sort()
    .join(',');

const en = load('en');
const ar = load('ar');
const problems = [];
for (const ns of new Set([...en.keys(), ...ar.keys()])) {
  if (!en.has(ns) || !ar.has(ns)) {
    problems.push(`${ns}.json exists only in ${en.has(ns) ? 'en' : 'ar'}`);
    continue;
  }
  const e = en.get(ns);
  const a = ar.get(ns);
  const bases = (m) => new Set([...m.keys()].map(base));
  const eb = bases(e);
  const ab = bases(a);
  for (const k of eb) if (!ab.has(k)) problems.push(`missing in ar: ${ns}:${k}`);
  for (const k of ab) if (!eb.has(k)) problems.push(`missing in en: ${ns}:${k}`);
  for (const [lng, m] of [
    ['en', e],
    ['ar', a],
  ])
    for (const [k, v] of m) {
      if (typeof v !== 'string' || !v.trim())
        problems.push(`empty or not a text in ${lng}: ${ns}:${k}`);
      // Every plural key needs its "other" form (the fallback for numbers without a form).
      if (PLURAL.test(k) && !m.has(`${base(k)}_other`))
        problems.push(`no _other form in ${lng}: ${ns}:${base(k)}`);
    }
  for (const [k, v] of e) {
    const plural = PLURAL.test(k);
    const ak = plural ? `${base(k)}_other` : k;
    const av = a.get(plural && a.has(k) ? k : ak);
    if (typeof av !== 'string' || typeof v !== 'string') continue;
    const key = `${ns}:${k}`;
    if (av === v && !ARABIC.test(av) && !ALLOWED_SAME.has(key))
      problems.push(`not translated (Arabic equals English): ${key} = ${JSON.stringify(av)}`);
    if (placeholdersOf(v, plural) !== placeholdersOf(av, plural))
      problems.push(
        `placeholders differ: ${key} en {${placeholdersOf(v, plural)}} ar {${placeholdersOf(av, plural)}}`,
      );
  }
}
const total = [...en.values()].reduce((n, m) => n + m.size, 0);
if (problems.length) {
  console.error(`Translation check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Translations OK: ${en.size} namespaces, ${total} keys in English and Arabic.`);
