import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_THEME, layoutStructure, type LayoutInput } from '@processhub/shared';
import { installSvgGeometry } from '@/test/svg-geometry';
import type { BpmnInstance, Canvas, CommandStack, ElementRegistry } from './bpmn-types';
import { autoLayoutModule, runAutoLayout } from './auto-layout';
import { renderBadges } from './badges';
import { createDiagram, importDiagram } from './create-diagram';
import { applyLanguage, bilingualModule, normaliseDiagram } from './diagram';
import { MinimapModule } from './minimap';
import { themeModule } from './theme';
import { translateModule } from './translate';
import { fitPage, fitWidth, zoomBy } from './view';

/**
 * A synthetic process with `n` steps in 8 lanes (gateways with a second branch, loops), laid out
 * with the shared layout and written as BPMN XML with bilingual labels.
 */
export function syntheticDiagram(n: number): string {
  const lanes = Array.from({ length: 8 }, (_, i) => ({ id: `Lane_${i}` }));
  const type = (i: number) =>
    i % 7 === 6 ? 'exclusiveGateway' : i % 5 === 4 ? 'serviceTask' : 'userTask';
  const input: LayoutInput = {
    lanes,
    nodes: [
      { id: 'Start', type: 'startEvent', lane: 'Lane_0' },
      ...Array.from({ length: n }, (_, i) => ({
        id: `N${i}`,
        type: type(i),
        lane: `Lane_${Math.floor(i / 4) % 8}`,
      })),
      { id: 'End', type: 'endEvent', lane: 'Lane_7' },
    ],
    flows: [
      { from: 'Start', to: 'N0' },
      ...Array.from({ length: n - 1 }, (_, i) => ({ from: `N${i}`, to: `N${i + 1}` })),
      ...Array.from({ length: n }, (_, i) => i)
        .filter((i) => type(i) === 'exclusiveGateway' && i + 3 < n)
        .map((i) => ({ from: `N${i}`, to: `N${i + 3}`, nameEn: 'No' })),
      { from: `N${n - 1}`, to: 'End' },
    ],
  };
  const { placed, edges, lanes: bands, pool } = layoutStructure(input);
  const name = (id: string) => ` name="Step ${id}" ph:nameEn="Step ${id}" ph:nameAr="خطوة ${id}"`;
  const nodes = [...placed.values()]
    .map((p) => `<bpmn:${p.node.type} id="${p.node.id}"${name(p.node.id)} />`)
    .join('');
  const flows = edges
    .map(
      (e, i) =>
        `<bpmn:sequenceFlow id="F${i}" sourceRef="${e.flow.from}" targetRef="${e.flow.to}" />`,
    )
    .join('');
  const laneSet = bands
    .map(
      (b) =>
        `<bpmn:lane id="${b.lane.id}"${name(b.lane.id)}>${[...placed.values()]
          .filter((p) => p.lane === b.lane.id)
          .map((p) => `<bpmn:flowNodeRef>${p.node.id}</bpmn:flowNodeRef>`)
          .join('')}</bpmn:lane>`,
    )
    .join('');
  const bounds = (b: { x: number; y: number; w: number; h: number }) =>
    `<dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />`;
  const shapes = [
    `<bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true">${bounds(pool)}</bpmndi:BPMNShape>`,
    ...bands.map(
      (b) =>
        `<bpmndi:BPMNShape id="${b.lane.id}_di" bpmnElement="${b.lane.id}" isHorizontal="true">${bounds(b)}</bpmndi:BPMNShape>`,
    ),
    ...[...placed.values()].map(
      (p) =>
        `<bpmndi:BPMNShape id="${p.node.id}_di" bpmnElement="${p.node.id}">${bounds(p)}</bpmndi:BPMNShape>`,
    ),
    ...edges.map(
      (e, i) =>
        `<bpmndi:BPMNEdge id="F${i}_di" bpmnElement="F${i}">${e.points
          .map((pt) => `<di:waypoint x="${pt.x}" y="${pt.y}" />`)
          .join('')}</bpmndi:BPMNEdge>`,
    ),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:ph="http://processhub.io/schema/bpmn" id="D" targetNamespace="x">
<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P"${name('Pool')} /></bpmn:collaboration>
<bpmn:process id="P"><bpmn:laneSet id="LS">${laneSet}</bpmn:laneSet>${nodes}${flows}</bpmn:process>
<bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="C">${shapes}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}

let instance: BpmnInstance | null = null;
beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

const time = async (fn: () => unknown) => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

/**
 * 200+ elements through the full workspace stack (renderer, theme, mini-map, badges, auto-layout).
 * jsdom has no real rendering, so the limits are generous regression guards; the browser numbers
 * are in docs/PROGRESS.md.
 */
describe('modeler performance with a large diagram', () => {
  it('imports, zooms, badges and auto-layouts 250 steps (≈ 520 elements) in time', async () => {
    const xml = syntheticDiagram(250);
    const container = document.createElement('div');
    document.body.append(container);
    const state = { locale: 'en' as const };
    instance = createDiagram('modeler', {
      container,
      additionalModules: [
        translateModule(state),
        bilingualModule(state),
        themeModule({ theme: DEFAULT_DIAGRAM_THEME }),
        MinimapModule,
        autoLayoutModule,
      ],
      config: { minimap: { open: true } },
    });
    const m = instance;
    const importMs = await time(async () => {
      await importDiagram(m, xml);
      normaliseDiagram(m);
      applyLanguage(m, 'ar');
    });
    const registry = m.get<ElementRegistry>('elementRegistry');
    expect(registry.getAll().length).toBeGreaterThan(500);
    expect(importMs).toBeLessThan(15000);

    const canvas = m.get<Canvas>('canvas');
    const zoomMs = await time(() => {
      for (let i = 0; i < 10; i++) zoomBy(canvas, i % 2 ? 1.2 : 1 / 1.2);
      fitWidth(canvas);
      fitPage(canvas);
    });
    expect(zoomMs).toBeLessThan(3000);

    const badgeMs = await time(() =>
      renderBadges(
        m,
        registry
          .filter((e) => e.type === 'bpmn:UserTask')
          .map((e) => ({ elementId: e.id, kind: 'ROLE' as const, name: 'Requester' })),
        { title: (k, names) => `${k} ${names.length}` },
      ),
    );
    expect(badgeMs).toBeLessThan(3000);

    const layoutMs = await time(() => expect(runAutoLayout(m)).toBeNull());
    expect(layoutMs).toBeLessThan(10000);
    const undoMs = await time(() => m.get<CommandStack>('commandStack').undo());
    expect(undoMs).toBeLessThan(10000);
    console.warn(
      `250 steps: import ${importMs.toFixed(0)} ms, 12 zooms ${zoomMs.toFixed(0)} ms, badges ${badgeMs.toFixed(0)} ms, auto-layout ${layoutMs.toFixed(0)} ms, undo ${undoMs.toFixed(0)} ms (jsdom)`,
    );
  }, 60000);
});
