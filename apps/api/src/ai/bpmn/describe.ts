import { isGateway, type ProcessStructure, type StructureNode } from './process-structure';

/** Library objects linked to one BPMN element (roles, systems, documents, …). */
export interface ElementLinks {
  [elementId: string]: { type: string; nameEn: string; nameAr: string; relation: string }[];
}

const both = (en: string, ar: string) => (en && ar && en !== ar ? `${en} / ${ar}` : en || ar);

/** Nodes in flow order: breadth-first from the start events, then anything left. */
export function flowOrder(s: ProcessStructure): StructureNode[] {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = s.nodes.filter((n) => n.type === 'startEvent').map((n) => n.id);
  const out: StructureNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id)!);
    queue.push(...s.flows.filter((f) => f.from === id).map((f) => f.to));
  }
  return [...out, ...s.nodes.filter((n) => !seen.has(n.id))];
}

/**
 * Plain-text outline of a process for prompts: lanes, then every step in flow order with its
 * performer, linked roles/systems/documents, description and decision branches.
 */
export function describeProcess(s: ProcessStructure, links: ElementLinks = {}): string {
  const lane = new Map(s.lanes.map((l) => [l.id, both(l.nameEn, l.nameAr)]));
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  if (s.lanes.length)
    lines.push(`Lanes (roles): ${s.lanes.map((l) => both(l.nameEn, l.nameAr)).join('; ')}`);
  let step = 0;
  for (const n of flowOrder(s)) {
    const label = both(n.nameEn, n.nameAr) || '(unnamed)';
    const isTask = !isGateway(n.type) && !n.type.endsWith('Event');
    const prefix = isTask ? `Step ${++step}` : n.type;
    const parts = [`${prefix} [${n.id}] ${label}`];
    if (n.type.endsWith('Event') && n.eventDefinition !== 'none')
      parts.push(`(${n.eventDefinition})`);
    if (n.lane && lane.has(n.lane)) parts.push(`— performed by ${lane.get(n.lane)}`);
    const linked = links[n.id] ?? [];
    if (linked.length)
      parts.push(
        `— linked: ${linked.map((l) => `${l.type.toLowerCase()} ${both(l.nameEn, l.nameAr)} (${l.relation})`).join(', ')}`,
      );
    const desc = both(n.descriptionEn, n.descriptionAr);
    if (desc) parts.push(`— ${desc}`);
    lines.push(parts.join(' '));
    const out = s.flows.filter((f) => f.from === n.id);
    if (isGateway(n.type) && out.length > 1)
      for (const f of out)
        lines.push(
          `    → ${both(f.nameEn, f.nameAr) || '(no label)'}: ${both(byId.get(f.to)?.nameEn ?? '', byId.get(f.to)?.nameAr ?? '') || f.to}`,
        );
  }
  return lines.join('\n');
}

/** Structural differences between two versions of a process, one line per change. */
export function diffStructures(a: ProcessStructure, b: ProcessStructure): string[] {
  const out: string[] = [];
  const name = (n: { nameEn: string; nameAr: string }) => both(n.nameEn, n.nameAr) || '(unnamed)';
  const lanesA = new Map(a.lanes.map((l) => [l.id, l]));
  const lanesB = new Map(b.lanes.map((l) => [l.id, l]));
  for (const l of b.lanes) if (!lanesA.has(l.id)) out.push(`Lane added: ${name(l)}`);
  for (const l of a.lanes) if (!lanesB.has(l.id)) out.push(`Lane removed: ${name(l)}`);
  for (const l of b.lanes) {
    const old = lanesA.get(l.id);
    if (old && name(old) !== name(l)) out.push(`Lane renamed: ${name(old)} → ${name(l)}`);
  }
  const nodesA = new Map(a.nodes.map((n) => [n.id, n]));
  const nodesB = new Map(b.nodes.map((n) => [n.id, n]));
  const laneName = (s: ProcessStructure, id: string) => {
    const l = s.lanes.find((x) => x.id === id);
    return l ? name(l) : '—';
  };
  for (const n of b.nodes)
    if (!nodesA.has(n.id))
      out.push(`Added ${n.type}: ${name(n)}${n.lane ? ` (lane ${laneName(b, n.lane)})` : ''}`);
  for (const n of a.nodes) if (!nodesB.has(n.id)) out.push(`Removed ${n.type}: ${name(n)}`);
  for (const n of b.nodes) {
    const old = nodesA.get(n.id);
    if (!old) continue;
    if (name(old) !== name(n)) out.push(`Renamed: ${name(old)} → ${name(n)}`);
    if (old.type !== n.type) out.push(`Type of ${name(n)} changed: ${old.type} → ${n.type}`);
    if (old.lane !== n.lane)
      out.push(`${name(n)} moved from lane ${laneName(a, old.lane)} to ${laneName(b, n.lane)}`);
    if (both(old.descriptionEn, old.descriptionAr) !== both(n.descriptionEn, n.descriptionAr))
      out.push(`Description of ${name(n)} changed`);
  }
  const key = (f: { from: string; to: string }) => `${f.from}->${f.to}`;
  const flowsA = new Map(a.flows.map((f) => [key(f), f]));
  const flowsB = new Map(b.flows.map((f) => [key(f), f]));
  const nodeName = (id: string) => {
    const n = nodesB.get(id) ?? nodesA.get(id);
    return n ? name(n) : id;
  };
  for (const f of b.flows)
    if (!flowsA.has(key(f)))
      out.push(
        `New connection: ${nodeName(f.from)} → ${nodeName(f.to)}${f.nameEn || f.nameAr ? ` [${both(f.nameEn, f.nameAr)}]` : ''}`,
      );
  for (const f of a.flows)
    if (!flowsB.has(key(f)))
      out.push(`Removed connection: ${nodeName(f.from)} → ${nodeName(f.to)}`);
  for (const f of b.flows) {
    const old = flowsA.get(key(f));
    if (old && both(old.nameEn, old.nameAr) !== both(f.nameEn, f.nameAr))
      out.push(
        `Condition ${nodeName(f.from)} → ${nodeName(f.to)} changed: ${both(old.nameEn, old.nameAr) || '—'} → ${both(f.nameEn, f.nameAr) || '—'}`,
      );
  }
  return out;
}
