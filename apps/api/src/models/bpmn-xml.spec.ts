import { assertSafeBpmnXml } from './bpmn-xml';

const valid = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1"><bpmn:process id="P1"/></bpmn:definitions>`;

describe('assertSafeBpmnXml', () => {
  it('accepts a BPMN definitions document', () => {
    expect(() => assertSafeBpmnXml(valid)).not.toThrow();
    expect(() =>
      assertSafeBpmnXml('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"></definitions>'),
    ).not.toThrow();
  });
  it('rejects DTDs and entities', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${valid}`;
    expect(() => assertSafeBpmnXml(xxe)).toThrow('DTD');
  });
  it('rejects non-BPMN documents', () => {
    expect(() => assertSafeBpmnXml('<html></html>')).toThrow('Not a BPMN');
    expect(() => assertSafeBpmnXml('<definitions></definitions>')).toThrow('Not a BPMN');
  });
});
