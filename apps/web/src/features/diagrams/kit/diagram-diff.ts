import {
  diagramElements,
  parseDiagramContent,
  type DiagramElementLabel,
  type DiagramType,
} from '@processhub/shared';

export interface DiagramChange {
  id: string;
  kind: string;
  before: DiagramElementLabel | null;
  after: DiagramElementLabel | null;
  /** What changed on an element present in both versions. */
  aspects: ('label' | 'layout' | 'properties')[];
}

export interface DiagramDiff {
  added: DiagramChange[];
  removed: DiagramChange[];
  changed: DiagramChange[];
}

type Raw = Record<string, unknown>;

/** Elements of JSON content with every stored property, by id (DMN: labels only). */
function elementMap(type: DiagramType, raw: string | null): Map<string, Raw> {
  if (!raw) return new Map();
  const parsed = parseDiagramContent(type, raw);
  if (!parsed.ok || !parsed.content) {
    return new Map(diagramElements(type, raw).map((e) => [e.id, e as unknown as Raw]));
  }
  const c = parsed.content;
  if (c.type === 'SIPOC')
    return new Map(
      Object.entries(c.columns).flatMap(([col, items], _i) =>
        items.map((item, idx) => [item.id, { ...item, kind: col, order: idx }] as [string, Raw]),
      ),
    );
  return new Map<string, Raw>([
    ...c.nodes.map((n) => [n.id, n as unknown as Raw] as [string, Raw]),
    ...c.edges.map((e) => [e.id, e as unknown as Raw] as [string, Raw]),
  ]);
}

const LAYOUT = ['x', 'y', 'width', 'height', 'waypoints', 'order'];
const LABEL = ['nameEn', 'nameAr'];

/** Element-level differences between two contents of the same diagram type (version compare). */
export function diffDiagram(type: DiagramType, base: string | null, next: string): DiagramDiff {
  const a = elementMap(type, base);
  const b = elementMap(type, next);
  const label = (r: Raw | undefined, id: string): DiagramElementLabel | null =>
    r
      ? {
          id,
          kind: String(r.kind ?? ''),
          nameEn: String(r.nameEn ?? ''),
          nameAr: String(r.nameAr ?? ''),
        }
      : null;
  const diff: DiagramDiff = { added: [], removed: [], changed: [] };
  for (const [id, after] of b) {
    const before = a.get(id);
    if (!before) {
      diff.added.push({
        id,
        kind: String(after.kind ?? ''),
        before: null,
        after: label(after, id),
        aspects: [],
      });
      continue;
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const aspects = new Set<DiagramChange['aspects'][number]>();
    for (const k of keys) {
      if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
      aspects.add(LAYOUT.includes(k) ? 'layout' : LABEL.includes(k) ? 'label' : 'properties');
    }
    if (aspects.size)
      diff.changed.push({
        id,
        kind: String(after.kind ?? ''),
        before: label(before, id),
        after: label(after, id),
        aspects: [...aspects],
      });
  }
  for (const [id, before] of a)
    if (!b.has(id))
      diff.removed.push({
        id,
        kind: String(before.kind ?? ''),
        before: label(before, id),
        after: null,
        aspects: [],
      });
  return diff;
}
