import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installSvgGeometry } from '@/test/svg-geometry';
import sample from '../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw';
import type { BpmnInstance, ElementRegistry, EventBus, Selection } from './bpmn-types';
import { createDiagram, importDiagram } from './create-diagram';
import { keepSelectionModule } from './keep-selection';

let instance: BpmnInstance | null = null;
beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe('keepSelectionModule', () => {
  it('keeps a single selected shape selected on a plain click; Shift+click still toggles', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    instance = createDiagram('modeler', { container, additionalModules: [keepSelectionModule] });
    await importDiagram(instance, sample);
    const task = instance.get<ElementRegistry>('elementRegistry').get('Task_Screening')!;
    const selection = instance.get<Selection>('selection');
    const click = (init: MouseEventInit = {}) =>
      instance!
        .get<EventBus>('eventBus')
        .fire('element.click', { element: task, originalEvent: new MouseEvent('click', init) });
    click();
    expect(selection.get()).toEqual([task]);
    click();
    expect(selection.get()).toEqual([task]);
    click({ shiftKey: true });
    expect(selection.get()).toEqual([]);
  });
});
