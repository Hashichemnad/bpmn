import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { installSvgGeometry } from '@/test/svg-geometry';
import sample from '../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw';
import type { BpmnInstance, DiagramElement, ElementRegistry, Modeling } from './bpmn-types';
import { colourPickerModule, pickerColours } from './color-picker';
import { createDiagram, importDiagram } from './create-diagram';
import { applyLanguage, bilingualModule, exportXml, normaliseDiagram } from './diagram';
import { themeModule } from './theme';
import { translateModule } from './translate';

/**
 * Round trip of the real DOF sample (docs/samples) through the full modeler stack used in the
 * app (bpmn-js Modeler + ProcessHub renderer, bilingual labels, theme, colour picker):
 * import → Arabic → save → reload → save. Colours and ph: attributes must survive unchanged.
 */

const PH = 'http://processhub.io/schema/bpmn';
const COLOR = 'http://www.omg.org/spec/BPMN/non-normative/color/1.0';
const BIOC = 'http://bpmn.io/schema/bpmn/biocolor/1.0';
const DI = 'http://www.omg.org/spec/BPMN/20100524/DI';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

/** Element id → "fill/stroke (bioc fill/stroke)", upper-case hex. */
function colours(xml: string) {
  const out: Record<string, string> = {};
  for (const s of Array.from(parse(xml).getElementsByTagNameNS(DI, 'BPMNShape'))) {
    const v = (ns: string, n: string) => (s.getAttributeNS(ns, n) ?? '').toUpperCase();
    const fill = v(COLOR, 'background-color');
    const stroke = v(COLOR, 'border-color');
    if (fill || stroke)
      out[s.getAttribute('bpmnElement')!] =
        `${fill}/${stroke} (${v(BIOC, 'fill')}/${v(BIOC, 'stroke')})`;
  }
  return out;
}

/** Element id → every ph: attribute. */
function phAttributes(xml: string) {
  const out: Record<string, Record<string, string>> = {};
  for (const el of Array.from(parse(xml).getElementsByTagName('*'))) {
    const attrs = Array.from(el.attributes).filter((a) => a.namespaceURI === PH);
    if (attrs.length)
      out[el.getAttribute('id')!] = Object.fromEntries(attrs.map((a) => [a.localName, a.value]));
  }
  return out;
}

let instance: BpmnInstance | null = null;

function modeler() {
  const container = document.createElement('div');
  document.body.append(container);
  const state = { locale: 'en' as 'en' | 'ar' };
  instance = createDiagram('modeler', {
    container,
    additionalModules: [
      translateModule(state),
      bilingualModule(state),
      themeModule({ theme: DEFAULT_DIAGRAM_THEME }),
      colourPickerModule(),
    ],
    config: { colorPicker: { colors: pickerColours(DEFAULT_DIAGRAM_THEME) } },
  });
  return { m: instance, container, state };
}

beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('PMS-01 sample round trip', () => {
  it('keeps every colour and ph: attribute through import → Arabic → save → reload → save', async () => {
    const expectedColours = colours(sample);
    const expectedPh = phAttributes(sample);
    // 27 flow nodes + 8 lanes carry colours; 54 elements carry bilingual labels.
    expect(Object.keys(expectedColours)).toHaveLength(35);
    expect(Object.values(expectedPh).filter((a) => a.nameAr)).toHaveLength(54);

    const { m, container, state } = modeler();
    await importDiagram(m, sample);
    normaliseDiagram(m);
    state.locale = 'ar';
    applyLanguage(m, 'ar');
    const registry = m.get<ElementRegistry>('elementRegistry');
    expect(registry.get('Task_CreateRequest')!.businessObject.name).toBe(
      'إنشاء طلب البرنامج (مسودة)',
    );

    // Rendered with the stored colours, Arabic labels right-to-left.
    const body = container.querySelector<SVGElement>(
      '[data-element-id="Task_SMReview"] .djs-visual > .ph-body',
    )!;
    expect(body.style.fill).toMatch(/^(#fbf3e0|rgb\(251, 243, 224\))$/i);
    expect(
      container.querySelector('[data-element-id="Task_SMReview"] .ph-task-icon'),
    ).not.toBeNull();
    const label = container.querySelector('[data-element-id="Task_SMReview"] text.djs-label')!;
    expect(label.getAttribute('direction')).toBe('rtl');

    const saved = await exportXml(m, 'ar');
    expect(colours(saved)).toEqual(expectedColours);
    expect(phAttributes(saved)).toEqual(expectedPh);
    // Interoperable `name` is English after saving, whatever language is shown.
    expect(saved).toContain('name="Review request (Section Manager)"');

    // Reload the saved XML and save again: stable.
    await importDiagram(m, saved);
    normaliseDiagram(m);
    applyLanguage(m, 'en');
    const again = await exportXml(m, 'en');
    expect(colours(again)).toEqual(expectedColours);
    expect(phAttributes(again)).toEqual(expectedPh);

    // The SVG export carries the colours.
    const { svg } = await m.saveSVG();
    expect(svg).toMatch(/fill: (#fbf3e0|rgb\(251, 243, 224\))/i);
    expect(svg).toMatch(/stroke: (#8a6d1e|rgb\(138, 109, 30\))/i);
  });
});

describe('theme in the modeler', () => {
  const create = (m: BpmnInstance, type: string, x: number, y: number) => {
    const factory = m.get<{ createShape(a: { type: string }): DiagramElement }>('elementFactory');
    const root = m.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    return (
      m.get<Modeling>('modeling') as unknown as {
        createShape(
          s: DiagramElement,
          p: { x: number; y: number },
          parent: DiagramElement,
        ): DiagramElement;
      }
    ).createShape(factory.createShape({ type }), { x, y }, root);
  };
  const di = (el: DiagramElement) =>
    (el as unknown as { di: { get(n: string): string | undefined } }).di;
  const colourOf = (el: DiagramElement) =>
    `${di(el).get('color:background-color')}/${di(el).get('color:border-color')}`.toUpperCase();
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="D" targetNamespace="x">
<bpmn:process id="P" /><bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="P" /></bpmndi:BPMNDiagram></bpmn:definitions>`;

  it('colours new elements, follows type and approval changes, keeps explicit colours', async () => {
    const t = DEFAULT_DIAGRAM_THEME;
    const pair = (c: { fill: string; stroke: string }) => `${c.fill}/${c.stroke}`;
    const { m } = modeler();
    await importDiagram(m, empty);
    const modeling = m.get<Modeling & { setColor(e: DiagramElement[], c: object): void }>(
      'modeling',
    );
    const replace = m.get<{
      replaceElement(e: DiagramElement, t: { type: string }): DiagramElement;
    }>('bpmnReplace');

    const start = create(m, 'bpmn:StartEvent', 100, 100);
    expect(colourOf(start)).toBe(pair(t.start));
    const gw = create(m, 'bpmn:ExclusiveGateway', 300, 100);
    expect(colourOf(gw)).toBe(pair(t.gateway));

    let task = create(m, 'bpmn:UserTask', 200, 300);
    expect(colourOf(task)).toBe(pair(t.humanTask));
    // Approval by label (English), then back.
    modeling.updateModdleProperties(task, task.businessObject, { 'ph:nameEn': 'Approve budget' });
    expect(colourOf(task)).toBe(pair(t.approvalTask));
    modeling.updateModdleProperties(task, task.businessObject, { 'ph:stepKind': 'task' });
    expect(colourOf(task)).toBe(pair(t.humanTask));
    // Type change recolours theme colours …
    task = replace.replaceElement(task, { type: 'bpmn:ServiceTask' });
    expect(colourOf(task)).toBe(pair(t.systemTask));
    // … but never explicit ones.
    modeling.setColor([task], { fill: '#123456', stroke: '#654321' });
    task = replace.replaceElement(task, { type: 'bpmn:UserTask' });
    expect(colourOf(task)).toBe('#123456/#654321');
    modeling.updateModdleProperties(task, task.businessObject, { 'ph:stepKind': 'approval' });
    expect(colourOf(task)).toBe('#123456/#654321');

    // An element without colours (e.g. from an older diagram) is not coloured by edits.
    modeling.setColor([gw], { fill: undefined, stroke: undefined });
    modeling.updateModdleProperties(gw, gw.businessObject, { 'ph:nameEn': 'Approved?' });
    expect(colourOf(gw)).toBe('UNDEFINED/UNDEFINED');

    // Undo restores the previous colours in one step with the edit.
    const stack = m.get<{ undo(): void }>('commandStack');
    stack.undo();
    stack.undo();
    expect(colourOf(gw)).toBe(pair(t.gateway));
  });
});
