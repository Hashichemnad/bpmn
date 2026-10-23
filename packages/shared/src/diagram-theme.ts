import { z } from 'zod';

/**
 * Colour theme of BPMN diagrams (Modeler design, Part A — DECISIONS D-067).
 *
 * Colours are stored in the diagram as standard BPMN-in-Color attributes on the
 * BPMNShape (`color:background-color` / `color:border-color`) plus the older bpmn.io
 * attributes (`bioc:fill` / `bioc:stroke`), so diagrams keep their colours in other tools.
 * The theme only decides which colour a new or recoloured element gets; it is never applied
 * over colours an element already has.
 */

export const BPMN_COLOR_NS = 'http://www.omg.org/spec/BPMN/non-normative/color/1.0';
export const BPMN_BIOC_NS = 'http://bpmn.io/schema/bpmn/biocolor/1.0';

/** Value of `ph:stepKind` for a user task marked as an approval step in the element panel. */
export const STEP_KIND_APPROVAL = 'approval';
/** Value of `ph:stepKind` for a user task explicitly marked as a normal step. */
export const STEP_KIND_TASK = 'task';
export const STEP_KINDS = [STEP_KIND_APPROVAL, STEP_KIND_TASK] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Element kinds with their own colour, in the order shown in Settings → Branding. */
export const THEME_KINDS = [
  'start',
  'end',
  'endRejected',
  'humanTask',
  'approvalTask',
  'systemTask',
  'gateway',
  'intermediateEvent',
  'lane',
] as const;
export type ThemeKind = (typeof THEME_KINDS)[number];

export interface ThemeColour {
  fill: string;
  stroke: string;
}

export type DiagramTheme = Record<Exclude<ThemeKind, 'lane'>, ThemeColour> & {
  /** Lanes alternate between `fill` and `fillAlt`. */
  lane: ThemeColour & { fillAlt: string };
};

/** The reference scheme of `docs/samples/README.md`. */
export const DEFAULT_DIAGRAM_THEME: DiagramTheme = {
  start: { fill: '#E6F4EA', stroke: '#2E7D32' },
  end: { fill: '#E6F4EA', stroke: '#2E7D32' },
  endRejected: { fill: '#FDECEA', stroke: '#C62828' },
  humanTask: { fill: '#E8F1FB', stroke: '#1F5FA8' },
  approvalTask: { fill: '#FBF3E0', stroke: '#8A6D1E' },
  systemTask: { fill: '#EEF0F2', stroke: '#59636E' },
  gateway: { fill: '#FFF8E1', stroke: '#B28704' },
  intermediateEvent: { fill: '#E8F1FB', stroke: '#1F5FA8' },
  lane: { fill: '#FFFFFF', fillAlt: '#FAFBFC', stroke: '#59636E' },
};

/** Neutral colours offered by the colour picker next to the theme colours. */
export const NEUTRAL_COLOURS: ThemeColour[] = [
  { fill: '#FFFFFF', stroke: '#2B3440' },
  { fill: '#F1F5F9', stroke: '#475569' },
  { fill: '#E2E8F0', stroke: '#1E293B' },
  { fill: '#F3E8FD', stroke: '#6B3FA0' },
];

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'INVALID_COLOUR')
  .transform((v) => v.toUpperCase());
const colourSchema = z.object({ fill: hex, stroke: hex });

export const diagramThemeSchema = z.object({
  start: colourSchema,
  end: colourSchema,
  endRejected: colourSchema,
  humanTask: colourSchema,
  approvalTask: colourSchema,
  systemTask: colourSchema,
  gateway: colourSchema,
  intermediateEvent: colourSchema,
  lane: colourSchema.extend({ fillAlt: hex }),
});
export type DiagramThemeInput = z.infer<typeof diagramThemeSchema>;

export const applyThemeSchema = z.object({ dryRun: z.boolean() });
export type ApplyThemeInput = z.infer<typeof applyThemeSchema>;

export interface ApplyThemeResultDto {
  dryRun: boolean;
  /** Working models that have at least one element without colours. */
  models: number;
  /** Elements that get (or would get) theme colours. */
  elements: number;
  /** Of `models`: approved / published processes that get a new draft working copy. */
  published: number;
  /** Processes skipped because they are in review or archived (locked for edits). */
  skipped: number;
}

/** Stored setting → full theme (missing or invalid values fall back to the default). */
export function resolveDiagramTheme(value: unknown): DiagramTheme {
  const res = diagramThemeSchema.safeParse(value);
  return res.success ? res.data : DEFAULT_DIAGRAM_THEME;
}

/**
 * An English label that names an approval step: it starts with one of the decision verbs.
 * Only the first word counts, so "Submit for approval" or "Prepare review pack" are not
 * approval steps.
 */
const APPROVAL_LABEL = /^\s*(review|approve|endorse|confirm)(\s|$|[:,(-])/i;
export function isApprovalLabel(nameEn: string | null | undefined): boolean {
  return !!nameEn && APPROVAL_LABEL.test(nameEn);
}

/** End events named like an unsuccessful outcome are coloured as "rejected / terminate". */
const REJECTED_LABEL = /\b(reject(ed|ion)?|declined?|cancell?ed|refused|denied)\b/i;
const REJECTED_DEFINITIONS = new Set(['terminate', 'error', 'cancel', 'escalation']);

const HUMAN_TASKS = new Set(['Task', 'UserTask', 'ManualTask', 'CallActivity', 'SubProcess']);
const SYSTEM_TASKS = new Set([
  'ServiceTask',
  'SendTask',
  'ReceiveTask',
  'ScriptTask',
  'BusinessRuleTask',
]);

export interface ThemeElementInfo {
  /** BPMN type with or without prefix, e.g. "bpmn:UserTask" or "userTask". */
  type: string;
  /** English label (`ph:nameEn`, or the plain name of a diagram from another tool). */
  nameEn?: string | null;
  /** `ph:stepKind` of the element. */
  stepKind?: string | null;
  /** Event definition types, e.g. ["terminate"] (from `bpmn:TerminateEventDefinition`). */
  eventDefinitions?: string[];
}

const bare = (type: string) => {
  const t = type.replace(/^bpmn:/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The theme kind of a BPMN element, or null for elements the theme does not colour. */
export function themeKindOf(el: ThemeElementInfo): ThemeKind | null {
  const type = bare(el.type);
  if (type === 'StartEvent') return 'start';
  if (type === 'EndEvent') {
    const defs = (el.eventDefinitions ?? []).map((d) =>
      d
        .replace(/^bpmn:/, '')
        .replace(/EventDefinition$/, '')
        .toLowerCase(),
    );
    return defs.some((d) => REJECTED_DEFINITIONS.has(d)) || REJECTED_LABEL.test(el.nameEn ?? '')
      ? 'endRejected'
      : 'end';
  }
  if (
    type === 'IntermediateCatchEvent' ||
    type === 'IntermediateThrowEvent' ||
    type === 'BoundaryEvent'
  )
    return 'intermediateEvent';
  if (type.endsWith('Gateway')) return 'gateway';
  if (SYSTEM_TASKS.has(type)) return 'systemTask';
  if (type === 'UserTask') {
    if (el.stepKind === STEP_KIND_APPROVAL) return 'approvalTask';
    if (el.stepKind === STEP_KIND_TASK) return 'humanTask';
    return isApprovalLabel(el.nameEn) ? 'approvalTask' : 'humanTask';
  }
  if (HUMAN_TASKS.has(type)) return 'humanTask';
  if (type === 'Lane') return 'lane';
  return null;
}

/** Fill and stroke of a kind; lanes alternate by their position (0-based) in the lane set. */
export function themeColour(theme: DiagramTheme, kind: ThemeKind, laneIndex = 0): ThemeColour {
  if (kind === 'lane')
    return {
      fill: laneIndex % 2 ? theme.lane.fillAlt : theme.lane.fill,
      stroke: theme.lane.stroke,
    };
  return theme[kind];
}

/** Every colour pair a theme can assign (used to tell theme colours from user choices). */
export function themePairs(theme: DiagramTheme): ThemeColour[] {
  return THEME_KINDS.flatMap((k) =>
    k === 'lane' ? [themeColour(theme, k, 0), themeColour(theme, k, 1)] : [theme[k]],
  );
}

const same = (a: string | null | undefined, b: string) =>
  !!a && a.toUpperCase() === b.toUpperCase();

/**
 * True when fill and stroke are a pair assigned by the current or the default theme, i.e. the
 * element was coloured automatically and may be recoloured when its type changes.
 * Anything else (including no colour at all) is not a theme colour.
 */
export function isThemeColour(
  theme: DiagramTheme,
  fill: string | null | undefined,
  stroke: string | null | undefined,
): boolean {
  return [...themePairs(theme), ...themePairs(DEFAULT_DIAGRAM_THEME)].some(
    (p) => same(fill, p.fill) && same(stroke, p.stroke),
  );
}
