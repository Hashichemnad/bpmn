import { z } from 'zod';
import { AiOutputInvalid } from '../ai-gateway.service';

/**
 * The structured process the assistant produces (and receives when refining): lanes per role,
 * flow nodes and sequence flows, with bilingual labels. The server — never the model — turns
 * it into BPMN 2.0 XML with a layout.
 */
export const NODE_TYPES = [
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'task',
  'userTask',
  'manualTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'scriptTask',
  'businessRuleTask',
  'callActivity',
  'subProcess',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'eventBasedGateway',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EVENT_DEFINITIONS = [
  'none',
  'timer',
  'message',
  'signal',
  'error',
  'escalation',
  'conditional',
  'terminate',
] as const;
export type EventDefinition = (typeof EVENT_DEFINITIONS)[number];

export const isGateway = (t: NodeType) => t.endsWith('Gateway');
export const isEvent = (t: NodeType) => t.endsWith('Event');
export const isActivity = (t: NodeType) => !isGateway(t) && !isEvent(t);

const label = z.string().max(300);
const id = z.string().max(64);

export const structureSchema = z.object({
  nameEn: label,
  nameAr: label,
  descriptionEn: z.string().max(2000),
  descriptionAr: z.string().max(2000),
  explanation: z.string().max(4000),
  lanes: z.array(z.object({ id, nameEn: label, nameAr: label })).max(20),
  nodes: z
    .array(
      z.object({
        id,
        type: z.enum(NODE_TYPES),
        eventDefinition: z.enum(EVENT_DEFINITIONS),
        nameEn: label,
        nameAr: label,
        lane: z.string().max(64),
        descriptionEn: z.string().max(1000),
        descriptionAr: z.string().max(1000),
        systemEn: label,
        systemAr: label,
      }),
    )
    .min(2)
    .max(80),
  flows: z
    .array(z.object({ from: id, to: id, nameEn: label, nameAr: label }))
    .min(1)
    .max(160),
});
export type ProcessStructure = z.infer<typeof structureSchema>;
export type StructureNode = ProcessStructure['nodes'][number];

const str = (description: string, maxLength = 300) => ({ type: 'string', description, maxLength });

/** JSON schema of ProcessStructure for structured output (every field required, no extras). */
export const structureJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'nameEn',
    'nameAr',
    'descriptionEn',
    'descriptionAr',
    'explanation',
    'lanes',
    'nodes',
    'flows',
  ],
  properties: {
    nameEn: str('Process name in English'),
    nameAr: str('Process name in Arabic'),
    descriptionEn: str('One or two sentences: purpose and scope, English', 2000),
    descriptionAr: str('The same description in Arabic', 2000),
    explanation: str(
      "Short explanation for the user of what was built or changed, in the user's language",
      4000,
    ),
    lanes: {
      type: 'array',
      description:
        'One lane per role / organisational unit performing steps; empty when there is a single performer',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'nameEn', 'nameAr'],
        properties: {
          id: str('Unique id, e.g. Lane_HR (letters, digits, _ and -)', 64),
          nameEn: str('Role name in English'),
          nameAr: str('Role name in Arabic'),
        },
      },
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'type',
          'eventDefinition',
          'nameEn',
          'nameAr',
          'lane',
          'descriptionEn',
          'descriptionAr',
          'systemEn',
          'systemAr',
        ],
        properties: {
          id: str('Unique id, e.g. Task_CheckBudget (letters, digits, _ and -)', 64),
          type: { type: 'string', enum: [...NODE_TYPES] },
          eventDefinition: {
            type: 'string',
            enum: [...EVENT_DEFINITIONS],
            description: "Events only (e.g. timer for a wait); 'none' for everything else",
          },
          nameEn: str(
            'Label in English: verb + object for tasks, a question for exclusive gateways',
          ),
          nameAr: str('Label in Arabic'),
          lane: str(
            'Id of the lane performing this node; empty string when there are no lanes',
            64,
          ),
          descriptionEn: str('What happens in this step (English); empty when obvious', 1000),
          descriptionAr: str('The same in Arabic; empty when obvious', 1000),
          systemEn: str('IT system used in this step (English name); empty when none'),
          systemAr: str('The IT system name in Arabic; empty when none'),
        },
      },
    },
    flows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'nameEn', 'nameAr'],
        properties: {
          from: str('Source node id', 64),
          to: str('Target node id', 64),
          nameEn: str(
            'Condition label for flows leaving an exclusive/inclusive gateway (e.g. "Approved"); otherwise empty',
          ),
          nameAr: str('The condition label in Arabic; otherwise empty'),
        },
      },
    },
  },
};

const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** Structural problems that would make an invalid or misleading BPMN diagram. */
export function structureIssues(s: ProcessStructure): string[] {
  const issues: string[] = [];
  const laneIds = new Set<string>();
  for (const l of s.lanes) {
    if (!ID_RE.test(l.id)) issues.push(`Lane id "${l.id}" is not a valid id`);
    if (laneIds.has(l.id)) issues.push(`Duplicate lane id "${l.id}"`);
    laneIds.add(l.id);
    if (!l.nameEn.trim() || !l.nameAr.trim())
      issues.push(`Lane "${l.id}" needs an English and an Arabic name`);
  }
  const nodes = new Map<string, StructureNode>();
  for (const n of s.nodes) {
    if (!ID_RE.test(n.id)) issues.push(`Node id "${n.id}" is not a valid id`);
    if (nodes.has(n.id) || laneIds.has(n.id)) issues.push(`Duplicate id "${n.id}"`);
    nodes.set(n.id, n);
    if (s.lanes.length && !laneIds.has(n.lane))
      issues.push(`Node "${n.id}" must be in one of the lanes (lane "${n.lane}" does not exist)`);
    if (!s.lanes.length && n.lane)
      issues.push(`Node "${n.id}" refers to lane "${n.lane}" but there are no lanes`);
    if (isActivity(n.type) && (!n.nameEn.trim() || !n.nameAr.trim()))
      issues.push(`Activity "${n.id}" needs an English and an Arabic label`);
  }
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const pairs = new Set<string>();
  for (const f of s.flows) {
    if (!nodes.has(f.from)) issues.push(`Flow source "${f.from}" does not exist`);
    if (!nodes.has(f.to)) issues.push(`Flow target "${f.to}" does not exist`);
    if (f.from === f.to) issues.push(`Flow from "${f.from}" to itself`);
    const key = `${f.from}->${f.to}`;
    if (pairs.has(key)) issues.push(`Duplicate flow ${key}`);
    pairs.add(key);
    incoming.set(f.to, (incoming.get(f.to) ?? 0) + 1);
    outgoing.set(f.from, [...(outgoing.get(f.from) ?? []), f.to]);
  }
  const starts = s.nodes.filter((n) => n.type === 'startEvent');
  if (!starts.length) issues.push('The process needs a start event');
  if (!s.nodes.some((n) => n.type === 'endEvent')) issues.push('The process needs an end event');
  for (const n of s.nodes) {
    const inc = incoming.get(n.id) ?? 0;
    const out = outgoing.get(n.id)?.length ?? 0;
    if (n.type === 'startEvent' && inc)
      issues.push(`Start event "${n.id}" cannot have incoming flows`);
    if (n.type === 'endEvent' && out) issues.push(`End event "${n.id}" cannot have outgoing flows`);
    if (n.type !== 'startEvent' && !inc) issues.push(`"${n.id}" has no incoming flow`);
    if (n.type !== 'endEvent' && !out) issues.push(`"${n.id}" has no outgoing flow`);
  }
  // Everything must be reachable from a start event.
  const seen = new Set<string>();
  const queue = starts.map((n) => n.id);
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...(outgoing.get(cur) ?? []));
  }
  for (const n of s.nodes)
    if (!seen.has(n.id) && starts.length)
      issues.push(`"${n.id}" cannot be reached from the start event`);
  return [...new Set(issues)];
}

/** Parser for structured output: shape (zod) and structure; issues go back to the model. */
export function parseStructure(value: unknown): ProcessStructure {
  const res = structureSchema.safeParse(value);
  if (!res.success) {
    throw new AiOutputInvalid(
      res.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const issues = structureIssues(res.data);
  if (issues.length) throw new AiOutputInvalid(issues);
  return res.data;
}
