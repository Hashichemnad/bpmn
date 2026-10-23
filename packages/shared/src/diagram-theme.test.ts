import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIAGRAM_THEME,
  diagramThemeSchema,
  isApprovalLabel,
  isThemeColour,
  resolveDiagramTheme,
  themeColour,
  themeKindOf,
} from './diagram-theme';

describe('isApprovalLabel', () => {
  it.each([
    'Review request (Section Manager)',
    'Approve budget',
    'Endorse program (DG Office)',
    'Confirm budget availability',
    'review',
    '  APPROVE: final',
  ])('"%s" is an approval step', (label) => expect(isApprovalLabel(label)).toBe(true));

  it.each([
    'Submit for approval',
    'Complete budget details and submit for approval',
    'Prepare review pack',
    'Reviewer assignment',
    'Approval letter archived',
    'Confirmation e-mail sent',
    '',
    null,
  ])('"%s" is not an approval step', (label) => expect(isApprovalLabel(label)).toBe(false));
});

describe('themeKindOf', () => {
  it('classifies events, tasks, gateways and lanes', () => {
    expect(themeKindOf({ type: 'bpmn:StartEvent' })).toBe('start');
    expect(themeKindOf({ type: 'bpmn:EndEvent', nameEn: 'Project created' })).toBe('end');
    expect(themeKindOf({ type: 'endEvent', eventDefinitions: ['terminate'] })).toBe('endRejected');
    expect(
      themeKindOf({ type: 'bpmn:EndEvent', eventDefinitions: ['bpmn:ErrorEventDefinition'] }),
    ).toBe('endRejected');
    expect(themeKindOf({ type: 'bpmn:EndEvent', nameEn: 'Request rejected' })).toBe('endRejected');
    expect(themeKindOf({ type: 'bpmn:IntermediateCatchEvent' })).toBe('intermediateEvent');
    expect(themeKindOf({ type: 'bpmn:UserTask', nameEn: 'Create request' })).toBe('humanTask');
    expect(themeKindOf({ type: 'bpmn:ManualTask' })).toBe('humanTask');
    expect(themeKindOf({ type: 'bpmn:Task' })).toBe('humanTask');
    expect(themeKindOf({ type: 'bpmn:CallActivity' })).toBe('humanTask');
    for (const t of ['ServiceTask', 'SendTask', 'ReceiveTask', 'ScriptTask', 'BusinessRuleTask'])
      expect(themeKindOf({ type: `bpmn:${t}` })).toBe('systemTask');
    expect(themeKindOf({ type: 'bpmn:ExclusiveGateway' })).toBe('gateway');
    expect(themeKindOf({ type: 'parallelGateway' })).toBe('gateway');
    expect(themeKindOf({ type: 'bpmn:Lane' })).toBe('lane');
    expect(themeKindOf({ type: 'bpmn:TextAnnotation' })).toBeNull();
    expect(themeKindOf({ type: 'bpmn:Participant' })).toBeNull();
    expect(themeKindOf({ type: 'bpmn:DataObjectReference' })).toBeNull();
  });

  it('uses the label and the explicit step kind for user tasks only', () => {
    expect(themeKindOf({ type: 'bpmn:UserTask', nameEn: 'Review request' })).toBe('approvalTask');
    expect(themeKindOf({ type: 'bpmn:UserTask', nameEn: 'Submit for approval' })).toBe('humanTask');
    expect(themeKindOf({ type: 'bpmn:UserTask', nameEn: 'Check', stepKind: 'approval' })).toBe(
      'approvalTask',
    );
    expect(themeKindOf({ type: 'bpmn:UserTask', nameEn: 'Review logs', stepKind: 'task' })).toBe(
      'humanTask',
    );
    // A service task named "Confirm …" is still a system step.
    expect(themeKindOf({ type: 'bpmn:ServiceTask', nameEn: 'Confirm payment' })).toBe('systemTask');
  });
});

describe('theme colours', () => {
  it('alternates lane fills', () => {
    const t = DEFAULT_DIAGRAM_THEME;
    expect(themeColour(t, 'lane', 0).fill).toBe('#FFFFFF');
    expect(themeColour(t, 'lane', 1).fill).toBe('#FAFBFC');
    expect(themeColour(t, 'lane', 2).fill).toBe('#FFFFFF');
    expect(themeColour(t, 'gateway')).toEqual({ fill: '#FFF8E1', stroke: '#B28704' });
  });

  it('recognises theme pairs (current or default theme), case-insensitively', () => {
    const custom = {
      ...DEFAULT_DIAGRAM_THEME,
      humanTask: { fill: '#DDEEFF', stroke: '#003366' },
    };
    expect(isThemeColour(custom, '#ddeeff', '#003366')).toBe(true);
    expect(isThemeColour(custom, '#E8F1FB', '#1F5FA8')).toBe(true); // default human task
    expect(isThemeColour(custom, '#E8F1FB', '#C62828')).toBe(false); // mixed pair
    expect(isThemeColour(custom, '#123456', '#654321')).toBe(false);
    expect(isThemeColour(custom, undefined, undefined)).toBe(false);
  });

  it('validates and normalises a theme; invalid stored values fall back to the default', () => {
    const parsed = diagramThemeSchema.parse({
      ...DEFAULT_DIAGRAM_THEME,
      gateway: { fill: '#abcdef', stroke: '#000000' },
    });
    expect(parsed.gateway.fill).toBe('#ABCDEF');
    expect(
      diagramThemeSchema.safeParse({ ...DEFAULT_DIAGRAM_THEME, start: { fill: 'red', stroke: '' } })
        .success,
    ).toBe(false);
    expect(resolveDiagramTheme(null)).toEqual(DEFAULT_DIAGRAM_THEME);
    expect(resolveDiagramTheme({ start: 1 })).toEqual(DEFAULT_DIAGRAM_THEME);
    expect(resolveDiagramTheme(parsed).gateway.fill).toBe('#ABCDEF');
  });
});
