import {
  durationBand,
  type GrcBand,
  type StepGrcSummary,
  readStepAttributes,
  type DurationBand,
  type AppLifecycle,
  LIFECYCLE_SEVERITY,
  type KpiRag,
  worstRag,
  type ObjectLinkDto,
  type StepType,
} from '@processhub/shared';
import type { BpmnInstance, Canvas, DiagramElement, ElementRegistry } from './bpmn-types';
import { isActivityElement, laneOf, readLabels } from './diagram';
import { pickLabel } from './labels';
import { rowTypeOf } from './quick-model';

/**
 * "Colour by" views (Modeler design B2, D-086): a temporary colouring of the diagram by lane role,
 * IT system, step type, planned duration or missing information. View only — the stored colours
 * (BPMN-in-Color) never change: each shape gets a canvas marker class and a generated stylesheet
 * paints the marker classes over the stored colours; turning the view off removes the markers.
 */
export const COLOUR_BY_MODES = [
  'none',
  'role',
  'system',
  'type',
  'duration',
  'missing',
  // Risk & Compliance (Phase 4.1): highest residual rating, steps with risks but no control.
  'riskRating',
  'riskControl',
  // Architecture (Phase 4.3): steps using applications that are phasing out or retired.
  'appLifecycle',
  // KPIs (Phase 4.3): worst latest status of the step's KPIs.
  'kpiStatus',
  // Process mining (Phase 5.1): cases per step, measured time, deviations (from an event log).
  'miningFrequency',
  'miningDuration',
  'miningDeviations',
  // Simulation (Phase 5.1): resource utilisation and waiting time per step (last run).
  'simUtilisation',
  'simWaiting',
] as const;
export type ColourByMode = (typeof COLOUR_BY_MODES)[number];

/** Modes fed by measured / simulated values (`ColourByContext.metric`). */
export const METRIC_MODES: readonly ColourByMode[] = [
  'miningFrequency',
  'miningDuration',
  'miningDeviations',
  'simUtilisation',
  'simWaiting',
];
export type MetricBand = 'low' | 'medium' | 'high';

/** Values of a metric view: a band and a badge text per step, a weight and text per sequence flow. */
export interface MetricValues {
  elements: Map<string, { band: MetricBand; label: string }>;
  flows: Map<string, { weight: number; label: string }>;
}
export interface LegendItem {
  key: string;
  /** Text shown in the legend (already translated / localised by the caller's `label`). */
  label: string;
  fill: string;
  stroke: string;
  count: number;
}

/** Qualitative palette (light fills, darker borders) for roles and systems. */
export const CATEGORY_COLOURS: { fill: string; stroke: string }[] = [
  { fill: '#DBEAFE', stroke: '#1D4ED8' },
  { fill: '#FCE7F3', stroke: '#BE185D' },
  { fill: '#DCFCE7', stroke: '#15803D' },
  { fill: '#FEF3C7', stroke: '#B45309' },
  { fill: '#EDE9FE', stroke: '#6D28D9' },
  { fill: '#CFFAFE', stroke: '#0E7490' },
  { fill: '#FFE4E6', stroke: '#BE123C' },
  { fill: '#ECFCCB', stroke: '#4D7C0F' },
  { fill: '#FFEDD5', stroke: '#C2410C' },
  { fill: '#E0E7FF', stroke: '#4338CA' },
  { fill: '#F5F5F4', stroke: '#57534E' },
  { fill: '#FAE8FF', stroke: '#A21CAF' },
];
const NONE = { fill: '#F1F5F9', stroke: '#94A3B8' };

const FIXED: Record<string, { fill: string; stroke: string }> = {
  'type:task': { fill: '#DBEAFE', stroke: '#1D4ED8' },
  'type:approval': { fill: '#EDE9FE', stroke: '#6D28D9' },
  'type:system': { fill: '#E2E8F0', stroke: '#334155' },
  'type:notification': { fill: '#CFFAFE', stroke: '#0E7490' },
  'type:decision': { fill: '#FDE68A', stroke: '#92400E' },
  'type:end': { fill: '#FFE4E6', stroke: '#BE123C' },
  'type:other': NONE,
  'duration:none': NONE,
  'duration:short': { fill: '#DCFCE7', stroke: '#15803D' },
  'duration:medium': { fill: '#FEF3C7', stroke: '#B45309' },
  'duration:long': { fill: '#FFE4E6', stroke: '#BE123C' },
  'missing:complete': { fill: '#DCFCE7', stroke: '#15803D' },
  'missing:incomplete': { fill: '#FEE2E2', stroke: '#DC2626' },
  'riskControl:noRisk': NONE,
  'riskControl:uncovered': { fill: '#FEE2E2', stroke: '#DC2626' },
  'riskControl:covered': { fill: '#DCFCE7', stroke: '#15803D' },
  'lifecycle:ACTIVE': { fill: '#DCFCE7', stroke: '#15803D' },
  'lifecycle:PLANNED': { fill: '#DBEAFE', stroke: '#1D4ED8' },
  'lifecycle:PHASING_OUT': { fill: '#FFEDD5', stroke: '#C2410C' },
  'lifecycle:RETIRED': { fill: '#FEE2E2', stroke: '#DC2626' },
  'kpi:GREEN': { fill: '#DCFCE7', stroke: '#16A34A' },
  'kpi:AMBER': { fill: '#FEF3C7', stroke: '#D97706' },
  'kpi:RED': { fill: '#FEE2E2', stroke: '#DC2626' },
  'kpi:noValue': { fill: '#E2E8F0', stroke: '#64748B' },
  'freq:low': { fill: '#DBEAFE', stroke: '#60A5FA' },
  'freq:medium': { fill: '#93C5FD', stroke: '#2563EB' },
  'freq:high': { fill: '#3B82F6', stroke: '#1E3A8A' },
  'heat:low': { fill: '#DCFCE7', stroke: '#16A34A' },
  'heat:medium': { fill: '#FEF3C7', stroke: '#D97706' },
  'heat:high': { fill: '#FEE2E2', stroke: '#DC2626' },
  'metric:none': { fill: '#F1F5F9', stroke: '#CBD5E1' },
};

/** What a step lacks in the "missing information" view. */
export type MissingInfo = 'role' | 'description';

export interface ColourByContext {
  links: Pick<ObjectLinkDto, 'bpmnElementId' | 'relation' | 'repoObject'>[];
  locale: 'en' | 'ar';
  /** Translates the fixed category keys (`type:task`, `missing:incomplete`, …) and "none". */
  label: (key: string) => string;
  /** Risks and controls per step with the rating bands (risk views). */
  grc?: { steps: Map<string, StepGrcSummary>; bands: GrcBand[] };
  /** Lifecycle of each application (library SYSTEM object id → lifecycle), Phase 4.3. */
  lifecycles?: Map<string, AppLifecycle>;
  /** Latest status of the KPIs of each step (element id → statuses), Phase 4.3. */
  kpis?: Map<string, (KpiRag | null)[]>;
  /** Measured (mining) or simulated values of the metric modes (Phase 5.1). */
  metric?: MetricValues;
}

export interface ColourByResult {
  legend: LegendItem[];
  /** Missing-information view: what each incomplete step lacks. */
  missing: Map<string, MissingInfo[]>;
  /** Marker class of each coloured element. */
  classes: Map<string, string>;
}

const MARKER_PREFIX = 'ph-cb-';
const STYLE_ID = 'ph-colour-by-style';

/** Category of one element in a mode; null = not part of this view (dimmed). */
function categoryOf(
  el: DiagramElement,
  mode: Exclude<ColourByMode, 'none'>,
  ctx: ColourByContext,
  registry: ElementRegistry,
  missing: Map<string, MissingInfo[]>,
): { key: string; label: string; colour?: { fill: string; stroke: string } } | null {
  const isStep = isActivityElement(el);
  const linksOf = (rel: string) =>
    ctx.links.filter((l) => l.bpmnElementId === el.id && l.relation === rel);
  const name = (o: { nameEn: string; nameAr: string }) =>
    pickLabel({ nameEn: o.nameEn, nameAr: o.nameAr }, ctx.locale);
  if (METRIC_MODES.includes(mode)) {
    if (!isStep) return null;
    const v = ctx.metric?.elements.get(el.id);
    if (!v) return { key: 'metric:none', label: ctx.label('metric:none') };
    const key = `${mode === 'miningFrequency' ? 'freq' : 'heat'}:${v.band}`;
    return { key, label: ctx.label(`${mode}:${v.band}`) };
  }
  switch (mode) {
    case 'type': {
      const t: StepType = rowTypeOf(el);
      return { key: `type:${t}`, label: ctx.label(`type:${t}`) };
    }
    case 'role': {
      if (!isStep) return null;
      const lane = laneOf(registry, el);
      if (lane) {
        const l = readLabels(lane.businessObject);
        const text = pickLabel(l, ctx.locale);
        const roleId = lane.businessObject.get('ph:roleId') as string | undefined;
        if (text || roleId) return { key: `role:${roleId || text}`, label: text };
      }
      const role = linksOf('PERFORMS').find((l) => l.repoObject.type === 'ROLE');
      if (role) return { key: `role:${role.repoObject.id}`, label: name(role.repoObject) };
      return { key: 'none', label: ctx.label('none') };
    }
    case 'system': {
      if (!isStep) return null;
      const sys = linksOf('SUPPORTS').find((l) => l.repoObject.type === 'SYSTEM');
      return sys
        ? { key: `system:${sys.repoObject.id}`, label: name(sys.repoObject) }
        : { key: 'none', label: ctx.label('none') };
    }
    case 'appLifecycle': {
      if (!isStep) return null;
      // The application that needs the most attention decides (retired > phasing out > planned).
      let worst: AppLifecycle | null = null;
      for (const l of linksOf('SUPPORTS')) {
        if (l.repoObject.type !== 'SYSTEM') continue;
        const v = ctx.lifecycles?.get(l.repoObject.id) ?? 'ACTIVE';
        if (!worst || LIFECYCLE_SEVERITY[v] > LIFECYCLE_SEVERITY[worst]) worst = v;
      }
      return worst
        ? { key: `lifecycle:${worst}`, label: ctx.label(`lifecycle:${worst}`) }
        : { key: 'none', label: ctx.label('none') };
    }
    case 'kpiStatus': {
      if (!isStep) return null;
      const list = ctx.kpis?.get(el.id);
      if (!list?.length) return { key: 'none', label: ctx.label('none') };
      const worst = worstRag(list);
      const key = worst ? `kpi:${worst}` : 'kpi:noValue';
      return { key, label: ctx.label(key) };
    }
    case 'duration': {
      if (!isStep) return null;
      const minutes = readStepAttributes({
        durationMinutes: el.businessObject.get('ph:durationMinutes') as string | undefined,
      }).values.durationMinutes;
      const band: DurationBand = durationBand(minutes);
      return { key: `duration:${band}`, label: ctx.label(`duration:${band}`) };
    }
    case 'riskRating': {
      if (!isStep) return null;
      const sum = ctx.grc?.steps.get(el.id);
      const band = ctx.grc?.bands.find((b) => b.key === sum?.maxResidualBand);
      if (!band) return { key: 'riskControl:noRisk', label: ctx.label('riskControl:noRisk') };
      return {
        key: `band:${band.key}`,
        label: ctx.locale === 'ar' ? band.nameAr : band.nameEn,
        colour: { fill: `${band.colour}59`, stroke: band.colour },
      };
    }
    case 'riskControl': {
      if (!isStep) return null;
      const sum = ctx.grc?.steps.get(el.id);
      const key = !sum?.risks
        ? 'riskControl:noRisk'
        : sum.uncovered
          ? 'riskControl:uncovered'
          : 'riskControl:covered';
      return { key, label: ctx.label(key) };
    }
    case 'missing': {
      if (!isStep) return null;
      const lacks: MissingInfo[] = [];
      const hasRole =
        !!laneOf(registry, el) || linksOf('PERFORMS').some((l) => l.repoObject.type === 'ROLE');
      if (!hasRole) lacks.push('role');
      const bo = el.businessObject;
      if (
        !(bo.get('ph:descriptionEn') as string)?.trim() &&
        !(bo.get('ph:descriptionAr') as string)?.trim()
      )
        lacks.push('description');
      if (lacks.length) missing.set(el.id, lacks);
      const key = lacks.length ? 'missing:incomplete' : 'missing:complete';
      return { key, label: ctx.label(key) };
    }
    default:
      return null;
  }
}

/** Works out the colour of every element (no DOM changes). */
export function planColourBy(
  registry: ElementRegistry,
  mode: Exclude<ColourByMode, 'none'>,
  ctx: ColourByContext,
): ColourByResult & { colours: Map<string, { fill: string; stroke: string }> } {
  const missing = new Map<string, MissingInfo[]>();
  const classes = new Map<string, string>();
  const colours = new Map<string, { fill: string; stroke: string }>();
  const legend = new Map<string, LegendItem>();
  const elements = registry.filter(
    (e) =>
      e.type !== 'label' &&
      e.type !== 'bpmn:Lane' &&
      e.type !== 'bpmn:Participant' &&
      e.type !== 'bpmn:Process' &&
      e.type !== 'bpmn:Collaboration' &&
      !('waypoints' in e),
  );
  let next = 0;
  for (const el of elements) {
    const cat = categoryOf(el, mode, ctx, registry, missing);
    if (!cat) {
      classes.set(el.id, `${MARKER_PREFIX}dim`);
      continue;
    }
    let item = legend.get(cat.key);
    if (!item) {
      const c =
        cat.colour ??
        FIXED[cat.key] ??
        (cat.key === 'none' ? NONE : CATEGORY_COLOURS[next++ % CATEGORY_COLOURS.length]);
      item = { key: cat.key, label: cat.label, ...c, count: 0 };
      legend.set(cat.key, item);
    }
    item.count++;
    const index = [...legend.keys()].indexOf(cat.key);
    classes.set(el.id, `${MARKER_PREFIX}c${index}`);
    colours.set(el.id, { fill: item.fill, stroke: item.stroke });
  }
  const items = [...legend.values()];
  // "None" / "complete" last, then by count.
  items.sort(
    (a, b) =>
      Number(a.key === 'none' || a.key === 'metric:none') -
        Number(b.key === 'none' || b.key === 'metric:none') ||
      ([
        'type',
        'duration',
        'missing',
        'riskRating',
        'riskControl',
        'appLifecycle',
        'kpiStatus',
        ...METRIC_MODES,
      ].includes(mode)
        ? 0
        : b.count - a.count),
  );
  return { legend: items, missing, classes, colours };
}

/** Markers set by the last `applyColourBy` of each diagram. */
const applied = new WeakMap<BpmnInstance, Map<string, string>>();

/** Removes every colour-by marker and the generated stylesheet. */
export function clearColourBy(instance: BpmnInstance) {
  const canvas = instance.get<Canvas>('canvas');
  const registry = instance.get<ElementRegistry>('elementRegistry');
  for (const [id, cls] of applied.get(instance) ?? []) {
    if (registry.get(id)) canvas.removeMarker(id, cls);
  }
  applied.delete(instance);
  document.getElementById(STYLE_ID)?.remove();
}

/**
 * Applies a view: marker classes on the shapes and one stylesheet with a rule per legend entry.
 * Returns the legend (and the missing information per step).
 */
export function applyColourBy(
  instance: BpmnInstance,
  mode: ColourByMode,
  ctx: ColourByContext,
): ColourByResult {
  clearColourBy(instance);
  if (mode === 'none') return { legend: [], missing: new Map(), classes: new Map() };
  const registry = instance.get<ElementRegistry>('elementRegistry');
  const canvas = instance.get<Canvas>('canvas');
  const plan = planColourBy(registry, mode, ctx);
  for (const [id, cls] of plan.classes) canvas.addMarker(id, cls);
  applied.set(instance, plan.classes);
  const rules = [...new Set(plan.classes.values())]
    .filter((c) => c !== `${MARKER_PREFIX}dim`)
    .map((cls) => {
      const id = [...plan.classes].find(([, c]) => c === cls)![0];
      const { fill, stroke } = plan.colours.get(id)!;
      return `.djs-element.${cls} .djs-visual > .ph-body { fill: ${fill} !important; stroke: ${stroke} !important; }`;
    });
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    ...rules,
    `.djs-element.${MARKER_PREFIX}dim .djs-visual { opacity: 0.35; }`,
  ].join('\n');
  document.head.append(style);
  return plan;
}

const METRIC_STYLE_ID = 'ph-colour-by-metric-style';
const metricOverlays = new WeakMap<BpmnInstance, { flows: string[] }>();

interface OverlaysService {
  add(
    element: string,
    type: string,
    overlay: { position: Record<string, number>; html: HTMLElement },
  ): string;
  remove(filter: { type: string }): void;
}

/** Badges on steps and flows plus flow widths of a metric view (removed by `clearMetricOverlays`). */
export function applyMetricOverlays(instance: BpmnInstance, metric: MetricValues | undefined) {
  clearMetricOverlays(instance);
  if (!metric) return;
  const canvas = instance.get<Canvas>('canvas');
  const registry = instance.get<ElementRegistry>('elementRegistry');
  const overlays = instance.get<OverlaysService>('overlays');
  const badge = (text: string, cls: string) => {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    return div;
  };
  for (const [id, v] of metric.elements) {
    const el = registry.get(id);
    if (!el || !v.label) continue;
    overlays.add(id, 'ph-metric', {
      position: { bottom: 2, left: 2 },
      html: badge(v.label, 'ph-metric-badge'),
    });
  }
  const flows: string[] = [];
  const rules: string[] = [];
  for (const [id, v] of metric.flows) {
    const el = registry.get(id) as
      (DiagramElement & { waypoints?: { x: number; y: number }[] }) | undefined;
    if (!el?.waypoints?.length) continue;
    const cls = `ph-mf-${flows.length}`;
    canvas.addMarker(id, cls);
    flows.push(id);
    const w = 1.5 + 2 * Math.max(0, Math.min(1, v.weight));
    rules.push(
      `.djs-element.${cls} .djs-visual > path { stroke: #7C3AED !important; stroke-width: ${w.toFixed(1)}px !important; }`,
    );
    if (v.label) {
      const mid = el.waypoints[Math.floor((el.waypoints.length - 1) / 2)];
      const next = el.waypoints[Math.floor((el.waypoints.length - 1) / 2) + 1] ?? mid;
      overlays.add(id, 'ph-metric', {
        position: {
          left: (mid.x + next.x) / 2 - Math.min(...el.waypoints.map((p) => p.x)),
          top: (mid.y + next.y) / 2 - Math.min(...el.waypoints.map((p) => p.y)) - 10,
        },
        html: badge(v.label, 'ph-metric-flow'),
      });
    }
  }
  metricOverlays.set(instance, { flows });
  const style = document.createElement('style');
  style.id = METRIC_STYLE_ID;
  style.textContent = rules.join('\n');
  document.head.append(style);
}

export function clearMetricOverlays(instance: BpmnInstance) {
  const prev = metricOverlays.get(instance);
  if (prev) {
    const canvas = instance.get<Canvas>('canvas');
    const registry = instance.get<ElementRegistry>('elementRegistry');
    prev.flows.forEach((id, i) => registry.get(id) && canvas.removeMarker(id, `ph-mf-${i}`));
    metricOverlays.delete(instance);
  }
  try {
    instance.get<OverlaysService>('overlays').remove({ type: 'ph-metric' });
  } catch {
    /* viewer without overlays */
  }
  document.getElementById(METRIC_STYLE_ID)?.remove();
}

/** Bands by thirds of the maximum (0 = no data). */
export function bandOf(value: number, max: number): MetricBand {
  const r = max > 0 ? value / max : 0;
  return r > 2 / 3 ? 'high' : r > 1 / 3 ? 'medium' : 'low';
}
