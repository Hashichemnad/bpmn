/**
 * Lightweight BPMN validation over a simplified element graph. The web modeler
 * builds the graph from the bpmn-js element registry; keeping the rules here
 * makes them testable and reusable on the server.
 */
export interface BpmnGraphElement {
  id: string;
  /** BPMN type, e.g. "bpmn:Task", "bpmn:StartEvent". */
  type: string;
  name?: string;
  incoming: number;
  outgoing: number;
  /** For call activities / collapsed sub-processes: linked repository process id. */
  linkedProcessId?: string | null;
  /** True when the element lives inside an expanded sub-process. */
  nested?: boolean;
}

export type BpmnIssueCode =
  | 'NO_START_EVENT'
  | 'NO_END_EVENT'
  | 'UNCONNECTED_ELEMENT'
  | 'MISSING_INCOMING'
  | 'MISSING_OUTGOING'
  | 'UNNAMED_ACTIVITY'
  | 'GATEWAY_NOT_BRANCHING'
  | 'CALL_ACTIVITY_UNLINKED';

export interface BpmnIssue {
  code: BpmnIssueCode;
  severity: 'warning' | 'info';
  elementId?: string;
}

const ACTIVITY_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:SubProcess',
  'bpmn:CallActivity',
]);

const GATEWAY_TYPES = new Set([
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway',
]);

const EVENT_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:IntermediateCatchEvent',
]);

export function isFlowNode(type: string): boolean {
  return ACTIVITY_TYPES.has(type) || GATEWAY_TYPES.has(type) || EVENT_TYPES.has(type);
}

export function isActivity(type: string): boolean {
  return ACTIVITY_TYPES.has(type);
}

export function validateBpmnGraph(elements: BpmnGraphElement[]): BpmnIssue[] {
  const issues: BpmnIssue[] = [];
  const nodes = elements.filter((e) => isFlowNode(e.type));
  if (nodes.length === 0) return issues;

  const topLevel = nodes.filter((n) => !n.nested);
  if (!topLevel.some((n) => n.type === 'bpmn:StartEvent')) {
    issues.push({ code: 'NO_START_EVENT', severity: 'warning' });
  }
  if (!topLevel.some((n) => n.type === 'bpmn:EndEvent')) {
    issues.push({ code: 'NO_END_EVENT', severity: 'warning' });
  }

  for (const n of nodes) {
    const isStart = n.type === 'bpmn:StartEvent';
    const isEnd = n.type === 'bpmn:EndEvent';
    if (n.incoming === 0 && n.outgoing === 0 && nodes.length > 1) {
      issues.push({ code: 'UNCONNECTED_ELEMENT', severity: 'warning', elementId: n.id });
      continue;
    }
    if (!isStart && n.incoming === 0) {
      issues.push({ code: 'MISSING_INCOMING', severity: 'warning', elementId: n.id });
    }
    if (!isEnd && n.outgoing === 0) {
      issues.push({ code: 'MISSING_OUTGOING', severity: 'warning', elementId: n.id });
    }
    if (isActivity(n.type) && !n.name?.trim()) {
      issues.push({ code: 'UNNAMED_ACTIVITY', severity: 'info', elementId: n.id });
    }
    if (GATEWAY_TYPES.has(n.type) && n.incoming <= 1 && n.outgoing <= 1) {
      issues.push({ code: 'GATEWAY_NOT_BRANCHING', severity: 'info', elementId: n.id });
    }
    if (n.type === 'bpmn:CallActivity' && !n.linkedProcessId) {
      issues.push({ code: 'CALL_ACTIVITY_UNLINKED', severity: 'info', elementId: n.id });
    }
  }
  return issues;
}

/** Extracts all `id="..."` attribute values from BPMN XML (used to prune stale object links). */
export function extractBpmnElementIds(xml: string): Set<string> {
  const ids = new Set<string>();
  const re = /\sid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) ids.add(m[1]);
  return ids;
}

export interface BpmnElementLabel {
  name: string;
  nameEn: string;
  nameAr: string;
  /** Step description (ph:descriptionEn / ph:descriptionAr). */
  descriptionEn: string;
  descriptionAr: string;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** Extracts element labels (name, ph:nameEn/Ar) and step descriptions by element id from BPMN XML. */
export function extractBpmnLabels(xml: string): Map<string, BpmnElementLabel> {
  const labels = new Map<string, BpmnElementLabel>();
  const tagRe = /<[\w:-]+\s([^>]*?)\/?>/g;
  const attrRe = /([\w:-]+)="([^"]*)"/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(xml))) {
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(tag[1]))) attrs[a[1]] = decodeXml(a[2]);
    const texts = ['name', 'ph:nameEn', 'ph:nameAr', 'ph:descriptionEn', 'ph:descriptionAr'];
    if (!attrs.id || !texts.some((k) => attrs[k])) continue;
    labels.set(attrs.id, {
      name: attrs.name ?? '',
      nameEn: attrs['ph:nameEn'] ?? '',
      nameAr: attrs['ph:nameAr'] ?? '',
      descriptionEn: attrs['ph:descriptionEn'] ?? '',
      descriptionAr: attrs['ph:descriptionAr'] ?? '',
    });
  }
  return labels;
}

/**
 * Lanes of BPMN XML and the library Role each is linked to (`ph:roleId`, D-079); lanes without a
 * role map to null. The API keeps a PERFORMS object link per linked lane in sync with this.
 */
export function extractLaneRoles(xml: string): Map<string, string | null> {
  const lanes = new Map<string, string | null>();
  const tagRe = /<(?:[\w-]+:)?lane\s([^>]*?)\/?>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(xml))) {
    const id = /(?:^|\s)id="([^"]+)"/.exec(tag[1])?.[1];
    if (!id) continue;
    const role = /(?:^|\s)[\w-]+:roleId="([^"]*)"/.exec(tag[1])?.[1]?.trim();
    lanes.set(decodeXml(id), role ? decodeXml(role) : null);
  }
  return lanes;
}
