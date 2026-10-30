import { describe, expect, it } from 'vitest';
import {
  createTestPlanSchema,
  sampleSizeFor,
  suggestConclusion,
  testFrequencyFor,
  testPeriod,
  testProblems,
  testReviewSchema,
} from './assurance';

describe('control testing (Phase 4.2)', () => {
  it('derives test frequency and sample size from the control frequency', () => {
    expect(testFrequencyFor('DAILY')).toBe('QUARTERLY');
    expect(testFrequencyFor('QUARTERLY')).toBe('SEMI_ANNUAL');
    expect(testFrequencyFor('ANNUAL')).toBe('ANNUAL');
    expect(sampleSizeFor('PER_TRANSACTION')).toBe(25);
    expect(sampleSizeFor('ANNUAL')).toBe(1);
  });

  it('labels periods', () => {
    const d = new Date('2026-11-30T00:00:00Z');
    expect(testPeriod('QUARTERLY', d)).toBe('2026-Q4');
    expect(testPeriod('SEMI_ANNUAL', d)).toBe('2026-H2');
    expect(testPeriod('MONTHLY', d)).toBe('2026-11');
    expect(testPeriod('ANNUAL', d)).toBe('2026');
  });

  it('suggests a conclusion and reports what blocks a submission', () => {
    expect(suggestConclusion([{ result: 'PASS' }, { result: 'PASS' }])).toBe('EFFECTIVE');
    expect(suggestConclusion([{ result: 'PASS' }, { result: 'EXCEPTION' }])).toBe(
      'EFFECTIVE_WITH_EXCEPTIONS',
    );
    expect(suggestConclusion([{ result: 'FAIL' }, { result: 'EXCEPTION' }])).toBe('NOT_EFFECTIVE');
    expect(suggestConclusion([{ result: null }])).toBeNull();
    expect(testProblems({ samples: [{ result: null }], conclusion: null })).toEqual([
      'SAMPLE_WITHOUT_RESULT',
      'NO_CONCLUSION',
    ]);
  });

  it('keeps tester and reviewer apart and requires a reason to return', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const base = {
      controlId: id,
      testType: 'OPERATING',
      procedure: [],
      sampleSize: 1,
      frequency: 'ANNUAL',
    };
    expect(createTestPlanSchema.safeParse({ ...base, testerId: id, reviewerId: id }).success).toBe(
      false,
    );
    expect(testReviewSchema.safeParse({ decision: 'RETURN' }).success).toBe(false);
    expect(testReviewSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  });
});
