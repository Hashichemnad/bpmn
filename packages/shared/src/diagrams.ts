/**
 * Diagram types beyond BPMN (D-120): value chain, organisation chart, DMN decision tables, EPC and
 * SIPOC. One `Diagram` entity carries them; the content is DMN 1.3 XML for decision tables and
 * versioned JSON for the other notations, validated here with zod on the client and the server.
 */
import { z } from 'zod';
import {
  LINK_RELATIONS,
  PROCESS_STATUSES,
  type LinkRelation,
  type ProcessStatus,
} from './constants';
import { paginationQuerySchema, uuidSchema } from './schemas';
import type { DepartmentRef, PortalMetaDto, PortalStepLinkDto, UserRef } from './types';

export const DIAGRAM_TYPES = ['VALUE_CHAIN', 'ORG_CHART', 'DMN', 'EPC', 'SIPOC'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

/** Prefix of the generated diagram codes (VC-001, ORG-001 …). */
export const DIAGRAM_CODE_PREFIX: Record<DiagramType, string> = {
  VALUE_CHAIN: 'VC',
  ORG_CHART: 'ORG',
  DMN: 'DMN',
  EPC: 'EPC',
  SIPOC: 'SIPOC',
};

/** Notations drawn on a diagram-js canvas with the shared kit (graph JSON content). */
export const GRAPH_DIAGRAM_TYPES = ['VALUE_CHAIN', 'ORG_CHART', 'EPC'] as const;
export type GraphDiagramType = (typeof GRAPH_DIAGRAM_TYPES)[number];
export const isGraphDiagramType = (t: DiagramType): t is GraphDiagramType =>
  (GRAPH_DIAGRAM_TYPES as readonly string[]).includes(t);

/** Shape kinds per notation. */
export const DIAGRAM_NODE_KINDS = {
  VALUE_CHAIN: ['chevron', 'block', 'frame'],
  ORG_CHART: ['unit', 'position', 'person'],
  EPC: [
    'event',
    'function',
    'and',
    'or',
    'xor',
    'processPath',
    'orgUnit',
    'system',
    'information',
    'document',
  ],
} as const satisfies Record<GraphDiagramType, readonly string[]>;

/** Connection kinds per notation. */
export const DIAGRAM_EDGE_KINDS = {
  VALUE_CHAIN: ['arrow'],
  /** `reports`: line of authority; `staff`: staff function attached to a unit / position. */
  ORG_CHART: ['reports', 'staff'],
  /** `flow`: control flow; `assignment`: org unit / system / information / document ↔ function. */
  EPC: ['flow', 'assignment'],
} as const satisfies Record<GraphDiagramType, readonly string[]>;

export type ValueChainNodeKind = (typeof DIAGRAM_NODE_KINDS.VALUE_CHAIN)[number];
export type OrgNodeKind = (typeof DIAGRAM_NODE_KINDS.ORG_CHART)[number];
export type EpcNodeKind = (typeof DIAGRAM_NODE_KINDS.EPC)[number];

/** Upper limits of a diagram's content. */
export const DIAGRAM_LIMITS = {
  contentBytes: 2 * 1024 * 1024,
  dmnBytes: 2 * 1024 * 1024,
  nodes: 1500,
  edges: 3000,
  waypoints: 60,
  label: 300,
  description: 4000,
  sipocItems: 40,
} as const;

/** Element ids: XML NCName-like, so they are valid in DMN / BPMN conversions and in URLs. */
export const DIAGRAM_ELEMENT_ID_RE = /^[A-Za-z_][\w.-]{0,79}$/;
const elementId = z.string().regex(DIAGRAM_ELEMENT_ID_RE, 'INVALID_ELEMENT_ID');
const label = z.string().max(DIAGRAM_LIMITS.label).default('');
const description = z.string().max(DIAGRAM_LIMITS.description).optional();
const coordinate = z.number().finite().min(-100000).max(100000);
const size = z.number().finite().min(1).max(20000);
const colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'INVALID_COLOUR')
  .optional();

export const diagramNodeSchema = z.object({
  id: elementId,
  kind: z.string().max(40),
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
  nameEn: label,
  nameAr: label,
  descriptionEn: description,
  descriptionAr: description,
  fill: colour,
  stroke: colour,
  /** Grouping frame that contains this shape (value chain). */
  parentId: elementId.optional(),
  /** Drill-down / reference targets. */
  processId: uuidSchema.optional(),
  diagramId: uuidSchema.optional(),
  /** Org chart: person → user, unit → department; positions and EPC org units / systems / documents → library object. */
  userId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  objectId: uuidSchema.optional(),
  /** Value chain: Management / Core / Support row the element belongs to. */
  category: z.enum(['MANAGEMENT', 'CORE', 'SUPPORT']).optional(),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export const diagramEdgeSchema = z.object({
  id: elementId,
  kind: z.string().max(40),
  sourceId: elementId,
  targetId: elementId,
  waypoints: z
    .array(z.object({ x: coordinate, y: coordinate }))
    .max(DIAGRAM_LIMITS.waypoints)
    .default([]),
  nameEn: label,
  nameAr: label,
});
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

export const graphContentSchema = z.object({
  schema: z.literal(1),
  type: z.enum(GRAPH_DIAGRAM_TYPES),
  nodes: z.array(diagramNodeSchema).max(DIAGRAM_LIMITS.nodes),
  edges: z.array(diagramEdgeSchema).max(DIAGRAM_LIMITS.edges),
});
export type GraphContent = z.infer<typeof graphContentSchema>;

export const SIPOC_COLUMNS = ['suppliers', 'inputs', 'steps', 'outputs', 'customers'] as const;
export type SipocColumn = (typeof SIPOC_COLUMNS)[number];

export const sipocItemSchema = z.object({ id: elementId, nameEn: label, nameAr: label });
export type SipocItem = z.infer<typeof sipocItemSchema>;

export const sipocContentSchema = z.object({
  schema: z.literal(1),
  type: z.literal('SIPOC'),
  /** Process the SIPOC describes (generation source). */
  processId: uuidSchema.optional(),
  columns: z.object(
    Object.fromEntries(
      SIPOC_COLUMNS.map((c) => [c, z.array(sipocItemSchema).max(DIAGRAM_LIMITS.sipocItems)]),
    ) as Record<SipocColumn, z.ZodArray<typeof sipocItemSchema>>,
  ),
});
export type SipocContent = z.infer<typeof sipocContentSchema>;

export type JsonDiagramContent = GraphContent | SipocContent;

export interface DiagramContentIssue {
  path: (string | number)[];
  code: string;
}

export type DiagramContentResult =
  | { ok: true; content: JsonDiagramContent | null; xml: string | null }
  | { ok: false; issues: DiagramContentIssue[] };

/** Structural rules zod cannot express: unique ids, connections to existing shapes, allowed kinds. */
function graphIssues(c: GraphContent): DiagramContentIssue[] {
  const issues: DiagramContentIssue[] = [];
  const nodeKinds: readonly string[] = DIAGRAM_NODE_KINDS[c.type];
  const edgeKinds: readonly string[] = DIAGRAM_EDGE_KINDS[c.type];
  const ids = new Set<string>();
  const nodes = new Map(c.nodes.map((n) => [n.id, n]));
  c.nodes.forEach((n, i) => {
    if (ids.has(n.id)) issues.push({ path: ['nodes', i, 'id'], code: 'DUPLICATE_ID' });
    ids.add(n.id);
    if (!nodeKinds.includes(n.kind))
      issues.push({ path: ['nodes', i, 'kind'], code: 'INVALID_KIND' });
    if (n.parentId && (n.parentId === n.id || nodes.get(n.parentId)?.kind !== 'frame'))
      issues.push({ path: ['nodes', i, 'parentId'], code: 'INVALID_PARENT' });
  });
  c.edges.forEach((e, i) => {
    if (ids.has(e.id)) issues.push({ path: ['edges', i, 'id'], code: 'DUPLICATE_ID' });
    ids.add(e.id);
    if (!edgeKinds.includes(e.kind))
      issues.push({ path: ['edges', i, 'kind'], code: 'INVALID_KIND' });
    if (!nodes.has(e.sourceId))
      issues.push({ path: ['edges', i, 'sourceId'], code: 'UNKNOWN_NODE' });
    if (!nodes.has(e.targetId))
      issues.push({ path: ['edges', i, 'targetId'], code: 'UNKNOWN_NODE' });
  });
  return issues;
}

function sipocIssues(c: SipocContent): DiagramContentIssue[] {
  const issues: DiagramContentIssue[] = [];
  const ids = new Set<string>();
  for (const col of SIPOC_COLUMNS)
    c.columns[col].forEach((item, i) => {
      if (ids.has(item.id)) issues.push({ path: ['columns', col, i, 'id'], code: 'DUPLICATE_ID' });
      ids.add(item.id);
    });
  return issues;
}

/** DMN content must be a DMN 1.x definitions document (the server also runs the unsafe-XML checks). */
export function dmnIssues(xml: string): DiagramContentIssue[] {
  if (xml.length > DIAGRAM_LIMITS.dmnBytes) return [{ path: [], code: 'TOO_LARGE' }];
  if (
    !/<(?:[\w-]+:)?definitions[\s>]/.test(xml) ||
    !/https:\/\/www\.omg\.org\/spec\/DMN\//.test(xml)
  )
    return [{ path: [], code: 'NOT_DMN' }];
  return [];
}

/** Parses and validates the stored / submitted content of a diagram of the given type. */
export function parseDiagramContent(type: DiagramType, raw: string): DiagramContentResult {
  if (raw.length > DIAGRAM_LIMITS.contentBytes)
    return { ok: false, issues: [{ path: [], code: 'TOO_LARGE' }] };
  if (type === 'DMN') {
    const issues = dmnIssues(raw);
    return issues.length ? { ok: false, issues } : { ok: true, content: null, xml: raw };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, issues: [{ path: [], code: 'INVALID_JSON' }] };
  }
  const schema = type === 'SIPOC' ? sipocContentSchema : graphContentSchema;
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        code: i.message,
      })),
    };
  const content = parsed.data as JsonDiagramContent;
  if (content.type !== type)
    return { ok: false, issues: [{ path: ['type'], code: 'TYPE_MISMATCH' }] };
  const issues = content.type === 'SIPOC' ? sipocIssues(content) : graphIssues(content);
  return issues.length ? { ok: false, issues } : { ok: true, content, xml: null };
}

/** Serialises JSON content in a stable form (two-space indent) so versions compare cleanly. */
export const stringifyDiagramContent = (c: JsonDiagramContent) => JSON.stringify(c, null, 2);

/** An empty DMN 1.3 model with one decision table (bilingual names in the ph namespace). */
export function emptyDmnXml(id: string, nameEn: string, nameAr: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;');
  const name = esc(nameEn || nameAr || 'Decision');
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:ph="http://processhub.local/schema/1.0" id="Definitions_${id}" name="${name}" namespace="http://processhub.local/dmn">
  <decision id="Decision_1" name="${name}" ph:nameEn="${esc(nameEn)}" ph:nameAr="${esc(nameAr)}">
    <decisionTable id="DecisionTable_1" hitPolicy="UNIQUE">
      <input id="Input_1" label="Input">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text>input</text>
        </inputExpression>
      </input>
      <output id="Output_1" label="Output" name="output" typeRef="string" />
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="Decision_1">
        <dc:Bounds height="80" width="180" x="160" y="100" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}

/** Initial content of a new diagram. */
export function emptyDiagramContent(type: DiagramType, nameEn = '', nameAr = ''): string {
  if (type === 'DMN') return emptyDmnXml('1', nameEn, nameAr);
  if (type === 'SIPOC')
    return stringifyDiagramContent({
      schema: 1,
      type: 'SIPOC',
      columns: { suppliers: [], inputs: [], steps: [], outputs: [], customers: [] },
    });
  return stringifyDiagramContent({ schema: 1, type, nodes: [], edges: [] });
}

/** A labelled element of a diagram (search text, publication, link labels, comments). */
export interface DiagramElementLabel {
  id: string;
  kind: string;
  nameEn: string;
  nameAr: string;
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const decode = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : XML_ENTITIES[e.toLowerCase()],
  );

/** Labelled DMN elements (decisions, inputs, outputs, input data, knowledge sources) with ph:nameEn / ph:nameAr. */
export function extractDmnLabels(xml: string): DiagramElementLabel[] {
  const out: DiagramElementLabel[] = [];
  const tagRe =
    /<(?:[\w-]+:)?(decision|input|output|inputData|knowledgeSource|businessKnowledgeModel)\s([^>]*?)\/?>/g;
  const attrRe = /([\w:-]+)="([^"]*)"/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(xml))) {
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(tag[2]))) attrs[a[1]] = decode(a[2]);
    if (!attrs.id) continue;
    const base = attrs.name ?? attrs.label ?? '';
    out.push({
      id: attrs.id,
      kind: tag[1],
      nameEn: attrs['ph:nameEn'] || base,
      nameAr: attrs['ph:nameAr'] ?? '',
    });
  }
  return out;
}

/** Every labelled element of a diagram's content (invalid content yields none). */
export function diagramElements(type: DiagramType, raw: string): DiagramElementLabel[] {
  const parsed = parseDiagramContent(type, raw);
  if (!parsed.ok) return [];
  if (parsed.xml !== null) return extractDmnLabels(parsed.xml);
  const c = parsed.content!;
  if (c.type === 'SIPOC')
    return SIPOC_COLUMNS.flatMap((col) =>
      c.columns[col].map((i) => ({ id: i.id, kind: col, nameEn: i.nameEn, nameAr: i.nameAr })),
    );
  return [
    ...c.nodes.map((n) => ({ id: n.id, kind: n.kind, nameEn: n.nameEn, nameAr: n.nameAr })),
    ...c.edges
      .filter((e) => e.nameEn || e.nameAr)
      .map((e) => ({ id: e.id, kind: e.kind, nameEn: e.nameEn, nameAr: e.nameAr })),
  ];
}

/** Ids of every element (shapes, connections, SIPOC items, DMN elements incl. rules). */
export function diagramElementIds(type: DiagramType, raw: string): Set<string> {
  if (type === 'DMN') {
    const ids = new Set<string>();
    const re = /\sid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) ids.add(m[1]);
    return ids;
  }
  const parsed = parseDiagramContent(type, raw);
  if (!parsed.ok || !parsed.content) return new Set();
  const c = parsed.content;
  if (c.type === 'SIPOC')
    return new Set(SIPOC_COLUMNS.flatMap((col) => c.columns[col].map((i) => i.id)));
  return new Set([...c.nodes.map((n) => n.id), ...c.edges.map((e) => e.id)]);
}

/** Plain text per language for search and publication snapshots. */
export function diagramText(type: DiagramType, raw: string): { textEn: string; textAr: string } {
  const els = diagramElements(type, raw);
  return {
    textEn: els
      .map((e) => e.nameEn)
      .filter(Boolean)
      .join('\n'),
    textAr: els
      .map((e) => e.nameAr)
      .filter(Boolean)
      .join('\n'),
  };
}

/** Processes and diagrams referenced by the content (drill-down targets, SIPOC source). */
export function diagramRefs(
  type: DiagramType,
  raw: string,
): { processIds: string[]; diagramIds: string[] } {
  const parsed = parseDiagramContent(type, raw);
  if (!parsed.ok || !parsed.content) return { processIds: [], diagramIds: [] };
  const c = parsed.content;
  if (c.type === 'SIPOC') return { processIds: c.processId ? [c.processId] : [], diagramIds: [] };
  return {
    processIds: [...new Set(c.nodes.flatMap((n) => (n.processId ? [n.processId] : [])))],
    diagramIds: [...new Set(c.nodes.flatMap((n) => (n.diagramId ? [n.diagramId] : [])))],
  };
}

// ---------- API schemas ----------

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .nullable()
    .transform((v) => v ?? '')
    .optional();

const diagramFields = {
  nameEn: optionalText(200),
  nameAr: optionalText(200),
  descriptionEn: optionalText(5000),
  descriptionAr: optionalText(5000),
  processId: uuidSchema.nullable().optional(),
  ownerId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
};

const contentString = z.string().min(1).max(DIAGRAM_LIMITS.contentBytes);

export const createDiagramSchema = z
  .object({
    type: z.enum(DIAGRAM_TYPES),
    ...diagramFields,
    /** Initial content (generated diagrams); an empty diagram otherwise. */
    content: contentString.optional(),
    /** Change note: when set, the initial content is also saved as version 1. */
    changeNote: trimmed(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.nameEn && !v.nameAr)
      ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
  });
export type CreateDiagramInput = z.infer<typeof createDiagramSchema>;

export const updateDiagramSchema = z.object(diagramFields);
export type UpdateDiagramInput = z.infer<typeof updateDiagramSchema>;

export const diagramListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(DIAGRAM_TYPES).optional(),
  status: z.enum(PROCESS_STATUSES).optional(),
  /** A process id, or `none` for diagrams without a parent process. */
  processId: z.union([uuidSchema, z.literal('none')]).optional(),
  ownerId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
});
export type DiagramListQuery = z.infer<typeof diagramListQuerySchema>;

export const saveDiagramContentSchema = z.object({
  content: contentString,
  aiGenerated: z.boolean().optional(),
});
export type SaveDiagramContentInput = z.infer<typeof saveDiagramContentSchema>;

export const createDiagramVersionSchema = z.object({
  content: contentString,
  changeNote: trimmed(1000).min(1),
  aiGenerated: z.boolean().optional(),
});
export type CreateDiagramVersionInput = z.infer<typeof createDiagramVersionSchema>;

export const createDiagramLinkSchema = z.object({
  elementId: z.string().trim().regex(DIAGRAM_ELEMENT_ID_RE, 'INVALID_ELEMENT_ID'),
  repoObjectId: uuidSchema,
  relation: z.enum(LINK_RELATIONS).optional(),
});
export type CreateDiagramLinkInput = z.infer<typeof createDiagramLinkSchema>;

// ---------- DTOs ----------

export interface DiagramSummaryDto {
  id: string;
  type: DiagramType;
  code: string;
  nameEn: string;
  nameAr: string;
  status: ProcessStatus;
  processId: string | null;
  ownerId: string | null;
  departmentId: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface DiagramDto extends DiagramSummaryDto {
  descriptionEn: string;
  descriptionAr: string;
  owner: UserRef | null;
  department: DepartmentRef | null;
  process: { id: string; code: string; nameEn: string; nameAr: string } | null;
  aiGenerated: boolean;
  latestVersion: number | null;
  canEdit: boolean;
  canEditContent: boolean;
  canDelete: boolean;
  createdAt: string;
}

export interface DiagramContentDto {
  diagramId: string;
  type: DiagramType;
  content: string;
  updatedAt: string;
  updatedBy: UserRef | null;
}

export interface DiagramVersionDto {
  id: string;
  versionNumber: number;
  changeNote: string;
  label: string | null;
  restoredFrom: number | null;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface DiagramLinkDto {
  id: string;
  diagramId: string;
  elementId: string;
  element: { nameEn: string; nameAr: string } | null;
  relation: LinkRelation;
  repoObject: { id: string; type: string; code: string | null; nameEn: string; nameAr: string };
}

/** A diagram that refers to a process, another diagram or a library object. */
export interface DiagramUsageDto {
  diagram: Pick<DiagramSummaryDto, 'id' | 'type' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  elementId: string | null;
  element: { nameEn: string; nameAr: string } | null;
  relation: LinkRelation | 'DRILLDOWN' | 'SOURCE' | 'DECISION';
}

// ---------- Knowledge Portal ----------

export interface PortalDiagramRefDto {
  id: string;
  type: DiagramType;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface PortalDiagramDto extends PortalDiagramRefDto {
  descriptionEn: string;
  descriptionAr: string;
  department: DepartmentRef | null;
  /** Published parent process. */
  process: { id: string; code: string; nameEn: string; nameAr: string } | null;
  meta: PortalMetaDto;
  /** Content of the published version. */
  content: string;
  links: { elementId: string; relation: LinkRelation; object: PortalStepLinkDto['object'] }[];
  /** Published processes and diagrams the elements drill down into (others are not linked). */
  drillProcesses: { id: string; code: string; nameEn: string; nameAr: string }[];
  drillDiagrams: PortalDiagramRefDto[];
}
