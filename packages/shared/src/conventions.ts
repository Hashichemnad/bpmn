import { z } from 'zod';
import { isStepNode, type BpmnGraph } from './bpmn-graph';

/**
 * Modeling conventions (Modeler design B2, D-088): house rules an Admin switches on in Settings →
 * Modeling conventions. Enabled rules show as warnings in the modeler's Validation panel; rules
 * marked mandatory must pass before a process can be submitted for review (checked on the server
 * with the same function).
 */
export const CONVENTION_RULES = [
  /** Every step has a label in English and in Arabic. */
  'bilingualLabels',
  /** Every step sits in a lane linked to a library role. */
  'laneRole',
  /** Every user task has a description (either language). */
  'userTaskDescription',
  /** At most `maxElements` flow elements (events, steps, gateways) per diagram. */
  'maxElements',
  /** No element without incoming and outgoing flows. */
  'noUnconnected',
  /** An approval step is followed directly by a decision (gateway). */
  'approvalDecision',
] as const;
export type ConventionRule = (typeof CONVENTION_RULES)[number];

export const CONVENTIONS_MAX_ELEMENTS_LIMITS = { min: 5, max: 1000, default: 50 } as const;

const ruleSettingSchema = z.object({ enabled: z.boolean(), mandatory: z.boolean() });
export type ConventionRuleSetting = z.infer<typeof ruleSettingSchema>;

export const modelingConventionsSchema = z
  .strictObject({
    rules: z.strictObject(
      Object.fromEntries(CONVENTION_RULES.map((r) => [r, ruleSettingSchema])) as Record<
        ConventionRule,
        typeof ruleSettingSchema
      >,
    ),
    maxElements: z
      .number()
      .int()
      .min(CONVENTIONS_MAX_ELEMENTS_LIMITS.min)
      .max(CONVENTIONS_MAX_ELEMENTS_LIMITS.max),
  })
  // A mandatory rule is always enabled.
  .transform((v) => ({
    ...v,
    rules: Object.fromEntries(
      CONVENTION_RULES.map((r) => [
        r,
        { enabled: v.rules[r].enabled || v.rules[r].mandatory, mandatory: v.rules[r].mandatory },
      ]),
    ) as Record<ConventionRule, ConventionRuleSetting>,
  }));
export type ModelingConventions = z.output<typeof modelingConventionsSchema>;

/** Shipped default: every rule shows as a warning, none blocks a submission. */
export const DEFAULT_CONVENTIONS: ModelingConventions = {
  rules: Object.fromEntries(
    CONVENTION_RULES.map((r) => [r, { enabled: true, mandatory: false }]),
  ) as Record<ConventionRule, ConventionRuleSetting>,
  maxElements: CONVENTIONS_MAX_ELEMENTS_LIMITS.default,
};

/** The stored setting merged over the defaults (unknown or invalid values fall back). */
export function resolveConventions(value: unknown): ModelingConventions {
  if (!value || typeof value !== 'object') return DEFAULT_CONVENTIONS;
  const v = value as Partial<ModelingConventions>;
  const merged = {
    rules: Object.fromEntries(
      CONVENTION_RULES.map((r) => [r, { ...DEFAULT_CONVENTIONS.rules[r], ...v.rules?.[r] }]),
    ),
    maxElements: v.maxElements ?? DEFAULT_CONVENTIONS.maxElements,
  };
  const parsed = modelingConventionsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_CONVENTIONS;
}

export interface ConventionIssue {
  rule: ConventionRule;
  mandatory: boolean;
  elementId?: string;
  /** `maxElements`: elements in the diagram and the limit. */
  count?: number;
  max?: number;
}

const DECISION_GATEWAY = /^bpmn:(Exclusive|Inclusive|Complex|EventBased)Gateway$/;

/** Checks a diagram (read with `parseBpmnGraph`) against the enabled conventions. */
export function checkConventions(
  graph: Pick<BpmnGraph, 'nodes' | 'flows' | 'lanes'>,
  conventions: ModelingConventions,
): ConventionIssue[] {
  const issues: ConventionIssue[] = [];
  const on = (r: ConventionRule) => conventions.rules[r].enabled;
  const add = (rule: ConventionRule, extra: Omit<ConventionIssue, 'rule' | 'mandatory'> = {}) =>
    issues.push({ rule, mandatory: conventions.rules[rule].mandatory, ...extra });
  const lanes = new Map(graph.lanes.map((l) => [l.id, l]));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  // Boundary events hang on a step: they are counted but never "unconnected".
  const flowNodes = graph.nodes;

  if (on('maxElements') && flowNodes.length > conventions.maxElements) {
    add('maxElements', { count: flowNodes.length, max: conventions.maxElements });
  }
  for (const n of flowNodes) {
    const step = isStepNode(n);
    if (step && on('bilingualLabels') && (!n.nameEn.trim() || !n.nameAr.trim())) {
      add('bilingualLabels', { elementId: n.id });
    }
    if (step && on('laneRole') && !(n.laneId && lanes.get(n.laneId)?.roleId)) {
      add('laneRole', { elementId: n.id });
    }
    if (
      n.type === 'bpmn:UserTask' &&
      on('userTaskDescription') &&
      !n.descriptionEn.trim() &&
      !n.descriptionAr.trim()
    ) {
      add('userTaskDescription', { elementId: n.id });
    }
    if (
      on('noUnconnected') &&
      flowNodes.length > 1 &&
      n.type !== 'bpmn:BoundaryEvent' &&
      n.incoming === 0 &&
      n.outgoing === 0
    ) {
      add('noUnconnected', { elementId: n.id });
    }
    if (n.stepType === 'approval' && on('approvalDecision')) {
      const next = graph.flows.filter((f) => f.from === n.id).map((f) => nodes.get(f.to));
      if (!next.some((t) => t && DECISION_GATEWAY.test(t.type))) {
        add('approvalDecision', { elementId: n.id });
      }
    }
  }
  return issues;
}

/** Mandatory rules that fail: what blocks "Submit for review". */
export const blockingIssues = (issues: ConventionIssue[]) => issues.filter((i) => i.mandatory);
