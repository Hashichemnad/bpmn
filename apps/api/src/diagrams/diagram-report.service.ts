import { Injectable } from '@nestjs/common';
import {
  SIPOC_COLUMNS,
  extractDecisionRefs,
  extractBpmnLabels,
  extractLaneRoles,
  parseDiagramContent,
  readDmnTables,
  type DiagramNode,
  type DiagramType,
  type GraphContent,
  type Locale,
  type ReportSource,
  type SipocColumn,
  type SipocContent,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';

/** What the handbook needs to know about a process (id, its model and its links). */
export interface HandbookProcessRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  bpmnXml: string | null;
  links: { bpmnElementId: string; relation: string; object: { id: string; type: string } }[];
}

export interface HandbookSipoc {
  title: string;
  columns: Record<SipocColumn, string[]>;
}

export interface HandbookDecision {
  step: string;
  title: string;
  hitPolicy: string;
  inputs: string[];
  outputs: string[];
  rules: { cells: string[]; annotation: string }[];
}

export interface HandbookOrgRow {
  position: string;
  unit: string;
  reportsTo: string;
  chart: string;
}

const pick = (locale: Locale, x: { nameEn?: string; nameAr?: string }) =>
  (locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) || '';

/**
 * Diagram sections of the process handbook (D-126): the value chain path above the process, its
 * SIPOC, the decision tables of its business rule tasks and the organisation chart excerpt of the
 * positions performing its steps. Working source: current content; published source: published
 * versions only.
 */
@Injectable()
export class DiagramReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Diagrams of a type with their content in the requested source. */
  async contents(type: DiagramType, source: ReportSource, ids?: string[]) {
    const diagrams = await this.prisma.diagram.findMany({
      where: {
        type,
        deletedAt: null,
        ...(ids ? { id: { in: ids } } : {}),
        ...(source === 'published' ? { status: { not: 'ARCHIVED' } } : {}),
      },
      select: { id: true, code: true, nameEn: true, nameAr: true, processId: true, content: true },
      orderBy: { code: 'asc' },
    });
    if (source === 'working') return diagrams;
    const pubs = await this.prisma.publication.findMany({
      where: { entityType: 'DIAGRAM', entityId: { in: diagrams.map((d) => d.id) }, current: true },
      select: { entityId: true, versionNumber: true },
    });
    const versions = await this.prisma.diagramVersion.findMany({
      where: { OR: pubs.map((p) => ({ diagramId: p.entityId, versionNumber: p.versionNumber })) },
      select: { diagramId: true, content: true },
    });
    const byId = new Map(versions.map((v) => [v.diagramId, v.content]));
    return diagrams.filter((d) => byId.has(d.id)).map((d) => ({ ...d, content: byId.get(d.id)! }));
  }

  /** "Value chain › frame › element (› process)" for each process, through its ancestors. */
  async valueChainPaths(processes: HandbookProcessRef[], locale: Locale, source: ReportSource) {
    const all = await this.prisma.process.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true, code: true, nameEn: true, nameAr: true },
    });
    const byId = new Map(all.map((p) => [p.id, p]));
    const chains = (await this.contents('VALUE_CHAIN', source)).flatMap((d) => {
      const parsed = parseDiagramContent('VALUE_CHAIN', d.content);
      return parsed.ok && parsed.content?.type === 'VALUE_CHAIN'
        ? [{ d, c: parsed.content as GraphContent }]
        : [];
    });
    const out = new Map<string, string[]>();
    for (const p of processes) {
      const lines: string[] = [];
      // The process itself, then its ancestors: the nearest linked element wins.
      const chain: string[] = [];
      for (
        let cur: string | null = p.id;
        cur && !chain.includes(cur);
        cur = byId.get(cur)?.parentId ?? null
      )
        chain.push(cur);
      for (const { d, c } of chains) {
        const nodes = new Map(c.nodes.map((n) => [n.id, n]));
        for (const target of chain) {
          const el = c.nodes.find((n) => n.processId === target);
          if (!el) continue;
          const parts = [`${d.code} ${pick(locale, d)}`];
          const frame = el.parentId ? nodes.get(el.parentId) : undefined;
          if (frame) parts.push(pick(locale, frame));
          parts.push(pick(locale, el) || el.id);
          // Process-house levels between the linked ancestor and this process.
          const between = chain.slice(0, chain.indexOf(target)).reverse();
          for (const id of between) {
            const x = byId.get(id)!;
            parts.push(`${x.code} ${pick(locale, x)}`);
          }
          lines.push(parts.join(' › '));
          break;
        }
      }
      out.set(p.id, lines);
    }
    return out;
  }

  async sipocs(processes: HandbookProcessRef[], locale: Locale, source: ReportSource) {
    const list = await this.contents('SIPOC', source);
    const out = new Map<string, HandbookSipoc[]>();
    for (const p of processes) {
      const rows: HandbookSipoc[] = [];
      for (const d of list) {
        const parsed = parseDiagramContent('SIPOC', d.content);
        if (!parsed.ok || parsed.content?.type !== 'SIPOC') continue;
        const c = parsed.content as SipocContent;
        if ((c.processId ?? d.processId) !== p.id) continue;
        rows.push({
          title: `${d.code} ${pick(locale, d)}`,
          columns: Object.fromEntries(
            SIPOC_COLUMNS.map((col) => [col, c.columns[col].map((i) => pick(locale, i))]),
          ) as Record<SipocColumn, string[]>,
        });
      }
      out.set(p.id, rows);
    }
    return out;
  }

  async decisions(processes: HandbookProcessRef[], locale: Locale, source: ReportSource) {
    const refs = processes.flatMap((p) =>
      [...extractDecisionRefs(p.bpmnXml ?? '')].map(([elementId, r]) => ({ p, elementId, ...r })),
    );
    const tables = new Map(
      (await this.contents('DMN', source, [...new Set(refs.map((r) => r.diagramId))])).map((d) => [
        d.id,
        d,
      ]),
    );
    const out = new Map<string, HandbookDecision[]>();
    for (const p of processes) out.set(p.id, []);
    for (const r of refs) {
      const d = tables.get(r.diagramId);
      if (!d) continue;
      const labels = extractBpmnLabels(r.p.bpmnXml ?? '');
      const l = labels.get(r.elementId);
      const all = readDmnTables(d.content);
      const t = all.find((x) => x.id === r.decisionId) ?? all[0];
      if (!t) continue;
      out.get(r.p.id)!.push({
        step:
          (l &&
            (locale === 'ar' ? l.nameAr || l.nameEn || l.name : l.nameEn || l.name || l.nameAr)) ||
          r.elementId,
        title: `${d.code} ${pick(locale, t) || pick(locale, d)}`,
        hitPolicy: t.hitPolicy,
        inputs: t.inputs.map((i) => pick(locale, i)),
        outputs: t.outputs.map((o) => pick(locale, o)),
        rules: t.rules.map((rule) => ({
          cells: [...rule.inputs, ...rule.outputs],
          annotation:
            locale === 'ar'
              ? rule.annotationAr || rule.annotationEn
              : rule.annotationEn || rule.annotationAr,
        })),
      });
    }
    return out;
  }

  /** Positions (roles) performing the process's steps, with their unit and superior in the org charts. */
  async orgExcerpt(processes: HandbookProcessRef[], locale: Locale, source: ReportSource) {
    const charts = (await this.contents('ORG_CHART', source)).flatMap((d) => {
      const parsed = parseDiagramContent('ORG_CHART', d.content);
      return parsed.ok && parsed.content?.type === 'ORG_CHART'
        ? [{ d, c: parsed.content as GraphContent }]
        : [];
    });
    const out = new Map<string, HandbookOrgRow[]>();
    for (const p of processes) {
      const roles = new Set([
        ...p.links
          .filter((l) => l.relation === 'PERFORMS' && l.object.type === 'ROLE')
          .map((l) => l.object.id),
        ...[...extractLaneRoles(p.bpmnXml ?? '').values()].filter((v): v is string => !!v),
      ]);
      const rows: HandbookOrgRow[] = [];
      for (const { d, c } of charts) {
        const nodes = new Map(c.nodes.map((n) => [n.id, n]));
        const superior = (n: DiagramNode) => {
          const e = c.edges.find((x) => x.kind === 'reports' && x.targetId === n.id);
          return e ? nodes.get(e.sourceId) : undefined;
        };
        for (const n of c.nodes.filter(
          (x) => x.kind === 'position' && x.objectId && roles.has(x.objectId),
        )) {
          // The unit: the first unit up the reporting lines.
          let unit = superior(n);
          const seen = new Set<string>();
          while (unit && unit.kind !== 'unit' && !seen.has(unit.id)) {
            seen.add(unit.id);
            unit = superior(unit);
          }
          const boss = superior(n);
          rows.push({
            position: pick(locale, n),
            unit: unit ? pick(locale, unit) : '',
            reportsTo: boss ? pick(locale, boss) : '',
            chart: `${d.code} ${pick(locale, d)}`,
          });
        }
      }
      out.set(p.id, rows);
    }
    return out;
  }
}
