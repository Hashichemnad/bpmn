import { renameLabelRefs } from './label-ref-xml';

const ID = '5b1d7a52-6c1e-4c7f-9a33-2f8f3d0e9a11';
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">
    <bpmn:userTask id="T1" name="Program request" ph:nameEn="Program request" ph:nameAr="طلب برنامج" ph:labelRef="${ID}" />
    <bpmn:task id="T2" name="Other" ph:nameEn="Other" />
    <bpmn:task id="T3" name="Initiative request" ph:nameEn="Initiative request" ph:nameAr="طلب مبادرة" ph:labelRef="${ID}" />
  </bpmn:process>
</bpmn:definitions>`;

describe('renameLabelRefs', () => {
  it('updates both labels and name of linked elements only', () => {
    const r = renameLabelRefs(xml, ID, { nameEn: 'Initiative request', nameAr: 'طلب مبادرة' });
    expect(r.elements).toEqual([
      {
        elementId: 'T1',
        before: { nameEn: 'Program request', nameAr: 'طلب برنامج' },
        after: { nameEn: 'Initiative request', nameAr: 'طلب مبادرة' },
      },
    ]);
    expect(r.xml).toContain('id="T1" name="Initiative request" ph:nameEn="Initiative request"');
    expect(r.xml).toContain('ph:nameAr="طلب مبادرة"');
    expect(r.xml).toContain('id="T2" name="Other"');
  });

  it('fills a missing language from the other one', () => {
    const r = renameLabelRefs(xml, ID, { nameEn: '', nameAr: 'طلب' });
    expect(r.elements.map((e) => e.after)).toEqual([
      { nameEn: 'طلب', nameAr: 'طلب' },
      { nameEn: 'طلب', nameAr: 'طلب' },
    ]);
  });

  it('returns the same string when nothing changes or the XML is broken', () => {
    expect(renameLabelRefs(xml, 'other-id', { nameEn: 'x', nameAr: 'y' }).xml).toBe(xml);
    expect(renameLabelRefs('<broken', ID, { nameEn: 'x', nameAr: 'y' })).toEqual({
      xml: '<broken',
      elements: [],
    });
  });
});
