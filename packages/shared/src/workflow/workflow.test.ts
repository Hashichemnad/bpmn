import { describe, expect, it } from 'vitest';
import {
  BusinessCalendar,
  EMPTY_STATE,
  EngineError,
  checkExecutable,
  evaluateDmnTable,
  evaluateFeel,
  evaluateUnaryTests,
  feelSyntaxError,
  formSchema,
  parseCycle,
  parseIsoDurationMinutes,
  readDecisionTables,
  readWorkflowModel,
  renderTemplate,
  serializeExec,
  step,
  validateFormData,
  type CaseState,
  type EngineCommand,
  type ExecConfigInput,
  type WorkflowModel,
} from '../index';

// ---------- Helpers ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const exec = (c: ExecConfigInput) => ` ph:exec="${esc(serializeExec(c))}"`;

function bpmn(body: string, extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
${extra}
<bpmn:process id="P" isExecutable="true">
${body}
</bpmn:process>
</bpmn:definitions>`;
}
const flow = (id: string, from: string, to: string, attrs = '', cond?: string) =>
  cond
    ? `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}"${attrs}><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${esc(cond)}</bpmn:conditionExpression></bpmn:sequenceFlow>`
    : `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}"${attrs}/>`;
const userTask = (id: string, extra = '') =>
  `<bpmn:userTask id="${id}" name="${id}"${exec({ assignment: { type: 'INITIATOR' } })}${extra}/>`;

/** Drives a model: start, then apply commands; returns state, vars and all effects. */
class Driver {
  state: CaseState = EMPTY_STATE;
  vars: Record<string, unknown> = {};
  effects: ReturnType<typeof step>['effects'] = [];
  ended: ReturnType<typeof step>['ended'] = null;
  constructor(
    readonly model: WorkflowModel,
    readonly decide?: (vars: Record<string, unknown>) => Record<string, unknown>,
  ) {}
  run(cmd: EngineCommand, vars: Record<string, unknown> = {}) {
    const r = step(this.model, this.state, { ...this.vars, ...vars }, cmd, {
      decide: this.decide ? (_n, v) => this.decide!(v) : undefined,
    });
    this.state = r.state;
    this.vars = r.vars;
    this.effects.push(...r.effects);
    if (r.ended) this.ended = r.ended;
    return r;
  }
  start(vars: Record<string, unknown> = {}) {
    return this.run({ type: 'START', startNodeId: 'start' }, vars);
  }
  at(nodeId: string) {
    return this.state.tokens.filter((t) => t.nodeId === nodeId);
  }
  complete(
    nodeId: string,
    vars: Record<string, unknown> = {},
    decision?: 'APPROVE' | 'REJECT' | 'RETURN',
  ) {
    const t = this.at(nodeId)[0];
    if (!t) throw new Error(`no token at ${nodeId}`);
    return this.run({ type: 'COMPLETE_TASK', tokenId: t.id, decision }, vars);
  }
  tasks() {
    return this.effects
      .filter((e) => e.type === 'CREATE_TASK')
      .map((e) => (e as { nodeId: string }).nodeId);
  }
}

// ---------- S-FEEL ----------

describe('S-FEEL', () => {
  it('evaluates expressions over variables', () => {
    const ctx = { budget: 150000, type: 'digital', applicant: { name: 'Sara' }, items: [1, 2, 3] };
    expect(evaluateFeel('budget >= 100000', ctx)).toBe(true);
    expect(evaluateFeel('budget >= 100000 and type = "digital"', ctx)).toBe(true);
    expect(evaluateFeel('budget < 100000 or type != "digital"', ctx)).toBe(false);
    expect(evaluateFeel('not(budget > 1)', ctx)).toBe(false);
    expect(evaluateFeel('budget * 2 + 1', ctx)).toBe(300001);
    expect(evaluateFeel('applicant.name', ctx)).toBe('Sara');
    expect(evaluateFeel('"Hello " + applicant.name', ctx)).toBe('Hello Sara');
    expect(evaluateFeel('if budget > 200000 then "high" else "normal"', ctx)).toBe('normal');
    expect(evaluateFeel('type in ("digital", "hybrid")', ctx)).toBe(true);
    expect(evaluateFeel('budget in [100000..200000]', ctx)).toBe(true);
    expect(evaluateFeel('budget between 1 and 10', ctx)).toBe(false);
    expect(evaluateFeel('sum(items)', ctx)).toBe(6);
    expect(evaluateFeel('count(items) = 3', ctx)).toBe(true);
    expect(evaluateFeel('string length(type)', ctx)).toBe(7);
    expect(evaluateFeel('starts with(type, "dig")', ctx)).toBe(true);
    expect(evaluateFeel('missing = null', ctx)).toBe(true);
    expect(evaluateFeel('missing > 5', ctx)).toBe(null);
    expect(evaluateFeel('date("2026-05-01") < date("2026-06-01")', {})).toBe(true);
    expect(evaluateFeel('{a: 1, b: "x"}.b', {})).toBe('x');
  });

  it('never runs JavaScript and rejects invalid syntax', () => {
    expect(feelSyntaxError('budget >')).not.toBeNull();
    expect(feelSyntaxError('constructor.constructor("return 1")()')).not.toBeNull();
    expect(feelSyntaxError('alert(1)')).toMatch(/Unknown function/);
    expect(evaluateFeel('constructor', {})).toBe(null);
    expect(evaluateFeel('toString', {})).toBe(null);
    expect(evaluateFeel('a.__proto__', { a: {} })).toBe(null);
  });

  it('evaluates unary tests of decision tables', () => {
    expect(evaluateUnaryTests('-', 5)).toBe(true);
    expect(evaluateUnaryTests('', 5)).toBe(true);
    expect(evaluateUnaryTests('>= 100000', 150000)).toBe(true);
    expect(evaluateUnaryTests('< 100000', 150000)).toBe(false);
    expect(evaluateUnaryTests('[1..5]', 5)).toBe(true);
    expect(evaluateUnaryTests('[1..5[', 5)).toBe(false);
    expect(evaluateUnaryTests(']1..5]', 1)).toBe(false);
    expect(evaluateUnaryTests('"a","b"', 'b')).toBe(true);
    expect(evaluateUnaryTests('not("a","b")', 'c')).toBe(true);
    expect(evaluateUnaryTests('"digital"', 'non-digital')).toBe(false);
    expect(evaluateUnaryTests('true', true)).toBe(true);
    expect(evaluateUnaryTests('? > 3', 4)).toBe(true);
  });
});

// ---------- DMN ----------

const DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="D" name="Budget" namespace="x">
  <decision id="BudgetApproval" name="Budget approval">
    <decisionTable id="T" hitPolicy="UNIQUE">
      <input id="I1" label="Estimated budget"><inputExpression id="E1" typeRef="number"><text>estimatedBudget</text></inputExpression></input>
      <output id="O1" name="budgetApproval" typeRef="boolean"/>
      <rule id="R1"><inputEntry id="a"><text>&gt;= 100000</text></inputEntry><outputEntry id="b"><text>true</text></outputEntry></rule>
      <rule id="R2"><inputEntry id="c"><text>&lt; 100000</text></inputEntry><outputEntry id="d"><text>false</text></outputEntry></rule>
    </decisionTable>
  </decision>
  <decision id="Collect" name="Fees">
    <decisionTable id="T2" hitPolicy="COLLECT" aggregation="SUM">
      <input id="I2"><inputExpression id="E2" typeRef="string"><text>kind</text></inputExpression></input>
      <output id="O2" name="fee" typeRef="number"/>
      <rule id="R3"><inputEntry id="e"><text>-</text></inputEntry><outputEntry id="f"><text>10</text></outputEntry></rule>
      <rule id="R4"><inputEntry id="g"><text>"express"</text></inputEntry><outputEntry id="h"><text>25</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

describe('DMN on the server', () => {
  const tables = readDecisionTables(DMN);
  it('reads and evaluates decision tables with hit policies', () => {
    expect(tables.map((t) => t.id)).toEqual(['BudgetApproval', 'Collect']);
    expect(evaluateDmnTable(tables[0], { estimatedBudget: 120000 }).outputs).toEqual({
      budgetApproval: true,
    });
    expect(evaluateDmnTable(tables[0], { estimatedBudget: 99999 }).outputs).toEqual({
      budgetApproval: false,
    });
    expect(evaluateDmnTable(tables[1], { kind: 'express' }).outputs).toEqual({ fee: 35 });
    expect(evaluateDmnTable(tables[1], { kind: 'normal' }).outputs).toEqual({ fee: 10 });
  });
  it('reports a missing match when required', () => {
    expect(() => evaluateDmnTable(tables[0], {}, { requireMatch: true })).toThrow(/No rule/);
  });
});

// ---------- Forms ----------

describe('forms', () => {
  const form = formSchema.parse({
    fields: [
      {
        key: 'programName',
        type: 'text',
        labelEn: 'Program name',
        labelAr: 'اسم البرنامج',
        required: true,
      },
      { key: 'budget', type: 'amount', labelEn: 'Budget', required: true, min: 0, max: 10_000_000 },
      {
        key: 'type',
        type: 'radio',
        labelEn: 'Type',
        options: [
          { value: 'digital', labelEn: 'Digital', labelAr: 'رقمي' },
          { value: 'non-digital', labelEn: 'Non-digital', labelAr: 'غير رقمي' },
        ],
      },
      { key: 'start', type: 'date', labelEn: 'Start' },
      { key: 'note', type: 'info', labelEn: 'Read this' },
    ],
  });
  it('validates and coerces submitted data on the server', () => {
    const ok = validateFormData(form, {
      programName: ' Smart ',
      budget: '120,000',
      type: 'digital',
    });
    expect(ok.errors).toEqual([]);
    expect(ok.values).toMatchObject({
      programName: 'Smart',
      budget: 120000,
      type: 'digital',
      start: null,
    });
    const bad = validateFormData(form, { budget: -1, type: 'x', start: '2026-13-45', evil: 1 });
    expect(bad.errors.map((e) => `${e.key}:${e.code}`).sort()).toEqual(
      [
        'budget:MIN',
        'evil:UNKNOWN_FIELD',
        'programName:REQUIRED',
        'start:TYPE',
        'type:OPTION',
      ].sort(),
    );
    expect(validateFormData(form, {}, { draft: true }).errors).toEqual([]);
  });
  it('rejects duplicate and reserved keys', () => {
    expect(
      formSchema.safeParse({
        fields: [
          { key: 'a', type: 'text' },
          { key: 'a', type: 'text' },
        ],
      }).success,
    ).toBe(false);
    expect(formSchema.safeParse({ fields: [{ key: 'decision', type: 'text' }] }).success).toBe(
      false,
    );
  });
});

// ---------- Model reader and executable check ----------

describe('executable check', () => {
  it('accepts the supported subset and reads execution settings', () => {
    const xml = bpmn(`
      <bpmn:startEvent id="start"${exec({ form: { fields: [{ key: 'amount', type: 'number' }] } })}/>
      ${userTask('review', ' ph:stepKind="approval"')}
      <bpmn:exclusiveGateway id="gw" default="f4"/>
      <bpmn:endEvent id="end"/>
      ${flow('f1', 'start', 'review')}
      ${flow('f2', 'review', 'gw')}
      ${flow('f3', 'gw', 'end', '', 'decision = "APPROVE"')}
      ${flow('f4', 'gw', 'review')}
    `);
    const m = readWorkflowModel(xml);
    expect(m.nodes.start.exec.form?.fields[0].key).toBe('amount');
    expect(m.flows.f3.condition).toBe('decision = "APPROVE"');
    expect(m.nodes.gw.defaultFlow).toBe('f4');
    expect(checkExecutable(m).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reports unsupported elements and missing settings with clear codes', () => {
    const xml = bpmn(`
      <bpmn:startEvent id="start"/>
      <bpmn:task id="plain"/>
      <bpmn:scriptTask id="script"/>
      <bpmn:userTask id="noone"/>
      <bpmn:exclusiveGateway id="gw"/>
      <bpmn:businessRuleTask id="brt"/>
      <bpmn:callActivity id="call"/>
      <bpmn:intermediateCatchEvent id="msg"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent>
      <bpmn:intermediateCatchEvent id="tm"><bpmn:timerEventDefinition><bpmn:timeDuration>P1X</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
      <bpmn:endEvent id="end"/>
      ${flow('f1', 'start', 'plain')}
      ${flow('f2', 'plain', 'script')}
      ${flow('f3', 'script', 'noone')}
      ${flow('f4', 'noone', 'gw')}
      ${flow('f5', 'gw', 'brt', '', 'x >')}
      ${flow('f6', 'gw', 'call')}
      ${flow('f7', 'brt', 'msg')}
      ${flow('f8', 'call', 'tm')}
      ${flow('f9', 'msg', 'end')}
      ${flow('f10', 'tm', 'end')}
    `);
    const codes = checkExecutable(readWorkflowModel(xml))
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.code}:${i.elementId}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'UNSUPPORTED_ELEMENT:plain',
        'UNSUPPORTED_ELEMENT:script',
        'NO_ASSIGNMENT:noone',
        'NO_DECISION:brt',
        'NO_LINKED_PROCESS:call',
        'UNSUPPORTED_EVENT:msg',
        'TIMER_INVALID:tm',
        'CONDITION_SYNTAX:f5',
        'CONDITION_MISSING:f6',
      ]),
    );
  });

  it('parses ISO 8601 timers', () => {
    expect(parseIsoDurationMinutes('PT1H30M')).toBe(90);
    expect(parseIsoDurationMinutes('P2D')).toBe(2880);
    expect(parseIsoDurationMinutes('P1W')).toBe(10080);
    expect(parseIsoDurationMinutes('PT')).toBeNull();
    expect(parseIsoDurationMinutes('5 minutes')).toBeNull();
    expect(parseCycle('R3/PT10M')).toEqual({ repeat: 3, start: null, minutes: 10 });
    expect(parseCycle('R/2026-01-01T08:00:00Z/P1D')?.minutes).toBe(1440);
  });
});

// ---------- Engine ----------

describe('engine', () => {
  it('runs a sequence of user tasks to the end', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/>${userTask('a')}${userTask('b')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'a')}${flow('f2', 'a', 'b')}${flow('f3', 'b', 'end')}`),
      ),
    );
    d.start();
    expect(d.tasks()).toEqual(['a']);
    d.complete('a', { x: 1 });
    expect(d.tasks()).toEqual(['a', 'b']);
    expect(d.vars.x).toBe(1);
    d.complete('b');
    expect(d.ended).toEqual({ kind: 'NORMAL', errorCode: null });
    expect(d.state.tokens).toEqual([]);
  });

  it('protects against double completion (token no longer waiting)', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/>${userTask('a')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'a')}${flow('f2', 'a', 'end')}`),
      ),
    );
    d.start();
    const tok = d.at('a')[0].id;
    const before = d.state;
    d.run({ type: 'COMPLETE_TASK', tokenId: tok });
    expect(() => step(d.model, d.state, d.vars, { type: 'COMPLETE_TASK', tokenId: tok })).toThrow(
      EngineError,
    );
    // The same command against the state the second user saw succeeds only once (optimistic lock in the API).
    expect(step(d.model, before, {}, { type: 'COMPLETE_TASK', tokenId: tok }).ended?.kind).toBe(
      'NORMAL',
    );
  });

  it('exclusive gateway with conditions and default flow; no path → incident', () => {
    const model = readWorkflowModel(
      bpmn(`<bpmn:startEvent id="start"/><bpmn:exclusiveGateway id="gw" default="fd"/>
        ${userTask('high')}${userTask('low')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'gw')}${flow('fh', 'gw', 'high', '', 'budget >= 100000')}${flow('fd', 'gw', 'low')}
        ${flow('f2', 'high', 'end')}${flow('f3', 'low', 'end')}`),
    );
    const a = new Driver(model);
    a.start({ budget: 150000 });
    expect(a.tasks()).toEqual(['high']);
    const b = new Driver(model);
    b.start({ budget: 5 });
    expect(b.tasks()).toEqual(['low']);

    const noDefault = readWorkflowModel(
      bpmn(`<bpmn:startEvent id="start"/><bpmn:exclusiveGateway id="gw"/>${userTask('high')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'gw')}${flow('fh', 'gw', 'high', '', 'budget >= 100000')}${flow('f2', 'high', 'end')}`),
    );
    const c = new Driver(noDefault);
    c.start({ budget: 1 });
    expect(c.state.tokens[0]).toMatchObject({
      nodeId: 'gw',
      status: 'FAILED',
      incident: { code: 'NO_PATH' },
    });
    expect(c.effects.some((e) => e.type === 'INCIDENT')).toBe(true);
    expect(c.ended).toBeNull();
    // Fix the data, retry: the case continues.
    c.vars.budget = 200000;
    c.run({ type: 'RETRY', tokenId: c.state.tokens[0].id });
    expect(c.tasks()).toEqual(['high']);
  });

  it('parallel split and join wait for every branch', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/><bpmn:parallelGateway id="fork"/>${userTask('a')}${userTask('b')}
        <bpmn:parallelGateway id="join"/>${userTask('c')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'fork')}${flow('f2', 'fork', 'a')}${flow('f3', 'fork', 'b')}
        ${flow('f4', 'a', 'join')}${flow('f5', 'b', 'join')}${flow('f6', 'join', 'c')}${flow('f7', 'c', 'end')}`),
      ),
    );
    d.start();
    expect(d.tasks().sort()).toEqual(['a', 'b']);
    d.complete('a');
    expect(d.tasks()).not.toContain('c');
    expect(d.at('join')[0].status).toBe('JOIN');
    d.complete('b');
    expect(d.tasks()).toContain('c');
    d.complete('c');
    expect(d.ended?.kind).toBe('NORMAL');
  });

  it('inclusive split takes every true branch and the join waits only for those', () => {
    const model = readWorkflowModel(
      bpmn(`<bpmn:startEvent id="start"/><bpmn:inclusiveGateway id="split"/>${userTask('legal')}${userTask('it')}${userTask('fin')}
        <bpmn:inclusiveGateway id="join"/><bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'split')}
        ${flow('a', 'split', 'legal', '', 'needsLegal = true')}${flow('b', 'split', 'it', '', 'needsIt = true')}${flow('c', 'split', 'fin', '', 'budget > 0')}
        ${flow('a2', 'legal', 'join')}${flow('b2', 'it', 'join')}${flow('c2', 'fin', 'join')}${flow('e', 'join', 'end')}`),
    );
    const d = new Driver(model);
    d.start({ needsLegal: true, needsIt: false, budget: 10 });
    expect(d.tasks().sort()).toEqual(['fin', 'legal']);
    d.complete('legal');
    expect(d.ended).toBeNull();
    d.complete('fin');
    expect(d.ended?.kind).toBe('NORMAL');
  });

  it('approval outcomes map to flows: return for correction, then approve', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/>${userTask('submit')}${userTask('approve', ' ph:stepKind="approval"')}
        <bpmn:endEvent id="ok"/><bpmn:endEvent id="rejected"/>
        ${flow('f1', 'start', 'submit')}${flow('f2', 'submit', 'approve')}
        ${flow('fa', 'approve', 'ok', exec({ outcome: 'APPROVE' }))}
        ${flow('fr', 'approve', 'rejected', exec({ outcome: 'REJECT' }))}
        ${flow('fret', 'approve', 'submit', exec({ outcome: 'RETURN' }))}`),
      ),
    );
    d.start();
    d.complete('submit');
    d.complete('approve', {}, 'RETURN');
    expect(d.at('submit')).toHaveLength(1);
    expect(d.vars.decision).toBe('RETURN');
    d.complete('submit');
    d.complete('approve', {}, 'APPROVE');
    expect(d.ended?.kind).toBe('NORMAL');
  });

  it('business rule task merges decision outputs; failures become incidents or follow the error path', () => {
    const xml = (boundary: string) =>
      bpmn(`<bpmn:startEvent id="start"/><bpmn:businessRuleTask id="rule" ph:decisionRef="d" ph:decisionId="x"/>
        ${boundary}<bpmn:exclusiveGateway id="gw" default="fn"/>${userTask('budget')}${userTask('fix')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'rule')}${flow('f2', 'rule', 'gw')}${flow('fy', 'gw', 'budget', '', 'budgetApproval = true')}
        ${flow('fn', 'gw', 'end')}${flow('f3', 'budget', 'end')}${flow('f4', 'fix', 'end')}
        ${boundary ? flow('fe', 'err', 'fix') : ''}`);
    const ok = new Driver(readWorkflowModel(xml('')), (v) => ({
      budgetApproval: (v.estimatedBudget as number) >= 100000,
    }));
    ok.start({ estimatedBudget: 250000 });
    expect(ok.tasks()).toEqual(['budget']);

    const failing = () => {
      throw Object.assign(new Error('boom'), { code: 'NO_MATCH' });
    };
    const incident = new Driver(readWorkflowModel(xml('')), failing);
    incident.start();
    expect(incident.state.tokens[0]).toMatchObject({ nodeId: 'rule', status: 'FAILED' });

    const handled = new Driver(
      readWorkflowModel(
        xml(
          '<bpmn:boundaryEvent id="err" attachedToRef="rule"><bpmn:errorEventDefinition/></bpmn:boundaryEvent>',
        ),
      ),
      failing,
    );
    handled.start();
    expect(handled.tasks()).toEqual(['fix']);
    expect(handled.vars.error).toMatchObject({ code: 'NO_MATCH' });
  });

  it('intermediate timer waits and fires once (idempotent)', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/><bpmn:intermediateCatchEvent id="wait"><bpmn:timerEventDefinition><bpmn:timeDuration>P1D</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
        ${userTask('a')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'wait')}${flow('f2', 'wait', 'a')}${flow('f3', 'a', 'end')}`),
      ),
    );
    d.start();
    expect(d.effects.find((e) => e.type === 'SCHEDULE_TIMER')).toMatchObject({ nodeId: 'wait' });
    const tok = d.at('wait')[0].id;
    d.run({ type: 'TIMER_FIRED', tokenId: tok, nodeId: 'wait' });
    expect(d.tasks()).toEqual(['a']);
    const n = d.effects.length;
    d.run({ type: 'TIMER_FIRED', tokenId: tok, nodeId: 'wait' });
    expect(d.effects.length).toBe(n);
  });

  it('interrupting boundary timer cancels the task; non-interrupting adds a branch', () => {
    const xml = (cancel: boolean) =>
      bpmn(`<bpmn:startEvent id="start"/>${userTask('a')}
        <bpmn:boundaryEvent id="late" attachedToRef="a" cancelActivity="${cancel}"><bpmn:timerEventDefinition><bpmn:timeDuration>PT4H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
        ${userTask('escalate')}<bpmn:endEvent id="end"/><bpmn:endEvent id="end2"/>
        ${flow('f1', 'start', 'a')}${flow('f2', 'a', 'end')}${flow('f3', 'late', 'escalate')}${flow('f4', 'escalate', 'end2')}`);
    const i = new Driver(readWorkflowModel(xml(true)));
    i.start();
    const host = i.at('a')[0].id;
    expect(i.effects.filter((e) => e.type === 'SCHEDULE_TIMER')).toEqual([
      { type: 'SCHEDULE_TIMER', tokenId: host, nodeId: 'late' },
    ]);
    i.run({ type: 'TIMER_FIRED', tokenId: host, nodeId: 'late' });
    expect(i.effects.some((e) => e.type === 'CANCEL_TASK' && e.tokenId === host)).toBe(true);
    expect(i.at('a')).toHaveLength(0);
    expect(i.tasks()).toContain('escalate');

    const n = new Driver(readWorkflowModel(xml(false)));
    n.start();
    const h2 = n.at('a')[0].id;
    n.run({ type: 'TIMER_FIRED', tokenId: h2, nodeId: 'late' });
    expect(n.at('a')).toHaveLength(1);
    expect(n.tasks()).toContain('escalate');
    n.complete('a');
    expect(n.ended).toBeNull();
    n.complete('escalate');
    expect(n.ended?.kind).toBe('NORMAL');
  });

  it('terminate end cancels the other branches; error end ends the case with the error', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/><bpmn:parallelGateway id="fork"/>${userTask('a')}${userTask('b')}
        <bpmn:endEvent id="stop"><bpmn:terminateEventDefinition/></bpmn:endEvent><bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'fork')}${flow('f2', 'fork', 'a')}${flow('f3', 'fork', 'b')}${flow('f4', 'a', 'stop')}${flow('f5', 'b', 'end')}`),
      ),
    );
    d.start();
    const b = d.at('b')[0].id;
    d.complete('a');
    expect(d.ended?.kind).toBe('TERMINATE');
    expect(d.effects).toContainEqual({ type: 'CANCEL_TASK', tokenId: b });

    const e = new Driver(
      readWorkflowModel(
        bpmn(
          `<bpmn:startEvent id="start"/><bpmn:endEvent id="fail"><bpmn:errorEventDefinition errorRef="E1"/></bpmn:endEvent>${flow('f1', 'start', 'fail')}`,
          '<bpmn:error id="E1" errorCode="BUDGET_REJECTED"/>',
        ),
      ),
    );
    e.start();
    expect(e.ended).toEqual({ kind: 'ERROR', errorCode: 'BUDGET_REJECTED' });
  });

  it('call activity waits for the child; a child error follows the error boundary', () => {
    const model = readWorkflowModel(
      bpmn(`<bpmn:startEvent id="start"/><bpmn:callActivity id="call" ph:linkedProcessId="00000000-0000-4000-8000-000000000001"/>
        <bpmn:boundaryEvent id="err" attachedToRef="call"><bpmn:errorEventDefinition/></bpmn:boundaryEvent>
        ${userTask('handle')}<bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'call')}${flow('f2', 'call', 'end')}${flow('f3', 'err', 'handle')}${flow('f4', 'handle', 'end')}`),
    );
    const ok = new Driver(model);
    ok.start();
    expect(ok.effects).toContainEqual({
      type: 'RUN_JOB',
      tokenId: ok.at('call')[0].id,
      nodeId: 'call',
      kind: 'CALL',
    });
    ok.run({
      type: 'CHILD_COMPLETED',
      tokenId: ok.at('call')[0].id,
      endKind: 'NORMAL',
      variables: { childResult: 7 },
    });
    expect(ok.vars.childResult).toBe(7);
    expect(ok.ended?.kind).toBe('NORMAL');

    const bad = new Driver(model);
    bad.start();
    bad.run({
      type: 'CHILD_COMPLETED',
      tokenId: bad.at('call')[0].id,
      endKind: 'ERROR',
      errorCode: 'X',
    });
    expect(bad.tasks()).toEqual(['handle']);
  });

  it('set data, notification and document steps', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/>
        <bpmn:serviceTask id="set"${exec({ kind: 'SET_DATA', set: [{ key: 'total', expression: 'qty * price' }] })}/>
        <bpmn:sendTask id="mail"${exec({ notify: { recipients: [{ type: 'INITIATOR' }], subjectEn: 'Hi', bodyEn: 'Total {{total}}' } })}/>
        <bpmn:serviceTask id="doc"${exec({ kind: 'GENERATE_DOCUMENT', document: { bodyEn: 'x' } })}/>
        <bpmn:endEvent id="end"/>
        ${flow('f1', 'start', 'set')}${flow('f2', 'set', 'mail')}${flow('f3', 'mail', 'doc')}${flow('f4', 'doc', 'end')}`),
      ),
    );
    d.start({ qty: 3, price: 2.5 });
    expect(d.vars.total).toBe(7.5);
    expect(d.effects.some((e) => e.type === 'NOTIFY' && e.nodeId === 'mail')).toBe(true);
    const job = d.effects.find((e) => e.type === 'RUN_JOB');
    expect(job).toMatchObject({ kind: 'DOCUMENT', nodeId: 'doc' });
    d.run({ type: 'JOB_DONE', tokenId: d.at('doc')[0].id });
    expect(d.ended?.kind).toBe('NORMAL');
  });

  it('survives a restart: the state is plain JSON', () => {
    const model = readWorkflowModel(
      bpmn(
        `<bpmn:startEvent id="start"/>${userTask('a')}<bpmn:endEvent id="end"/>${flow('f1', 'start', 'a')}${flow('f2', 'a', 'end')}`,
      ),
    );
    const d = new Driver(model);
    d.start({ x: 1 });
    const stored = JSON.parse(JSON.stringify({ state: d.state, vars: d.vars }));
    const reloaded = readWorkflowModel(
      bpmn(
        `<bpmn:startEvent id="start"/>${userTask('a')}<bpmn:endEvent id="end"/>${flow('f1', 'start', 'a')}${flow('f2', 'a', 'end')}`,
      ),
    );
    const r = step(reloaded, stored.state, stored.vars, {
      type: 'COMPLETE_TASK',
      tokenId: stored.state.tokens[0].id,
    });
    expect(r.ended?.kind).toBe('NORMAL');
  });

  it('stops endless loops with an incident', () => {
    const d = new Driver(
      readWorkflowModel(
        bpmn(`<bpmn:startEvent id="start"/><bpmn:exclusiveGateway id="g1"/><bpmn:exclusiveGateway id="g2"/>
        ${flow('f1', 'start', 'g1')}${flow('f2', 'g1', 'g2')}${flow('f3', 'g2', 'g1')}`),
      ),
    );
    d.start();
    expect(d.effects.some((e) => e.type === 'INCIDENT' && e.code === 'LOOP')).toBe(true);
  });
});

// ---------- Calendar and templates ----------

describe('business calendar', () => {
  const cal = new BusinessCalendar(
    { week: 'SUN_THU', start: '07:30', end: '15:30', timeZone: 'Asia/Dubai' },
    ['2026-12-02', '2026-12-03'],
  );
  it('adds working minutes over weekends and holidays (Dubai time)', () => {
    // Thursday 2026-11-26 14:30 Dubai = 10:30 UTC; 2 working hours → Monday? No: Sunday 2026-11-29 08:30.
    const due = cal.addWorkingMinutes(new Date('2026-11-26T10:30:00Z'), 120);
    expect(due.toISOString()).toBe('2026-11-29T04:30:00.000Z');
    // Tuesday 2026-12-01 15:00 Dubai + 60 min → 30 min on Tue, Wed/Thu are holidays, Fri/Sat weekend → Sun 08:00.
    expect(cal.addWorkingMinutes(new Date('2026-12-01T11:00:00Z'), 60).toISOString()).toBe(
      '2026-12-06T04:00:00.000Z',
    );
    // Before opening: starts at 07:30.
    expect(cal.addWorkingMinutes(new Date('2026-11-29T02:00:00Z'), 30).toISOString()).toBe(
      '2026-11-29T04:00:00.000Z',
    );
    expect(
      cal.workingMinutesBetween(new Date('2026-11-26T10:30:00Z'), new Date('2026-11-29T04:30:00Z')),
    ).toBe(120);
  });
});

describe('templates', () => {
  it('fills placeholders with plain text only', () => {
    expect(
      renderTemplate(
        'Dear {{initiator.name}}, budget {{budget}} for {{name}}{{missing}}',
        {
          initiator: { name: 'Sara' },
          budget: 120000,
          name: '<b>x</b>',
        },
        'en',
      ),
    ).toBe('Dear Sara, budget 120,000 for <b>x</b>');
  });
});
