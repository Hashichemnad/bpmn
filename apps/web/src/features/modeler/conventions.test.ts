import { describe, expect, it } from 'vitest';
import type { BpmnIssue, ConventionIssue } from '@processhub/shared';
import { withoutDuplicates } from './conventions';

describe('withoutDuplicates', () => {
  it('drops the basic "unconnected" warning only for elements the convention reports', () => {
    const basic: BpmnIssue[] = [
      { code: 'UNCONNECTED_ELEMENT', severity: 'warning', elementId: 'A' },
      { code: 'UNCONNECTED_ELEMENT', severity: 'warning', elementId: 'B' },
      { code: 'MISSING_OUTGOING', severity: 'warning', elementId: 'A' },
    ];
    const conventions: ConventionIssue[] = [
      { rule: 'noUnconnected', mandatory: true, elementId: 'A' },
      { rule: 'laneRole', mandatory: false, elementId: 'B' },
    ];
    expect(withoutDuplicates(basic, conventions)).toEqual([basic[1], basic[2]]);
  });
});
