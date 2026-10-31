import type { ProcessCategory, ProcessStatus } from './constants';
import type { DiagramNode, GraphContent } from './diagrams';
import type { KpiRag } from './kpi';
import type { DepartmentRef } from './types';

/**
 * Value chain (process landscape) helpers: generation from the process house and the facts of
 * linked processes used by badges and "Colour by" (D-121).
 */

export interface ValueChainSource {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: ProcessCategory;
  parentId: string | null;
  level: number;
  sortOrder: number;
}

/** Frame titles of a generated value chain (stored in both languages). */
export const VALUE_CHAIN_FRAMES: Record<ProcessCategory, { nameEn: string; nameAr: string }> = {
  MANAGEMENT: { nameEn: 'Management processes', nameAr: 'العمليات الإدارية' },
  CORE: { nameEn: 'Core processes', nameAr: 'العمليات الرئيسية' },
  SUPPORT: { nameEn: 'Support processes', nameAr: 'العمليات المساندة' },
};

const FRAME_PAD = 24;
const FRAME_TITLE = 34;
const L1 = { chevron: { w: 190, h: 72 }, block: { w: 190, h: 56 } };
const L2 = { w: 170, h: 40, gap: 8 };
const GAP = 16;
const ROW_GAP = 28;

/**
 * A first value chain from the process house: one frame per category (Management above, Core in
 * the middle, Support below), level-1 processes as chevrons (Core) or blocks (Management /
 * Support), optionally their level-2 sub-processes stacked below. Every element is linked to its
 * process, so it drills down to it; ids are derived from the process ids.
 */
export function generateValueChain(
  processes: ValueChainSource[],
  options: { includeLevel2?: boolean } = {},
): GraphContent {
  const nodes: DiagramNode[] = [];
  const order = (a: ValueChainSource, b: ValueChainSource) =>
    a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, undefined, { numeric: true });
  const childrenOf = (id: string) => processes.filter((p) => p.parentId === id).sort(order);
  const rows = (['MANAGEMENT', 'CORE', 'SUPPORT'] as const).map((category) => ({
    category,
    items: processes.filter((p) => p.level === 1 && p.category === category).sort(order),
  }));
  const stepOf = (category: ProcessCategory) =>
    category === 'CORE' ? L1.chevron.w - 14 : L1.block.w + GAP;
  const width = Math.max(
    560,
    ...rows.map(
      (r) => (r.items.length ? stepOf(r.category) * r.items.length + 14 : 0) + FRAME_PAD * 2,
    ),
  );
  let y = 0;
  for (const { category, items } of rows) {
    if (!items.length) continue;
    const shape = category === 'CORE' ? L1.chevron : L1.block;
    const maxChildren = options.includeLevel2
      ? Math.max(0, ...items.map((p) => childrenOf(p.id).length))
      : 0;
    const height =
      FRAME_TITLE + shape.h + (maxChildren ? GAP + maxChildren * (L2.h + L2.gap) : 0) + FRAME_PAD;
    const frameId = `Frame_${category}`;
    nodes.push({
      id: frameId,
      kind: 'frame',
      x: 0,
      y,
      width,
      height,
      ...VALUE_CHAIN_FRAMES[category],
    });
    items.forEach((p, i) => {
      const x = FRAME_PAD + i * stepOf(category);
      const top = y + FRAME_TITLE;
      nodes.push({
        id: `P_${p.id}`,
        kind: category === 'CORE' ? 'chevron' : 'block',
        x,
        y: top,
        width: shape.w,
        height: shape.h,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        processId: p.id,
        parentId: frameId,
        ...(category !== 'CORE' ? { category } : {}),
      });
      if (!options.includeLevel2) return;
      childrenOf(p.id).forEach((c, j) => {
        nodes.push({
          id: `P_${c.id}`,
          kind: 'block',
          x: x + (shape.w - L2.w) / 2 + (category === 'CORE' ? 8 : 0),
          y: top + shape.h + GAP + j * (L2.h + L2.gap),
          width: L2.w,
          height: L2.h,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          processId: c.id,
          parentId: frameId,
          category: category === 'MANAGEMENT' ? 'MANAGEMENT' : 'SUPPORT',
        });
      });
    });
    y += height + ROW_GAP;
  }
  return { schema: 1, type: 'VALUE_CHAIN', nodes, edges: [] };
}

/** What a value chain shows about a linked process (badges, Colour by). */
export interface ProcessFactDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: ProcessStatus;
  department: DepartmentRef | null;
  /** Worst current KPI status of the process and its steps (null: no KPI, or no kpi.read). */
  kpi: KpiRag | null;
  kpiCount: number;
  /** Highest residual risk on its steps (null: none, or no grc.read). */
  risk: { score: number; band: string | null } | null;
}

export const VALUE_CHAIN_COLOUR_MODES = ['none', 'status', 'kpi', 'risk', 'department'] as const;
export type ValueChainColourMode = (typeof VALUE_CHAIN_COLOUR_MODES)[number];
