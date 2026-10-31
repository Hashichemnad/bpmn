import {
  evaluateFeel,
  evaluateUnaryTests,
  feelSyntaxError,
  parseFeel,
  parseUnaryTests,
} from './feel';
import { childEl, childEls, findAll, parseXmlTree } from './xml-tree';

/**
 * DMN decision tables on the server (D-145): read decisions from DMN 1.3 XML and evaluate one with
 * S-FEEL. Same hit-policy semantics as the browser test panel (`dmn-model.ts`), so a table tested in
 * the DMN editor behaves the same in a running workflow.
 */

export interface DmnTableInput {
  id: string;
  label: string;
  /** FEEL expression over the case variables (usually a variable name). */
  expression: string;
  typeRef: string;
}
export interface DmnTableOutput {
  id: string;
  label: string;
  name: string;
  typeRef: string;
  /** Allowed output values in priority order (PRIORITY / OUTPUT ORDER). */
  values: string[];
}
export interface DmnTable {
  id: string;
  name: string;
  hitPolicy: string;
  aggregation: string | null;
  inputs: DmnTableInput[];
  outputs: DmnTableOutput[];
  rules: { id: string; inputEntries: string[]; outputEntries: string[] }[];
}

export function readDecisionTables(xml: string): DmnTable[] {
  const root = parseXmlTree(xml);
  return findAll(root, 'decision').flatMap((d) => {
    const table = childEl(d, 'decisionTable');
    if (!table) return [];
    const txt = (el: ReturnType<typeof childEl>) =>
      el ? (childEl(el, 'text')?.text ?? '').trim() : '';
    return [
      {
        id: d.attrs.id ?? '',
        name: d.attrs.name ?? '',
        hitPolicy: (table.attrs.hitPolicy ?? 'UNIQUE').toUpperCase(),
        aggregation: table.attrs.aggregation ?? null,
        inputs: childEls(table, 'input').map((i) => {
          const ie = childEl(i, 'inputExpression');
          return {
            id: i.attrs.id ?? '',
            label: i.attrs.label ?? '',
            expression: txt(ie),
            typeRef: ie?.attrs.typeRef ?? 'string',
          };
        }),
        outputs: childEls(table, 'output').map((o) => {
          const vals = txt(childEl(o, 'outputValues'));
          return {
            id: o.attrs.id ?? '',
            label: o.attrs.label ?? '',
            name: o.attrs.name ?? '',
            typeRef: o.attrs.typeRef ?? 'string',
            values: vals
              ? (() => {
                  try {
                    const v = evaluateFeel(`[${vals}]`);
                    return Array.isArray(v) ? v.map(String) : [];
                  } catch {
                    return [];
                  }
                })()
              : [],
          };
        }),
        rules: childEls(table, 'rule').map((r) => ({
          id: r.attrs.id ?? '',
          inputEntries: childEls(r, 'inputEntry').map((e) => txt(e)),
          outputEntries: childEls(r, 'outputEntry').map((e) => txt(e)),
        })),
      },
    ];
  });
}

export type DmnErrorCode = 'NO_MATCH' | 'UNIQUE_VIOLATION' | 'ANY_CONFLICT' | 'EVALUATION';

export class DmnError extends Error {
  constructor(
    public readonly code: DmnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DmnError';
  }
}

export interface DmnEvaluation {
  /** Output columns of each matched rule (by output name). */
  matched: { ruleId: string; outputs: Record<string, unknown> }[];
  /**
   * Variables to merge into the case: single-hit policies — each output name → value; multi-hit —
   * each output name → list of values (COLLECT with an aggregation → the aggregate).
   */
  outputs: Record<string, unknown>;
}

const outName = (o: DmnTableOutput) => o.name || o.label || o.id;

/** Evaluates a decision table; throws `DmnError` for no match (when required) / conflicts. */
export function evaluateDmnTable(
  table: DmnTable,
  vars: Record<string, unknown>,
  opts: { requireMatch?: boolean } = {},
): DmnEvaluation {
  try {
    const values = table.inputs.map((i) => evaluateFeel(i.expression || 'null', vars));
    let matched = table.rules
      .filter((r) => r.inputEntries.every((e, i) => evaluateUnaryTests(e, values[i], vars)))
      .map((r) => ({
        ruleId: r.id,
        outputs: Object.fromEntries(
          table.outputs.map((o, i) => {
            const e = r.outputEntries[i]?.trim() ?? '';
            return [outName(o), e ? evaluateFeel(e, vars) : null];
          }),
        ) as Record<string, unknown>,
      }));
    const policy = table.hitPolicy;
    if (!matched.length) {
      if (opts.requireMatch) throw new DmnError('NO_MATCH', `No rule of ${table.id} matched`);
      return { matched, outputs: Object.fromEntries(table.outputs.map((o) => [outName(o), null])) };
    }
    if (policy === 'UNIQUE' && matched.length > 1)
      throw new DmnError('UNIQUE_VIOLATION', `Several rules of ${table.id} matched`);
    if (policy === 'ANY') {
      const first = JSON.stringify(matched[0].outputs);
      if (matched.some((m) => JSON.stringify(m.outputs) !== first))
        throw new DmnError('ANY_CONFLICT', `Matched rules of ${table.id} disagree`);
    }
    const priority = (m: (typeof matched)[number]) =>
      table.outputs.map((o) => {
        const idx = o.values.indexOf(String(m.outputs[outName(o)]));
        return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
      });
    const byPriority = (a: (typeof matched)[number], b: (typeof matched)[number]) => {
      const pa = priority(a);
      const pb = priority(b);
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    };
    if (policy === 'PRIORITY' || policy === 'OUTPUT ORDER') matched = [...matched].sort(byPriority);
    if (['UNIQUE', 'FIRST', 'PRIORITY', 'ANY'].includes(policy))
      return { matched, outputs: { ...matched[0].outputs } };
    // Multi-hit: COLLECT, RULE ORDER, OUTPUT ORDER.
    const outputs: Record<string, unknown> = {};
    for (const o of table.outputs) {
      const list = matched.map((m) => m.outputs[outName(o)]);
      const agg = policy === 'COLLECT' ? table.aggregation?.toUpperCase() : null;
      if (!agg) outputs[outName(o)] = list;
      else {
        const nums = list.map(Number).filter((n) => Number.isFinite(n));
        outputs[outName(o)] =
          agg === 'COUNT'
            ? list.length
            : agg === 'SUM'
              ? nums.reduce((a, b) => a + b, 0)
              : agg === 'MIN'
                ? nums.length
                  ? Math.min(...nums)
                  : null
                : nums.length
                  ? Math.max(...nums)
                  : null;
      }
    }
    return { matched, outputs };
  } catch (e) {
    if (e instanceof DmnError) throw e;
    throw new DmnError('EVALUATION', e instanceof Error ? e.message : String(e));
  }
}

export interface DmnCheckIssue {
  ruleId: string;
  entry: string;
  message: string;
}

/** Every input entry, output entry and input expression must parse in S-FEEL (deployment check). */
export function checkDmnTable(table: DmnTable): DmnCheckIssue[] {
  const issues: DmnCheckIssue[] = [];
  for (const i of table.inputs) {
    const err = i.expression ? feelSyntaxError(i.expression) : 'Missing input expression';
    if (err) issues.push({ ruleId: i.id, entry: i.expression, message: err });
  }
  for (const r of table.rules) {
    for (const e of r.inputEntries) {
      try {
        parseUnaryTests(e);
      } catch (err) {
        issues.push({ ruleId: r.id, entry: e, message: (err as Error).message });
      }
    }
    for (const e of r.outputEntries) {
      if (!e.trim()) continue;
      try {
        parseFeel(e);
      } catch (err) {
        issues.push({ ruleId: r.id, entry: e, message: (err as Error).message });
      }
    }
  }
  return issues;
}
