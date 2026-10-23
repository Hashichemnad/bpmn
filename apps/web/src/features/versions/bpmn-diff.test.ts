import { describe, expect, it } from 'vitest';
import { diffBpmn } from './bpmn-diff';

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">${body}</bpmn:process>
</bpmn:definitions>`;

describe('diffBpmn', () => {
  it('reports added, removed and changed elements with bilingual names', async () => {
    const a = doc(
      '<bpmn:task id="T1" name="Review" ph:nameEn="Review" ph:nameAr="مراجعة" /><bpmn:task id="T2" name="Old" />',
    );
    const b = doc(
      '<bpmn:task id="T1" name="Approve" ph:nameEn="Approve" ph:nameAr="اعتماد" /><bpmn:userTask id="T3" name="Check budget" ph:nameEn="Check budget" />',
    );
    const changes = await diffBpmn(a, b);
    expect(changes.map((c) => [c.kind, c.id, c.type])).toEqual([
      ['added', 'T3', 'UserTask'],
      ['removed', 'T2', 'Task'],
      ['changed', 'T1', 'Task'],
    ]);
    const changed = changes[2];
    expect(changed).toMatchObject({ nameEn: 'Approve', nameAr: 'اعتماد' });
    expect(changed.attrs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', oldValue: 'Review', newValue: 'Approve' }),
      ]),
    );
    expect(changes[1]).toMatchObject({ nameEn: 'Old', nameAr: '' });
  });

  it('shows references by element id', async () => {
    const a = doc(
      '<bpmn:task id="A" /><bpmn:task id="B" /><bpmn:sequenceFlow id="F" sourceRef="A" targetRef="A" />',
    );
    const b = doc(
      '<bpmn:task id="A" /><bpmn:task id="B" /><bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B" />',
    );
    const flow = (await diffBpmn(a, b)).find((c) => c.id === 'F');
    expect(flow?.attrs).toEqual([{ name: 'targetRef', oldValue: 'A', newValue: 'B' }]);
  });

  it('returns nothing for identical models', async () => {
    const a = doc('<bpmn:task id="T1" name="x" />');
    expect(await diffBpmn(a, a)).toEqual([]);
  });
});

describe('diffBpmn colours', () => {
  it('reports a colour-only change (e.g. "Applied colour theme") as a diagram change', async () => {
    const { default: sample } =
      await import('../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw');
    const plain = sample.replace(/ (bioc|color):[a-z-]+="#[0-9A-Fa-f]{6}"/g, '');
    const changes = await diffBpmn(plain, sample);
    expect(changes).toHaveLength(35);
    expect(new Set(changes.map((c) => c.kind))).toEqual(new Set(['layout']));

    const recoloured = sample.replace(
      /(bpmnElement="Task_Quotations" bioc:fill=")#E8F1FB(" bioc:stroke=")#1F5FA8(" color:background-color=")#E8F1FB(" color:border-color=")#1F5FA8"/,
      '$1#F3E8FD$2#6B3FA0$3#F3E8FD$4#6B3FA0"',
    );
    expect(recoloured).not.toBe(sample);
    expect(await diffBpmn(sample, recoloured)).toMatchObject([
      { id: 'Task_Quotations', kind: 'layout' },
    ]);
  });
});
