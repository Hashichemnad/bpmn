import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_THEME, isFlowNode } from '@processhub/shared';
import { installSvgGeometry } from '@/test/svg-geometry';
import sample from '../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw';
import type { BpmnInstance, CommandStack, DiagramElement, ElementRegistry } from './bpmn-types';
import { autoLayoutModule, runAutoLayout } from './auto-layout';
import { createDiagram, importDiagram } from './create-diagram';
import { bilingualModule, exportXml, normaliseDiagram } from './diagram';
import { themeModule } from './theme';
import { translateModule } from './translate';

type Box = DiagramElement & { x: number; y: number; width: number; height: number };

let instance: BpmnInstance | null = null;

async function load(xml = sample) {
  const container = document.createElement('div');
  document.body.append(container);
  const state = { locale: 'en' as const };
  instance = createDiagram('modeler', {
    container,
    additionalModules: [
      translateModule(state),
      bilingualModule(state),
      themeModule({ theme: DEFAULT_DIAGRAM_THEME }),
      autoLayoutModule,
    ],
  });
  await importDiagram(instance, xml);
  normaliseDiagram(instance);
  return instance;
}

/** Geometry of every shape and connection: id → "x,y,w,h" or the waypoint list. */
function geometry(m: BpmnInstance) {
  const out: Record<string, string> = {};
  for (const el of m.get<ElementRegistry>('elementRegistry').getAll()) {
    const e = el as Box & { waypoints?: { x: number; y: number }[] };
    out[el.id] = e.waypoints
      ? e.waypoints.map((p) => `${p.x},${p.y}`).join(' ')
      : `${e.x},${e.y},${e.width},${e.height}`;
  }
  return out;
}

/** Everything but the diagram geometry (DI bounds, label positions, waypoints) of the saved XML. */
const semantic = (xml: string) =>
  xml
    .replace(/<dc:Bounds [^>]*\/>/g, '')
    .replace(/<di:waypoint [^>]*\/>/g, '')
    .replace(/<bpmndi:BPMNLabel>\s*<\/bpmndi:BPMNLabel>/g, '')
    .replace(/\s+/g, ' ');

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('auto-layout command', () => {
  it('re-arranges PMS-01 without overlaps, keeping ids, labels, colours and step kinds', async () => {
    const m = await load();
    const before = await exportXml(m, 'en');
    expect(runAutoLayout(m)).toBeNull();
    const after = await exportXml(m, 'en');
    expect(semantic(after)).toBe(semantic(before));

    const registry = m.get<ElementRegistry>('elementRegistry');
    const nodes = registry.filter((e) => isFlowNode(e.type)) as Box[];
    expect(nodes).toHaveLength(27);
    for (const [i, a] of nodes.entries())
      for (const b of nodes.slice(i + 1)) expect(overlaps(a, b), `${a.id} / ${b.id}`).toBe(false);
    // Every node stays inside its own lane.
    for (const lane of registry.filter((e) => e.type === 'bpmn:Lane') as Box[]) {
      const refs = (lane.businessObject as unknown as { flowNodeRef?: { id: string }[] })
        .flowNodeRef;
      for (const ref of refs ?? []) {
        const n = registry.get(ref.id) as Box;
        expect(n.y).toBeGreaterThanOrEqual(lane.y);
        expect(n.y + n.height).toBeLessThanOrEqual(lane.y + lane.height);
      }
    }
  });

  it('is one undo step: undo restores every bound and waypoint, redo applies it again', async () => {
    const m = await load();
    const original = geometry(m);
    runAutoLayout(m);
    const laidOut = geometry(m);
    expect(laidOut).not.toEqual(original);
    const stack = m.get<CommandStack>('commandStack');
    stack.undo();
    expect(geometry(m)).toEqual(original);
    expect(stack.canUndo()).toBe(false);
    stack.redo();
    expect(geometry(m)).toEqual(laidOut);
  });

  it('refuses diagrams with several pools', async () => {
    const twoPools = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="x">
<bpmn:collaboration id="C"><bpmn:participant id="P1" processRef="A" /><bpmn:participant id="P2" processRef="B" /></bpmn:collaboration>
<bpmn:process id="A"><bpmn:startEvent id="S1" /></bpmn:process><bpmn:process id="B"><bpmn:startEvent id="S2" /></bpmn:process>
<bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="C">
<bpmndi:BPMNShape id="P1_di" bpmnElement="P1" isHorizontal="true"><dc:Bounds x="0" y="0" width="600" height="200" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="P2_di" bpmnElement="P2" isHorizontal="true"><dc:Bounds x="0" y="300" width="600" height="200" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="S1_di" bpmnElement="S1"><dc:Bounds x="100" y="80" width="36" height="36" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="S2_di" bpmnElement="S2"><dc:Bounds x="100" y="380" width="36" height="36" /></bpmndi:BPMNShape>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
    const m = await load(twoPools);
    expect(runAutoLayout(m)).toBe('SEVERAL_POOLS');
    expect(m.get<CommandStack>('commandStack').canUndo()).toBe(false);
  });
});

describe('keyboard binding scope', () => {
  const press = (target: EventTarget, key: string, ctrl = false) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true }),
    );

  it('handles shortcuts on the canvas only, never while typing in a field', async () => {
    const m = await load();
    const registry = m.get<ElementRegistry>('elementRegistry');
    const task = registry.get('Task_Screening')!;
    m.get<{ select(e: DiagramElement): void }>('selection').select(task);

    // Typing in a field of the page (e.g. the properties panel) does not reach the modeler.
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    press(input, 'Delete');
    press(document, 'Delete');
    press(input, 'z', true);
    expect(registry.get('Task_Screening')).toBeDefined();

    // On the canvas: delete, then undo with Ctrl+Z.
    const svg = document.querySelector('svg[tabindex]')!;
    press(svg, 'Delete');
    expect(registry.get('Task_Screening')).toBeUndefined();
    press(svg, 'z', true);
    expect(registry.get('Task_Screening')).toBeDefined();
  });
});
