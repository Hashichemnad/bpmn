import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { applyThemeToXml, differsOnlyInColours, mayNeedColours } from './diagram-theme-xml';

const SAMPLE = readFileSync(
  join(__dirname, '../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn'),
  'utf8',
);
/** The sample without any colour attributes (and without the colour namespaces). */
const UNCOLOURED = SAMPLE.replace(/ (bioc|color):[a-z-]+="#[0-9A-Fa-f]{6}"/g, '').replace(
  / xmlns:(bioc|color)="[^"]+"/g,
  '',
);

/** fill/stroke of every coloured shape, by element id. */
function colours(xml: string) {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<bpmndi:BPMNShape [^>]*>/g)) {
    const id = /bpmnElement="([^"]+)"/.exec(m[0])![1];
    const fill = /color:background-color="([^"]+)"/.exec(m[0])?.[1];
    const stroke = /color:border-color="([^"]+)"/.exec(m[0])?.[1];
    const bFill = /bioc:fill="([^"]+)"/.exec(m[0])?.[1];
    const bStroke = /bioc:stroke="([^"]+)"/.exec(m[0])?.[1];
    if (fill || stroke) {
      expect(bFill).toBe(fill);
      expect(bStroke).toBe(stroke);
      out.set(id, `${fill}/${stroke}`);
    }
  }
  return out;
}

describe('applyThemeToXml', () => {
  it('recolours an uncoloured diagram exactly like the reference sample', () => {
    expect(colours(UNCOLOURED).size).toBe(0);
    const { xml, changed } = applyThemeToXml(UNCOLOURED, DEFAULT_DIAGRAM_THEME);
    // 27 flow nodes + 8 lanes; the pool is not coloured.
    expect(changed).toBe(35);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"');
    expect(xml).toContain('xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0"');
    expect(colours(xml)).toEqual(colours(SAMPLE));
    // Bilingual attributes survive.
    expect(xml).toContain('ph:nameAr="طلب البرنامج / المبادرة واعتماده"');
  });

  it('never changes shapes that already have colours', () => {
    const res = applyThemeToXml(SAMPLE, DEFAULT_DIAGRAM_THEME);
    expect(res.changed).toBe(0);
    expect(res.xml).toBe(SAMPLE);

    const custom = UNCOLOURED.replace(
      'bpmnElement="Task_CreateRequest"',
      'bpmnElement="Task_CreateRequest" bioc:fill="#123456"',
    ).replace(
      ' id="Definitions_PMS01"',
      ' xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" id="Definitions_PMS01"',
    );
    const out = applyThemeToXml(custom, DEFAULT_DIAGRAM_THEME);
    expect(out.changed).toBe(34);
    expect(out.xml).toMatch(/bpmnElement="Task_CreateRequest" bioc:fill="#123456">/);
  });

  it('uses the configured theme and the step kind', () => {
    const theme = {
      ...DEFAULT_DIAGRAM_THEME,
      approvalTask: { fill: '#000001', stroke: '#000002' },
    };
    const marked = UNCOLOURED.replace(
      'id="Task_Screening" ',
      'id="Task_Screening" ph:stepKind="approval" ',
    );
    const c = colours(applyThemeToXml(marked, theme).xml);
    expect(c.get('Task_Screening')).toBe('#000001/#000002');
    expect(c.get('Task_SMReview')).toBe('#000001/#000002');
    expect(c.get('Task_CreateRequest')).toBe('#E8F1FB/#1F5FA8');
  });

  it('leaves XML that does not parse untouched', () => {
    expect(applyThemeToXml('<bpmn:definitions', DEFAULT_DIAGRAM_THEME)).toEqual({
      xml: '<bpmn:definitions',
      changed: 0,
    });
  });
});

describe('differsOnlyInColours', () => {
  it('accepts a pure recolouring and rejects any other change', () => {
    const coloured = applyThemeToXml(UNCOLOURED, DEFAULT_DIAGRAM_THEME).xml;
    expect(differsOnlyInColours(UNCOLOURED, coloured)).toBe(true);
    expect(differsOnlyInColours(SAMPLE, UNCOLOURED)).toBe(true);
    expect(differsOnlyInColours(SAMPLE, SAMPLE.replace(/\n {6}/g, '\n'))).toBe(true);
    // Label, layout and attribute changes are not colour-only.
    expect(
      differsOnlyInColours(
        coloured,
        coloured.replace('ph:nameEn="Answer screening questions"', 'ph:nameEn="Answer questions"'),
      ),
    ).toBe(false);
    expect(differsOnlyInColours(SAMPLE, SAMPLE.replace('x="242" y="132"', 'x="250" y="132"'))).toBe(
      false,
    );
    expect(
      differsOnlyInColours(
        SAMPLE,
        SAMPLE.replace('id="Task_Screening" ', 'id="Task_Screening" ph:stepKind="approval" '),
      ),
    ).toBe(false);
    expect(differsOnlyInColours('<bpmn:definitions', SAMPLE)).toBe(false);
  });
});

describe('mayNeedColours', () => {
  it('is false only when every themeable shape carries a colour', () => {
    const coloured = applyThemeToXml(UNCOLOURED, DEFAULT_DIAGRAM_THEME).xml;
    expect(mayNeedColours(UNCOLOURED)).toBe(true);
    expect(mayNeedColours(coloured)).toBe(false);
    expect(applyThemeToXml(coloured, DEFAULT_DIAGRAM_THEME)).toEqual({ xml: coloured, changed: 0 });
    // One shape without colours is enough to parse the diagram.
    const oneMissing = coloured.replace(/<(?:\w+:)?BPMNShape\b[^>]*color:[^>]*>/, (tag) =>
      tag.replace(/\s[\w.-]+:(?:background-color|border-color|fill|stroke)="[^"]*"/g, ''),
    );
    expect(mayNeedColours(oneMissing)).toBe(true);
  });
});
