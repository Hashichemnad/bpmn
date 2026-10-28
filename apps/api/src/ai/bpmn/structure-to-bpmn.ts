import {
  BPMN_BIOC_NS,
  BPMN_COLOR_NS,
  DEFAULT_DIAGRAM_THEME,
  isThemeColour,
  layoutStructure,
  themeColour,
  themeKindOf,
  type DiagramTheme,
} from '@processhub/shared';
import type { ProcessStructure, StructureNode } from './process-structure';

/** The layered layout lives in the shared package (also used by the modeler's auto-layout). */
export { flowLabelBounds, layoutStructure, type Bounds } from '@processhub/shared';

export const PH_NAMESPACE = 'http://processhub.io/schema/bpmn';

/** Attributes of existing elements the structure does not carry (kept when refining). */
export interface PreservedElement {
  linkedProcessId?: string;
  /** `ph:stepKind` of a user task (approval step marked in the element panel). */
  stepKind?: string;
  /** Colours of the shape; explicit (non-theme) colours are kept when refining. */
  fill?: string;
  stroke?: string;
}

export interface BuildOptions {
  /** Suffix for the process / collaboration ids. */
  key: string;
  preserve?: Map<string, PreservedElement>;
  /** Existing sequence-flow ids by "from->to", reused so comments and diffs stay stable. */
  flowIds?: Map<string, string>;
  /** Ids of the existing definitions / process / pool, kept so a refinement diffs cleanly. */
  containers?: ContainerIds;
  /** Colour theme for elements without explicit colours (Settings → Branding). */
  theme?: DiagramTheme;
}

export interface ContainerIds {
  definitions?: string;
  process?: string;
  collaboration?: string;
  participant?: string;
  laneSet?: string;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');

const labelAttrs = (en: string, ar: string) =>
  en || ar ? ` name="${esc(en || ar)}" ph:nameEn="${esc(en)}" ph:nameAr="${esc(ar)}"` : '';

function eventDefinitionXml(n: StructureNode, id: string): string {
  const def = n.eventDefinition;
  if (def === 'none' || !n.type.endsWith('Event')) return '';
  if (def === 'terminate' && n.type !== 'endEvent') return '';
  return `\n      <bpmn:${def}EventDefinition id="${id}_ed" />`;
}

/** BPMN 2.0 XML (semantic model + diagram interchange) with bilingual ph: labels. */
export function structureToBpmn(s: ProcessStructure, opts: BuildOptions): string {
  const layout = layoutStructure(s);
  const ids = {
    definitions: opts.containers?.definitions ?? `Definitions_${opts.key}`,
    process: opts.containers?.process ?? `Process_${opts.key}`,
    collaboration: opts.containers?.collaboration ?? `Collaboration_${opts.key}`,
    participant: opts.containers?.participant ?? `Participant_${opts.key}`,
    laneSet: opts.containers?.laneSet ?? `LaneSet_${opts.key}`,
  };
  const processId = ids.process;
  const flowIds = new Map<string, string>();
  const usedIds = new Set([
    ...s.nodes.map((n) => n.id),
    ...s.lanes.map((l) => l.id),
    ...Object.values(ids),
  ]);
  for (const [i, f] of s.flows.entries()) {
    const key = `${f.from}->${f.to}`;
    let id = opts.flowIds?.get(key);
    if (!id || usedIds.has(id)) id = `Flow_${i + 1}_${opts.key}`;
    usedIds.add(id);
    flowIds.set(key, id);
  }
  const fid = (f: { from: string; to: string }) => flowIds.get(`${f.from}->${f.to}`)!;

  const nodesXml = s.nodes
    .map((n) => {
      const refs = [
        ...s.flows
          .filter((f) => f.to === n.id)
          .map((f) => `\n      <bpmn:incoming>${fid(f)}</bpmn:incoming>`),
        ...s.flows
          .filter((f) => f.from === n.id)
          .map((f) => `\n      <bpmn:outgoing>${fid(f)}</bpmn:outgoing>`),
      ].join('');
      const keep = opts.preserve?.get(n.id);
      const link =
        keep?.linkedProcessId && (n.type === 'callActivity' || n.type === 'subProcess')
          ? ` ph:linkedProcessId="${esc(keep.linkedProcessId)}"`
          : '';
      const stepKind =
        keep?.stepKind && n.type === 'userTask' ? ` ph:stepKind="${esc(keep.stepKind)}"` : '';
      const desc =
        stepKind +
        (n.descriptionEn ? ` ph:descriptionEn="${esc(n.descriptionEn)}"` : '') +
        (n.descriptionAr ? ` ph:descriptionAr="${esc(n.descriptionAr)}"` : '');
      return `    <bpmn:${n.type} id="${n.id}"${labelAttrs(n.nameEn, n.nameAr)}${link}${desc}>${refs}${eventDefinitionXml(n, n.id)}\n    </bpmn:${n.type}>`;
    })
    .join('\n');
  const flowsXml = s.flows
    .map(
      (f) =>
        `    <bpmn:sequenceFlow id="${fid(f)}" sourceRef="${f.from}" targetRef="${f.to}"${labelAttrs(f.nameEn, f.nameAr)} />`,
    )
    .join('\n');
  const laneSetXml = s.lanes.length
    ? `    <bpmn:laneSet id="${ids.laneSet}">\n` +
      s.lanes
        .map(
          (l) =>
            `      <bpmn:lane id="${l.id}"${labelAttrs(l.nameEn, l.nameAr)}>\n` +
            s.nodes
              .filter((n) => n.lane === l.id)
              .map((n) => `        <bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`)
              .join('\n') +
            `\n      </bpmn:lane>`,
        )
        .join('\n') +
      `\n    </bpmn:laneSet>\n`
    : '';

  const theme = opts.theme ?? DEFAULT_DIAGRAM_THEME;
  /** Theme colour of the element, or its explicit colour from the refined diagram. */
  const colourAttrs = (
    id: string,
    info: Parameters<typeof themeKindOf>[0],
    laneIndex = 0,
  ): string => {
    const keep = opts.preserve?.get(id);
    let fill = keep?.fill;
    let stroke = keep?.stroke;
    if (!(fill || stroke) || isThemeColour(theme, fill, stroke)) {
      const kind = themeKindOf(info);
      if (!kind) return '';
      ({ fill, stroke } = themeColour(theme, kind, laneIndex));
    }
    return (
      (stroke ? ` bioc:stroke="${esc(stroke)}"` : '') +
      (fill ? ` bioc:fill="${esc(fill)}"` : '') +
      (fill ? ` color:background-color="${esc(fill)}"` : '') +
      (stroke ? ` color:border-color="${esc(stroke)}"` : '')
    );
  };
  const nodeColours = (n: StructureNode) =>
    colourAttrs(n.id, {
      type: n.type,
      nameEn: n.nameEn,
      stepKind: opts.preserve?.get(n.id)?.stepKind,
      eventDefinitions: n.eventDefinition === 'none' ? [] : [n.eventDefinition],
    });
  const shape = (id: string, b: { x: number; y: number; w: number; h: number }, extra = '') =>
    `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`;
  const pooled = s.lanes.length > 0;
  const participantId = ids.participant;
  const shapes = [
    ...(pooled ? [shape(participantId, layout.pool, ' isHorizontal="true"')] : []),
    ...layout.lanes.map((l, i) =>
      shape(l.lane.id, l, `${colourAttrs(l.lane.id, { type: 'lane' }, i)} isHorizontal="true"`),
    ),
    ...[...layout.placed.values()].map((p) =>
      shape(
        p.node.id,
        p,
        nodeColours(p.node) + (p.node.type === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''),
      ),
    ),
  ].join('\n');
  const edges = layout.edges
    .map(
      (e) =>
        `      <bpmndi:BPMNEdge id="${fid(e.flow)}_di" bpmnElement="${fid(e.flow)}">\n` +
        e.points.map((p) => `        <di:waypoint x="${p.x}" y="${p.y}" />`).join('\n') +
        (e.label
          ? `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${e.label.x}" y="${e.label.y}" width="${e.label.w}" height="${e.label.h}" />\n        </bpmndi:BPMNLabel>`
          : '') +
        `\n      </bpmndi:BPMNEdge>`,
    )
    .join('\n');
  const collaboration = pooled
    ? `  <bpmn:collaboration id="${ids.collaboration}">\n    <bpmn:participant id="${participantId}"${labelAttrs(s.nameEn, s.nameAr)} processRef="${processId}" />\n  </bpmn:collaboration>\n`
    : '';
  const planeElement = pooled ? ids.collaboration : processId;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="${BPMN_BIOC_NS}" xmlns:color="${BPMN_COLOR_NS}" xmlns:ph="${PH_NAMESPACE}" id="${ids.definitions}" targetNamespace="http://bpmn.io/schema/bpmn">
${collaboration}  <bpmn:process id="${processId}" isExecutable="false">
${laneSetXml}${nodesXml}
${flowsXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${opts.key}">
    <bpmndi:BPMNPlane id="Plane_${opts.key}" bpmnElement="${planeElement}">
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
