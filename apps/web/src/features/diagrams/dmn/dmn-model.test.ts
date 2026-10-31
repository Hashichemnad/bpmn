import { describe, expect, it } from 'vitest';
import {
  bilingualTexts,
  dmnForLocale,
  dmnFromLocale,
  evaluateDecision,
  readDecisions,
  validateDecisions,
} from './dmn-model';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:ph="http://processhub.io/schema/bpmn" id="D" name="Approval" namespace="x">
  <decision id="Decision_1" name="Approval authority" ph:nameEn="Approval authority" ph:nameAr="صلاحية الاعتماد">
    <decisionTable id="T" hitPolicy="FIRST">
      <input id="In_1" label="Amount" ph:nameAr="المبلغ"><inputExpression id="E1" typeRef="number"><text>amount</text></inputExpression></input>
      <input id="In_2" label="Category"><inputExpression id="E2" typeRef="string"><text>category</text></inputExpression></input>
      <output id="Out_1" label="Approver" name="approver" typeRef="string" />
      <rule id="R1"><description>Small purchases</description><inputEntry id="a"><text>&lt; 10000</text></inputEntry><inputEntry id="b"><text>-</text></inputEntry><outputEntry id="c"><text>"Manager"</text></outputEntry></rule>
      <rule id="R2"><inputEntry id="d"><text>[10000..100000]</text></inputEntry><inputEntry id="e"><text>"IT","Services"</text></inputEntry><outputEntry id="f"><text>"Director"</text></outputEntry></rule>
      <rule id="R3"><inputEntry id="g"><text>&gt;= 10000</text></inputEntry><inputEntry id="h"><text>-</text></inputEntry><outputEntry id="i"><text>"CEO"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

describe('DMN model (D-123)', () => {
  const [decision] = readDecisions(XML);

  it('reads decision tables', () => {
    expect(decision).toMatchObject({
      id: 'Decision_1',
      hitPolicy: 'FIRST',
      nameAr: 'صلاحية الاعتماد',
    });
    expect(decision.inputs.map((i) => i.typeRef)).toEqual(['number', 'string']);
    expect(decision.rules[1].inputEntries).toEqual(['[10000..100000]', '"IT","Services"']);
  });

  it('evaluates FEEL unary tests with the hit policy', () => {
    expect(evaluateDecision(decision, { In_1: '5000', In_2: 'HR' })).toMatchObject({
      result: 'Manager',
      error: null,
      matched: [{ ruleId: 'R1', annotation: 'Small purchases' }],
    });
    // FIRST: R2 and R3 match, the first one wins.
    const r = evaluateDecision(decision, { In_1: '20,000', In_2: 'IT' });
    expect(r.matched.map((m) => m.ruleId)).toEqual(['R2', 'R3']);
    expect(r.result).toBe('Director');
    expect(
      evaluateDecision({ ...decision, hitPolicy: 'UNIQUE' }, { In_1: '20000', In_2: 'IT' }).error,
    ).toBe('UNIQUE_VIOLATION');
    expect(
      evaluateDecision({ ...decision, hitPolicy: 'COLLECT' }, { In_1: '20000', In_2: 'IT' }).result,
    ).toEqual(['Director', 'CEO']);
    expect(
      evaluateDecision(
        { ...decision, hitPolicy: 'COLLECT', aggregation: 'COUNT' },
        { In_1: '20000', In_2: 'IT' },
      ).result,
    ).toBe(2);
    expect(
      evaluateDecision({ ...decision, rules: decision.rules.slice(0, 1) }, { In_1: '50000' }).error,
    ).toBe('NO_MATCH');
  });

  it('reports invalid entries and missing translations', () => {
    const broken = XML.replace('[10000..100000]', '&gt; 1 +');
    const issues = validateDecisions(readDecisions(broken), broken).map((i) => i.code);
    expect(issues).toContain('INVALID_INPUT_ENTRY');
    expect(validateDecisions(readDecisions(XML), XML).map((i) => i.code)).toEqual([]);
  });

  it('switches the visible language and stores both', () => {
    const ar = dmnForLocale(XML, 'ar');
    expect(readDecisions(ar)[0].name).toBe('صلاحية الاعتماد');
    expect(readDecisions(ar)[0].inputs[0].label).toBe('المبلغ');
    // Edited in Arabic, English unchanged; stored with English names again.
    const edited = ar.replace('label="المبلغ"', 'label="قيمة الشراء"');
    const stored = dmnFromLocale(edited, 'ar', new Map());
    expect(readDecisions(stored)[0].inputs[0].label).toBe('Amount');
    expect(bilingualTexts(stored).get('In_1')).toMatchObject({ en: 'Amount', ar: 'قيمة الشراء' });
    // English edit with an Arabic translation from the Translations panel.
    const en = dmnFromLocale(XML, 'en', new Map([['R1', 'مشتريات صغيرة']]));
    expect(bilingualTexts(en).get('R1')).toMatchObject({
      en: 'Small purchases',
      ar: 'مشتريات صغيرة',
      kind: 'annotation',
    });
  });
});
