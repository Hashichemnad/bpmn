import { evaluate, parseExpression, parseUnaryTests, unaryTest } from 'feelin';
import type { Locale } from '@processhub/shared';

/**
 * DMN decision tables in the browser (D-123): read the model from DMN XML, evaluate a decision
 * with feelin (FEEL unary tests per input entry, FEEL expressions per output entry, all hit
 * policies), check the tables, and keep the names in two languages (`ph:nameEn` / `ph:nameAr`,
 * rule annotations `ph:annotationEn` / `ph:annotationAr`; `name` / `label` / `description` stay
 * English so other DMN tools read them).
 */

const DMN_NS = 'https://www.omg.org/spec/DMN/20191111/MODEL/';
const PH_NS = 'http://processhub.io/schema/bpmn';

export interface DmnInput {
  id: string;
  label: string;
  expression: string;
  typeRef: string;
}
export interface DmnOutput {
  id: string;
  label: string;
  name: string;
  typeRef: string;
}
export interface DmnRule {
  id: string;
  inputEntries: string[];
  outputEntries: string[];
  annotation: string;
}
export interface DmnDecision {
  id: string;
  name: string;
  nameEn: string;
  nameAr: string;
  hitPolicy: string;
  aggregation: string | null;
  inputs: DmnInput[];
  outputs: DmnOutput[];
  rules: DmnRule[];
  /** False for decisions without a decision table (literal expressions …). */
  isTable: boolean;
}

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
const children = (el: Element, local: string) =>
  Array.from(el.children).filter((c) => c.localName === local);

export function parseDmnXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
  return doc;
}

/** Decisions with their decision tables. */
export function readDecisions(xml: string): DmnDecision[] {
  const doc = parseDmnXml(xml);
  return Array.from(doc.getElementsByTagNameNS('*', 'decision')).map((d) => {
    const table = children(d, 'decisionTable')[0];
    const name = d.getAttribute('name') ?? '';
    return {
      id: d.getAttribute('id') ?? '',
      name,
      nameEn: d.getAttributeNS(PH_NS, 'nameEn') || name,
      nameAr: d.getAttributeNS(PH_NS, 'nameAr') ?? '',
      hitPolicy: table?.getAttribute('hitPolicy') ?? 'UNIQUE',
      aggregation: table?.getAttribute('aggregation') ?? null,
      isTable: !!table,
      inputs: table
        ? children(table, 'input').map((i) => {
            const expr = children(i, 'inputExpression')[0];
            return {
              id: i.getAttribute('id') ?? '',
              label: i.getAttribute('label') ?? '',
              expression: text(expr ? children(expr, 'text')[0] : null),
              typeRef: expr?.getAttribute('typeRef') ?? 'string',
            };
          })
        : [],
      outputs: table
        ? children(table, 'output').map((o) => ({
            id: o.getAttribute('id') ?? '',
            label: o.getAttribute('label') ?? '',
            name: o.getAttribute('name') ?? '',
            typeRef: o.getAttribute('typeRef') ?? 'string',
          }))
        : [],
      rules: table
        ? children(table, 'rule').map((r) => ({
            id: r.getAttribute('id') ?? '',
            inputEntries: children(r, 'inputEntry').map((e) => text(children(e, 'text')[0])),
            outputEntries: children(r, 'outputEntry').map((e) => text(children(e, 'text')[0])),
            annotation: text(children(r, 'description')[0]),
          }))
        : [],
    };
  });
}

/** A typed input value from what the user typed (numbers, booleans; text as is). */
export function coerce(raw: string, typeRef: string): unknown {
  const v = raw.trim();
  if (v === '') return null;
  const t = typeRef.toLowerCase();
  if (['number', 'integer', 'long', 'double'].includes(t)) {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : v;
  }
  if (t === 'boolean') return v === 'true' ? true : v === 'false' ? false : v;
  return v;
}

const matches = (entry: string, value: unknown) => {
  const e = entry.trim();
  if (e === '' || e === '-') return true;
  return unaryTest(e, { '?': value }).value === true;
};

export interface DecisionResult {
  matched: {
    ruleIndex: number;
    ruleId: string;
    outputs: Record<string, unknown>;
    annotation: string;
  }[];
  /** The decision's result after the hit policy (single, list or aggregated value). */
  result: unknown;
  error: 'NO_MATCH' | 'UNIQUE_VIOLATION' | 'ANY_CONFLICT' | 'EVALUATION' | null;
  message?: string;
}

/** Evaluates a decision table for the given input values (by input id). */
export function evaluateDecision(
  decision: DmnDecision,
  values: Record<string, string>,
): DecisionResult {
  try {
    const typed = decision.inputs.map((i) => coerce(values[i.id] ?? '', i.typeRef));
    const matched = decision.rules
      .map((r, ruleIndex) => ({ r, ruleIndex }))
      .filter(({ r }) => r.inputEntries.every((e, i) => matches(e, typed[i])))
      .map(({ r, ruleIndex }) => ({
        ruleIndex,
        ruleId: r.id,
        annotation: r.annotation,
        outputs: Object.fromEntries(
          decision.outputs.map((o, i) => {
            const expr = r.outputEntries[i]?.trim() ?? '';
            return [o.name || o.label || o.id, expr ? evaluate(expr, {}).value : null];
          }),
        ),
      }));
    const single = (m: (typeof matched)[number]) =>
      decision.outputs.length === 1 ? Object.values(m.outputs)[0] : m.outputs;
    const policy = decision.hitPolicy.toUpperCase();
    if (!matched.length) return { matched, result: null, error: 'NO_MATCH' };
    if (policy === 'UNIQUE' && matched.length > 1)
      return { matched, result: null, error: 'UNIQUE_VIOLATION' };
    if (policy === 'ANY') {
      const first = JSON.stringify(matched[0].outputs);
      if (matched.some((m) => JSON.stringify(m.outputs) !== first))
        return { matched, result: null, error: 'ANY_CONFLICT' };
      return { matched, result: single(matched[0]), error: null };
    }
    if (policy === 'UNIQUE' || policy === 'FIRST' || policy === 'PRIORITY')
      return { matched, result: single(matched[0]), error: null };
    // COLLECT, RULE ORDER, OUTPUT ORDER: all matches (COLLECT may aggregate a single output).
    const list = matched.map(single);
    if (policy === 'COLLECT' && decision.aggregation && decision.outputs.length === 1) {
      const nums = list.map(Number).filter((n) => Number.isFinite(n));
      const agg = decision.aggregation.toUpperCase();
      const result =
        agg === 'COUNT'
          ? list.length
          : agg === 'SUM'
            ? nums.reduce((a, b) => a + b, 0)
            : agg === 'MIN'
              ? Math.min(...nums)
              : Math.max(...nums);
      return { matched, result, error: null };
    }
    return { matched, result: list, error: null };
  } catch (err) {
    return { matched: [], result: null, error: 'EVALUATION', message: (err as Error).message };
  }
}

export interface DmnIssue {
  decisionId: string;
  elementId: string;
  code:
    | 'NO_TABLE_RULES'
    | 'MISSING_NAME_EN'
    | 'MISSING_NAME_AR'
    | 'INVALID_INPUT_ENTRY'
    | 'INVALID_OUTPUT_ENTRY'
    | 'EMPTY_OUTPUT'
    | 'DUPLICATE_RULE';
  detail?: string;
}

/** Checks of the Validation panel (warnings; saving is never blocked by them). */
export function validateDecisions(decisions: DmnDecision[], xml: string): DmnIssue[] {
  const issues: DmnIssue[] = [];
  const names = bilingualTexts(xml);
  for (const d of decisions) {
    const own = names.get(d.id);
    if (!own?.en) issues.push({ decisionId: d.id, elementId: d.id, code: 'MISSING_NAME_EN' });
    if (!own?.ar) issues.push({ decisionId: d.id, elementId: d.id, code: 'MISSING_NAME_AR' });
    if (!d.isTable) continue;
    if (!d.rules.length) issues.push({ decisionId: d.id, elementId: d.id, code: 'NO_TABLE_RULES' });
    const seen = new Set<string>();
    for (const r of d.rules) {
      r.inputEntries.forEach((e) => {
        if (!e || e === '-') return;
        try {
          parseUnaryTests(e, {}, undefined);
          unaryTest(e, { '?': null });
        } catch (err) {
          issues.push({
            decisionId: d.id,
            elementId: r.id,
            code: 'INVALID_INPUT_ENTRY',
            detail: `${e} — ${(err as Error).message}`,
          });
        }
      });
      r.outputEntries.forEach((e) => {
        if (!e) return issues.push({ decisionId: d.id, elementId: r.id, code: 'EMPTY_OUTPUT' });
        try {
          parseExpression(e, {}, undefined);
          evaluate(e, {});
        } catch (err) {
          issues.push({
            decisionId: d.id,
            elementId: r.id,
            code: 'INVALID_OUTPUT_ENTRY',
            detail: `${e} — ${(err as Error).message}`,
          });
        }
      });
      const key = r.inputEntries.map((e) => e.trim() || '-').join('|');
      if (seen.has(key)) issues.push({ decisionId: d.id, elementId: r.id, code: 'DUPLICATE_RULE' });
      seen.add(key);
    }
  }
  return issues;
}

// ---------- Bilingual names ----------

/** Elements whose name / label / annotation is shown to people. */
const NAMED = [
  'decision',
  'inputData',
  'knowledgeSource',
  'businessKnowledgeModel',
  'input',
  'output',
];

interface Named {
  el: Element;
  /** Attribute holding the visible text (`name` or `label`), or null for rule annotations. */
  attr: 'name' | 'label' | null;
}

function namedElements(doc: Document): Named[] {
  const out: Named[] = [];
  for (const local of NAMED)
    for (const el of Array.from(doc.getElementsByTagNameNS('*', local)))
      out.push({ el, attr: local === 'input' || local === 'output' ? 'label' : 'name' });
  for (const el of Array.from(doc.getElementsByTagNameNS('*', 'rule')))
    out.push({ el, attr: null });
  return out;
}

const phEn = (n: Named) => (n.attr ? 'nameEn' : 'annotationEn');
const phAr = (n: Named) => (n.attr ? 'nameAr' : 'annotationAr');

function visibleText(n: Named): string {
  if (n.attr) return n.el.getAttribute(n.attr) ?? '';
  return text(children(n.el, 'description')[0]);
}

function setVisibleText(doc: Document, n: Named, value: string) {
  if (n.attr) {
    n.el.setAttribute(n.attr, value);
    return;
  }
  let d = children(n.el, 'description')[0];
  if (!value) {
    d?.remove();
    return;
  }
  if (!d) {
    d = doc.createElementNS(n.el.namespaceURI ?? DMN_NS, 'description');
    n.el.insertBefore(d, n.el.firstChild);
  }
  d.textContent = value;
}

function ensurePhNamespace(doc: Document) {
  const root = doc.documentElement;
  if (!root.getAttribute('xmlns:ph'))
    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:ph', PH_NS);
}

/** English and Arabic text of every named element and rule annotation, by id. */
export function bilingualTexts(xml: string): Map<string, { en: string; ar: string; kind: string }> {
  const doc = parseDmnXml(xml);
  const map = new Map<string, { en: string; ar: string; kind: string }>();
  for (const n of namedElements(doc)) {
    const id = n.el.getAttribute('id');
    if (!id) continue;
    map.set(id, {
      en: n.el.getAttributeNS(PH_NS, phEn(n)) || visibleText(n),
      ar: n.el.getAttributeNS(PH_NS, phAr(n)) ?? '',
      kind: n.el.localName === 'rule' ? 'annotation' : n.el.localName,
    });
  }
  return map;
}

/** XML for the editor in a language: the visible names are those of `locale`. */
export function dmnForLocale(xml: string, locale: Locale): string {
  if (locale === 'en') return xml;
  const doc = parseDmnXml(xml);
  for (const n of namedElements(doc)) {
    const ar = n.el.getAttributeNS(PH_NS, phAr(n));
    if (!n.el.getAttributeNS(PH_NS, phEn(n))) {
      ensurePhNamespace(doc);
      n.el.setAttributeNS(PH_NS, `ph:${phEn(n)}`, visibleText(n));
    }
    if (ar) setVisibleText(doc, n, ar);
  }
  return new XMLSerializer().serializeToString(doc);
}

/**
 * XML from the editor back to the stored form: what was edited in `locale` goes to that language,
 * the other language comes from `other` (edited in the Translations panel), and `name` / `label`
 * / `description` hold English again.
 */
export function dmnFromLocale(xml: string, locale: Locale, other: Map<string, string>): string {
  const doc = parseDmnXml(xml);
  ensurePhNamespace(doc);
  for (const n of namedElements(doc)) {
    const id = n.el.getAttribute('id');
    if (!id) continue;
    const visible = visibleText(n);
    const en =
      locale === 'en' ? visible : (other.get(id) ?? n.el.getAttributeNS(PH_NS, phEn(n)) ?? '');
    const ar =
      locale === 'ar' ? visible : (other.get(id) ?? n.el.getAttributeNS(PH_NS, phAr(n)) ?? '');
    n.el.setAttributeNS(PH_NS, `ph:${phEn(n)}`, en);
    n.el.setAttributeNS(PH_NS, `ph:${phAr(n)}`, ar);
    setVisibleText(doc, n, en || ar);
  }
  return new XMLSerializer().serializeToString(doc);
}
