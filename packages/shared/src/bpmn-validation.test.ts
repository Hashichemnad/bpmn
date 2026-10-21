import { describe, expect, it } from 'vitest';
import {
  extractBpmnElementIds,
  extractBpmnLabels,
  validateBpmnGraph,
  type BpmnGraphElement,
} from './bpmn-validation';

const el = (p: Partial<BpmnGraphElement> & { id: string; type: string }): BpmnGraphElement => ({
  incoming: 1,
  outgoing: 1,
  name: 'x',
  ...p,
});

describe('validateBpmnGraph', () => {
  it('returns nothing for an empty diagram', () => {
    expect(validateBpmnGraph([])).toEqual([]);
  });

  it('accepts a simple valid flow', () => {
    const issues = validateBpmnGraph([
      el({ id: 's', type: 'bpmn:StartEvent', incoming: 0 }),
      el({ id: 't', type: 'bpmn:Task' }),
      el({ id: 'e', type: 'bpmn:EndEvent', outgoing: 0 }),
    ]);
    expect(issues).toEqual([]);
  });

  it('warns about missing start and end events', () => {
    const codes = validateBpmnGraph([el({ id: 't', type: 'bpmn:Task' })]).map((i) => i.code);
    expect(codes).toContain('NO_START_EVENT');
    expect(codes).toContain('NO_END_EVENT');
  });

  it('flags unconnected and dangling elements', () => {
    const issues = validateBpmnGraph([
      el({ id: 's', type: 'bpmn:StartEvent', incoming: 0 }),
      el({ id: 'lonely', type: 'bpmn:Task', incoming: 0, outgoing: 0 }),
      el({ id: 'dead', type: 'bpmn:Task', outgoing: 0 }),
      el({ id: 'e', type: 'bpmn:EndEvent', outgoing: 0 }),
    ]);
    expect(issues).toContainEqual({
      code: 'UNCONNECTED_ELEMENT',
      severity: 'warning',
      elementId: 'lonely',
    });
    expect(issues).toContainEqual({
      code: 'MISSING_OUTGOING',
      severity: 'warning',
      elementId: 'dead',
    });
  });

  it('reports info-level hints', () => {
    const issues = validateBpmnGraph([
      el({ id: 's', type: 'bpmn:StartEvent', incoming: 0 }),
      el({ id: 't', type: 'bpmn:UserTask', name: '' }),
      el({ id: 'g', type: 'bpmn:ExclusiveGateway' }),
      el({ id: 'c', type: 'bpmn:CallActivity' }),
      el({ id: 'e', type: 'bpmn:EndEvent', outgoing: 0 }),
    ]);
    const codes = issues.map((i) => i.code);
    expect(codes).toEqual(['UNNAMED_ACTIVITY', 'GATEWAY_NOT_BRANCHING', 'CALL_ACTIVITY_UNLINKED']);
    expect(issues.every((i) => i.severity === 'info')).toBe(true);
  });

  it('ignores nested elements for start/end checks', () => {
    const codes = validateBpmnGraph([
      el({ id: 's', type: 'bpmn:StartEvent', incoming: 0 }),
      el({ id: 'e', type: 'bpmn:EndEvent', outgoing: 0, nested: true }),
    ]).map((i) => i.code);
    expect(codes).toContain('NO_END_EVENT');
  });
});

describe('extractBpmnElementIds', () => {
  it('collects id attributes', () => {
    const ids = extractBpmnElementIds('<a id="A"><b id="Task_1" name="x"/><c xid="no"/></a>');
    expect([...ids]).toEqual(['A', 'Task_1']);
  });
});

describe('extractBpmnLabels', () => {
  it('reads bilingual labels and decodes entities', () => {
    const xml = `<bpmn:definitions><bpmn:task id="T1" name="R&amp;D" ph:nameEn="R&amp;D review" ph:nameAr="مراجعة" /><bpmn:task id="T2" name="Plain" /><bpmn:process id="P1"></bpmn:process></bpmn:definitions>`;
    const labels = extractBpmnLabels(xml);
    expect(labels.get('T1')).toEqual({ name: 'R&D', nameEn: 'R&D review', nameAr: 'مراجعة' });
    expect(labels.get('T2')).toEqual({ name: 'Plain', nameEn: '', nameAr: '' });
    expect(labels.has('P1')).toBe(false);
  });
});
