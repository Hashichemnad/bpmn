import {
  DEFAULT_VISIO_MAPPING,
  VISIO_SHAPE_TYPES,
  labelByScript,
  type ImportIssue,
  type VisioShapeType,
} from '@processhub/shared';
import type { ProcessStructure, StructureNode } from '../../ai/bpmn/process-structure';
import { checkOfficePackage, parseSafeXml, type SafeZip } from '../safe-upload';
import { issue } from './tabular';

/** One Visio shape as read from a page (inches, Visio's y axis points up). */
interface VShape {
  id: string;
  master: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  oneD: boolean;
  /** Top-level shape id this (sub-)shape belongs to. */
  top: string;
}

export interface VisioPage {
  name: string;
  structure: ProcessStructure;
  /** Master name (lower case) → number of shapes on the page. */
  masters: Map<string, number>;
  unmapped: Map<string, number>;
  issues: ImportIssue[];
  shapes: number;
}

const el = (doc: Document | Element, name: string) =>
  Array.from(doc.getElementsByTagNameNS('*', name));
const cell = (shape: Element, name: string) => {
  const c = Array.from(shape.children).find(
    (x) => x.localName === 'Cell' && x.getAttribute('N') === name,
  );
  const v = Number(c?.getAttribute('V'));
  return Number.isFinite(v) ? v : null;
};
/** "Dynamic connector.12" → "dynamic connector". */
const masterKey = (s: string) =>
  s
    .replace(/\.\d+$/, '')
    .trim()
    .toLowerCase();

const relTargets = async (zip: SafeZip, relsPath: string) => {
  const map = new Map<string, string>();
  if (!zip.has(relsPath)) return map;
  const doc = parseSafeXml(await zip.readText(relsPath), relsPath);
  for (const r of el(doc, 'Relationship'))
    map.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  return map;
};

export function resolveMapping(
  overrides: Record<string, string> | undefined,
): (master: string) => VisioShapeType | null {
  const extra = Object.fromEntries(
    Object.entries(overrides ?? {})
      .map(([k, v]) => [k.toLowerCase(), v])
      .filter(([, v]) => (VISIO_SHAPE_TYPES as readonly string[]).includes(v)),
  ) as Record<string, VisioShapeType>;
  return (m) => extra[m] ?? DEFAULT_VISIO_MAPPING[m] ?? null;
}

/**
 * Reads the pages of a .vsdx package (jszip + safe XML): BPMN stencil and basic flowchart shapes
 * (process, decision, start / end, swimlanes, connectors) become a process structure per page;
 * the shared layout positions it. Shapes without a mapping are counted and reported.
 */
export async function readVisio(
  data: Buffer,
  file: string,
  overrides: Record<string, string> | undefined,
): Promise<VisioPage[]> {
  const zip = await checkOfficePackage(data, file, 'visio/document.xml');
  const mapOf = resolveMapping(overrides);
  const masters = new Map<string, string>();
  if (zip.has('visio/masters/masters.xml')) {
    const doc = parseSafeXml(await zip.readText('visio/masters/masters.xml'), file);
    for (const m of el(doc, 'Master'))
      masters.set(
        m.getAttribute('ID') ?? '',
        masterKey(m.getAttribute('NameU') || m.getAttribute('Name') || ''),
      );
  }
  const pagesDoc = zip.has('visio/pages/pages.xml')
    ? parseSafeXml(await zip.readText('visio/pages/pages.xml'), file)
    : null;
  const rels = await relTargets(zip, 'visio/pages/_rels/pages.xml.rels');
  const out: VisioPage[] = [];
  for (const page of pagesDoc ? el(pagesDoc, 'Page') : []) {
    if (page.getAttribute('Background') === '1') continue;
    const relId = el(page, 'Rel')[0]?.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'id',
    );
    const target = rels.get(relId ?? '');
    if (!target) continue;
    const path = `visio/pages/${target.replace(/^\.\//, '')}`;
    if (!zip.has(path)) continue;
    const doc = parseSafeXml(await zip.readText(path), file);
    out.push(
      readPage(
        doc,
        page.getAttribute('NameU') || page.getAttribute('Name') || 'Page',
        masters,
        mapOf,
      ),
    );
  }
  return out;
}

function readPage(
  doc: Document,
  name: string,
  masters: Map<string, string>,
  mapOf: (m: string) => VisioShapeType | null,
): VisioPage {
  const shapes = new Map<string, VShape>();
  const top = el(doc, 'Shapes')[0];
  const walk = (container: Element, topId: string | null, parentMaster: string) => {
    for (const s of Array.from(container.children).filter((c) => c.localName === 'Shape')) {
      const id = s.getAttribute('ID') ?? '';
      const master =
        masters.get(s.getAttribute('Master') ?? '') ||
        masterKey(s.getAttribute('NameU') || s.getAttribute('Name') || '') ||
        parentMaster;
      const text = Array.from(s.children)
        .filter((c) => c.localName === 'Text')
        .map((t) => t.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      shapes.set(id, {
        id,
        master,
        text,
        x: cell(s, 'PinX') ?? 0,
        y: cell(s, 'PinY') ?? 0,
        w: cell(s, 'Width') ?? 0,
        h: cell(s, 'Height') ?? 0,
        oneD: cell(s, 'BeginX') !== null && cell(s, 'EndX') !== null,
        top: topId ?? id,
      });
      const inner = Array.from(s.children).find((c) => c.localName === 'Shapes');
      if (inner) walk(inner, topId ?? id, master);
    }
  };
  if (top) walk(top, null, '');

  const issues: ImportIssue[] = [];
  const counts = new Map<string, number>();
  const unmapped = new Map<string, number>();
  const nodes = new Map<string, { s: VShape; type: VisioShapeType }>();
  const lanes: VShape[] = [];
  const connectors: VShape[] = [];
  for (const s of shapes.values()) {
    if (s.top !== s.id) continue; // sub-shapes of groups belong to their group
    const key = s.master || (s.oneD ? 'connector' : '');
    if (!key) {
      if (s.text) unmapped.set('(text)', (unmapped.get('(text)') ?? 0) + 1);
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const type = mapOf(key) ?? (s.oneD ? 'flow' : null);
    if (!type) unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
    else if (type === 'flow') connectors.push(s);
    else if (type === 'lane') lanes.push(s);
    else if (type !== 'ignore') nodes.set(s.id, { s, type });
  }

  // Connections: connector → begin / end shape (sub-shapes resolve to their group).
  const ends = new Map<string, { from?: string; to?: string }>();
  for (const c of el(doc, 'Connect')) {
    const from = c.getAttribute('FromSheet') ?? '';
    const to = shapes.get(c.getAttribute('ToSheet') ?? '')?.top ?? '';
    const e = ends.get(from) ?? {};
    if (c.getAttribute('FromCell') === 'BeginX') e.from = to;
    else if (c.getAttribute('FromCell') === 'EndX') e.to = to;
    ends.set(from, e);
  }
  const flows: ProcessStructure['flows'] = [];
  let loose = 0;
  for (const c of connectors) {
    const e = ends.get(c.id);
    if (!e?.from || !e.to || !nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to) {
      loose++;
      continue;
    }
    if (flows.some((f) => f.from === `Shape_${e.from}` && f.to === `Shape_${e.to}`)) continue;
    const l = labelByScript(c.text);
    flows.push({ from: `Shape_${e.from}`, to: `Shape_${e.to}`, ...l });
  }
  if (loose) issues.push(issue('WARNING', 'VISIO_LOOSE_CONNECTORS', { count: loose }));

  // Lanes: a node belongs to the (smallest) lane whose box contains its centre.
  const inLane = (n: VShape, l: VShape) =>
    Math.abs(n.x - l.x) <= l.w / 2 && Math.abs(n.y - l.y) <= l.h / 2;
  const vertical = lanes.length > 1 && lanes.every((l) => l.h > l.w);
  const orderedLanes = [...lanes].sort((a, b) => (vertical ? a.x - b.x : b.y - a.y));
  const structureNodes: StructureNode[] = [];
  const incoming = (id: string) => flows.filter((f) => f.to === `Shape_${id}`).length;
  const outgoing = (id: string) => flows.filter((f) => f.from === `Shape_${id}`).length;
  // Reading order: top to bottom, left to right (the layout follows the flows anyway).
  for (const { s, type } of [...nodes.values()].sort((a, b) => b.s.y - a.s.y || a.s.x - b.s.x)) {
    let t = type;
    if (t === 'startEnd') t = !incoming(s.id) && outgoing(s.id) ? 'startEvent' : 'endEvent';
    const lane = orderedLanes.filter((l) => inLane(s, l)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    structureNodes.push({
      id: `Shape_${s.id}`,
      type: t as StructureNode['type'],
      eventDefinition: 'none',
      ...labelByScript(s.text),
      lane: lane ? `Lane_${lane.id}` : '',
      descriptionEn: '',
      descriptionAr: '',
      systemEn: '',
      systemAr: '',
    });
  }
  const usedLanes = orderedLanes.filter((l) =>
    structureNodes.some((n) => n.lane === `Lane_${l.id}`),
  );
  if (usedLanes.length && structureNodes.some((n) => !n.lane))
    issues.push(
      issue('WARNING', 'VISIO_OUTSIDE_LANES', {
        count: structureNodes.filter((n) => !n.lane).length,
      }),
    );
  for (const [m, n] of unmapped)
    issues.push(issue('WARNING', 'VISIO_UNMAPPED', { shape: m, count: n }));
  const title = labelByScript(name);
  return {
    name,
    shapes: [...shapes.values()].filter((s) => s.top === s.id).length,
    masters: counts,
    unmapped,
    issues,
    structure: {
      nameEn: title.nameEn,
      nameAr: title.nameAr,
      descriptionEn: '',
      descriptionAr: '',
      explanation: '',
      lanes: usedLanes.map((l) => ({ id: `Lane_${l.id}`, ...labelByScript(l.text || l.master) })),
      nodes: structureNodes,
      flows,
    },
  };
}
