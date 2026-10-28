import { JSDOM } from 'jsdom';
import {
  BPMN_BIOC_NS,
  BPMN_COLOR_NS,
  validateBpmnGraph,
  type BpmnGraphElement,
} from '@processhub/shared';
import { assertSafeBpmnXml } from '../../models/bpmn-xml';
import { AiError } from '../providers/types';
import {
  EVENT_DEFINITIONS,
  NODE_TYPES,
  type EventDefinition,
  type NodeType,
  type ProcessStructure,
  type StructureNode,
} from './process-structure';
import type { ContainerIds, PreservedElement } from './structure-to-bpmn';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
const PH_NS = 'http://processhub.io/schema/bpmn';

export interface ReadBpmn {
  structure: ProcessStructure;
  preserve: Map<string, PreservedElement>;
  flowIds: Map<string, string>;
  /** Graph for the shared validation rules (validateBpmnGraph). */
  graph: BpmnGraphElement[];
  /** Elements the structure cannot carry (boundary events, data objects, annotations, …). */
  dropped: number;
  containers: ContainerIds;
}

let dom: JSDOM | null = null;
const parser = () => new (dom ??= new JSDOM('')).window.DOMParser();

const ph = (el: Element, name: string) => el.getAttributeNS(PH_NS, name) ?? '';
const pascal = (t: string) => `bpmn:${t[0].toUpperCase()}${t.slice(1)}`;

/**
 * Reads BPMN XML (as saved by the modeler or produced by the assistant) into the structured form.
 * Throws INVALID_BPMN-style AiErrors for XML that does not parse. Message flows, data objects,
 * annotations and the content of expanded sub-processes are not part of the structure.
 */
export function readBpmn(xml: string): ReadBpmn {
  assertSafeBpmnXml(xml);
  const doc = parser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new AiError('AI_INVALID_OUTPUT', 'The BPMN XML is not well-formed');
  }
  const processes = Array.from(doc.getElementsByTagNameNS(BPMN_NS, 'process'));
  const participants = Array.from(doc.getElementsByTagNameNS(BPMN_NS, 'participant'));
  const first = participants[0] ?? processes[0];

  const structure: ProcessStructure = {
    nameEn: first ? ph(first, 'nameEn') || (first.getAttribute('name') ?? '') : '',
    nameAr: first ? ph(first, 'nameAr') : '',
    descriptionEn: '',
    descriptionAr: '',
    explanation: '',
    lanes: [],
    nodes: [],
    flows: [],
  };
  const preserve = new Map<string, PreservedElement>();
  const flowIds = new Map<string, string>();
  const graph: BpmnGraphElement[] = [];
  const laneOf = new Map<string, string>();
  let dropped = 0;
  /** Children of a process that are containers or connectors, not lost content. */
  const STRUCTURAL = new Set(['laneSet', 'extensionElements', 'documentation', 'association']);

  for (const proc of processes) {
    for (const lane of Array.from(proc.getElementsByTagNameNS(BPMN_NS, 'lane'))) {
      // Only leaf lanes hold nodes in the structure.
      if (lane.getElementsByTagNameNS(BPMN_NS, 'lane').length) continue;
      const id = lane.getAttribute('id') ?? '';
      structure.lanes.push({
        id,
        nameEn: ph(lane, 'nameEn') || (lane.getAttribute('name') ?? ''),
        nameAr: ph(lane, 'nameAr'),
      });
      const roleId = ph(lane, 'roleId');
      if (roleId) preserve.set(id, { ...preserve.get(id), roleId });
      for (const ref of Array.from(lane.getElementsByTagNameNS(BPMN_NS, 'flowNodeRef')))
        laneOf.set((ref.textContent ?? '').trim(), id);
    }
    for (const el of Array.from(proc.children)) {
      if (el.namespaceURI !== BPMN_NS) continue;
      const id = el.getAttribute('id') ?? '';
      if (el.localName === 'sequenceFlow') {
        const from = el.getAttribute('sourceRef') ?? '';
        const to = el.getAttribute('targetRef') ?? '';
        structure.flows.push({
          from,
          to,
          nameEn: ph(el, 'nameEn') || (el.getAttribute('name') ?? ''),
          nameAr: ph(el, 'nameAr'),
        });
        flowIds.set(`${from}->${to}`, id);
        continue;
      }
      if (!(NODE_TYPES as readonly string[]).includes(el.localName)) {
        if (!STRUCTURAL.has(el.localName)) dropped++;
        continue;
      }
      const type = el.localName as NodeType;
      // The content of an expanded sub-process is not part of the structure.
      if (type === 'subProcess')
        dropped += Array.from(el.children).filter(
          (c) =>
            c.namespaceURI === BPMN_NS && (NODE_TYPES as readonly string[]).includes(c.localName),
        ).length;
      const defEl = Array.from(el.children).find((c) => c.localName.endsWith('EventDefinition'));
      const defName = defEl?.localName.replace('EventDefinition', '') ?? 'none';
      const node: StructureNode = {
        id,
        type,
        eventDefinition: (EVENT_DEFINITIONS as readonly string[]).includes(defName)
          ? (defName as EventDefinition)
          : 'none',
        nameEn: ph(el, 'nameEn') || (ph(el, 'nameAr') ? '' : (el.getAttribute('name') ?? '')),
        nameAr: ph(el, 'nameAr'),
        lane: '',
        descriptionEn: ph(el, 'descriptionEn'),
        descriptionAr: ph(el, 'descriptionAr'),
        systemEn: '',
        systemAr: '',
      };
      structure.nodes.push(node);
      const linked = ph(el, 'linkedProcessId');
      if (linked) preserve.set(id, { linkedProcessId: linked });
      const stepKind = ph(el, 'stepKind');
      if (stepKind) preserve.set(id, { ...preserve.get(id), stepKind });
      const children = Array.from(el.children);
      graph.push({
        id,
        type: pascal(type),
        name: node.nameEn || node.nameAr,
        incoming: children.filter((c) => c.localName === 'incoming').length,
        outgoing: children.filter((c) => c.localName === 'outgoing').length,
        linkedProcessId: linked || null,
      });
    }
  }
  for (const n of structure.nodes) n.lane = laneOf.get(n.id) ?? '';
  // Nodes outside every lane of a laned process: keep them in the first lane.
  if (structure.lanes.length)
    for (const n of structure.nodes) if (!n.lane) n.lane = structure.lanes[0].id;
  // Incoming/outgoing counts from the flows (some tools omit the child references).
  for (const g of graph) {
    g.incoming = Math.max(g.incoming, structure.flows.filter((f) => f.to === g.id).length);
    g.outgoing = Math.max(g.outgoing, structure.flows.filter((f) => f.from === g.id).length);
  }
  dropped += doc.getElementsByTagNameNS(BPMN_NS, 'messageFlow').length;
  // Colours of shapes (BPMN-in-Color first, then bpmn.io), kept when the diagram is rebuilt.
  for (const shape of Array.from(doc.getElementsByTagNameNS(BPMNDI_NS, 'BPMNShape'))) {
    const id = shape.getAttribute('bpmnElement') ?? '';
    const fill =
      shape.getAttributeNS(BPMN_COLOR_NS, 'background-color') ||
      shape.getAttributeNS(BPMN_BIOC_NS, 'fill');
    const stroke =
      shape.getAttributeNS(BPMN_COLOR_NS, 'border-color') ||
      shape.getAttributeNS(BPMN_BIOC_NS, 'stroke');
    if (fill || stroke)
      preserve.set(id, {
        ...preserve.get(id),
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
      });
  }
  const idOf = (el: Element | undefined) => el?.getAttribute('id') || undefined;
  const containers: ContainerIds = {
    definitions: idOf(doc.documentElement),
    process: idOf(processes[0]),
    collaboration: idOf(doc.getElementsByTagNameNS(BPMN_NS, 'collaboration')[0]),
    participant: idOf(participants[0]),
    laneSet: idOf(processes[0]?.getElementsByTagNameNS(BPMN_NS, 'laneSet')[0]),
  };
  return { structure, preserve, flowIds, graph, dropped, containers };
}

/** Validation codes (shared rules) of a diagram, e.g. for the warnings shown with a preview. */
export function bpmnWarnings(xml: string): string[] {
  return [...new Set(validateBpmnGraph(readBpmn(xml).graph).map((i) => i.code))];
}
