import type {
  DiagramNode,
  GrcBand,
  ProcessFactDto,
  ProcessStatus,
  ValueChainColourMode,
} from '@processhub/shared';

export interface LegendEntry {
  key: string;
  /** i18n key or literal label. */
  label: { key?: string; text?: string };
  fill: string;
  stroke: string;
}

const STATUS: Record<ProcessStatus, [string, string]> = {
  DRAFT: ['#F1F5F9', '#64748B'],
  IN_REVIEW: ['#E0EDFF', '#1D4ED8'],
  APPROVED: ['#E0F7FA', '#0E7490'],
  PUBLISHED: ['#DCFCE7', '#15803D'],
  ARCHIVED: ['#E5E7EB', '#374151'],
};
const RAG: Record<string, [string, string]> = {
  GREEN: ['#DCFCE7', '#16A34A'],
  AMBER: ['#FEF3C7', '#D97706'],
  RED: ['#FEE2E2', '#DC2626'],
};
const NONE: [string, string] = ['#FFFFFF', '#94A3B8'];
const DEPARTMENT_PALETTE: [string, string][] = [
  ['#E8F1FB', '#1F5FA8'],
  ['#FBF3E0', '#8A6D1E'],
  ['#F3E8FD', '#6B3FA0'],
  ['#E6F4EA', '#2E7D32'],
  ['#FDECEA', '#C62828'],
  ['#E0F7FA', '#0E7490'],
  ['#FFF1E6', '#C2410C'],
  ['#EEF0F2', '#59636E'],
];

/** Light fill for a band colour (the band colour itself is the border). */
const tint = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.82);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
};

/**
 * "Colour by" of a value chain: the colour of every element linked to a process, from the
 * process's status, KPI status, residual risk band or owner department, plus the legend.
 * Elements without a linked process keep their own colours.
 */
export function valueChainColours(
  nodes: Pick<DiagramNode, 'id' | 'processId'>[],
  facts: Map<string, ProcessFactDto>,
  mode: ValueChainColourMode,
  bands: GrcBand[] = [],
): { colours: Map<string, { fill: string; stroke: string }>; legend: LegendEntry[] } {
  const colours = new Map<string, { fill: string; stroke: string }>();
  const legend = new Map<string, LegendEntry>();
  if (mode === 'none') return { colours, legend: [] };
  const departments = [
    ...new Set([...facts.values()].flatMap((f) => (f.department ? [f.department.id] : []))),
  ].sort();
  for (const n of nodes) {
    if (!n.processId) continue;
    const f = facts.get(n.processId);
    let key = 'none';
    let pair = NONE;
    let label: LegendEntry['label'] = { key: 'diagrams:colourBy.noData' };
    if (f && mode === 'status') {
      key = f.status;
      pair = STATUS[f.status];
      label = { key: `processes:status.${f.status}` };
    } else if (f && mode === 'kpi' && f.kpi) {
      key = f.kpi;
      pair = RAG[f.kpi];
      label = { key: `kpi:rag.${f.kpi}` };
    } else if (f && mode === 'risk' && f.risk) {
      const band = bands.find((b) => b.key === f.risk!.band);
      key = f.risk.band ?? 'none';
      pair = band ? [tint(band.colour), band.colour] : NONE;
      label = band ? { text: `${band.nameEn}|${band.nameAr}` } : label;
    } else if (f && mode === 'department' && f.department) {
      key = f.department.id;
      pair = DEPARTMENT_PALETTE[departments.indexOf(key) % DEPARTMENT_PALETTE.length];
      label = { text: `${f.department.nameEn}|${f.department.nameAr}` };
    }
    colours.set(n.id, { fill: pair[0], stroke: pair[1] });
    if (!legend.has(key)) legend.set(key, { key, label, fill: pair[0], stroke: pair[1] });
  }
  return { colours, legend: [...legend.values()] };
}
