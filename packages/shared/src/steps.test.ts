import { describe, expect, it } from 'vitest';
import { STEP_TYPES, STEP_TYPE_BPMN, stepTypeOf } from './steps';

describe('stepTypeOf', () => {
  it('maps BPMN elements to business step types', () => {
    expect(stepTypeOf({ type: 'bpmn:Task' })).toBe('task');
    expect(stepTypeOf({ type: 'manualTask' })).toBe('task');
    expect(stepTypeOf({ type: 'bpmn:UserTask', nameEn: 'Fill in the form' })).toBe('task');
    expect(stepTypeOf({ type: 'bpmn:UserTask', nameEn: 'Approve request' })).toBe('approval');
    expect(stepTypeOf({ type: 'bpmn:UserTask', nameEn: 'Approve', stepKind: 'task' })).toBe('task');
    expect(stepTypeOf({ type: 'bpmn:UserTask', nameEn: 'Sign', stepKind: 'approval' })).toBe(
      'approval',
    );
    expect(stepTypeOf({ type: 'bpmn:ServiceTask' })).toBe('system');
    expect(stepTypeOf({ type: 'bpmn:ScriptTask' })).toBe('system');
    expect(stepTypeOf({ type: 'bpmn:SendTask' })).toBe('notification');
    expect(stepTypeOf({ type: 'bpmn:ExclusiveGateway' })).toBe('decision');
    expect(stepTypeOf({ type: 'bpmn:EndEvent' })).toBe('end');
    expect(stepTypeOf({ type: 'bpmn:ParallelGateway' })).toBe('other');
    expect(stepTypeOf({ type: 'bpmn:StartEvent' })).toBe('other');
  });

  it('round-trips every step type through its BPMN type', () => {
    for (const t of STEP_TYPES) {
      const b = STEP_TYPE_BPMN[t];
      expect(stepTypeOf({ type: b.type, stepKind: b.stepKind })).toBe(t);
    }
  });
});
