import { describe, expect, it } from 'vitest';
import {
  ageBucket,
  answerProblems,
  engagementMove,
  isQuestionVisible,
  issueTransition,
  issueTransitionSchema,
  questionnaireDefinitionSchema,
  scoreAnswers,
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

describe('issues and audits (Phase 4.2)', () => {
  it('allows issue transitions only from the right status', () => {
    expect(issueTransition('OPEN', 'READY')).toBe('READY_FOR_VERIFICATION');
    expect(issueTransition('READY_FOR_VERIFICATION', 'VERIFY')).toBe('CLOSED');
    expect(issueTransition('OPEN', 'VERIFY')).toBeNull();
    expect(issueTransition('CLOSED', 'REOPEN')).toBe('IN_PROGRESS');
    expect(ageBucket(10)).toBe('0-30');
    expect(ageBucket(95)).toBe('90+');
    expect(issueTransitionSchema.safeParse({ action: 'ACCEPT_RISK' }).success).toBe(false);
  });

  it('moves engagements one stage at a time', () => {
    expect(engagementMove('PLANNED', 'FIELDWORK')).toBe(true);
    expect(engagementMove('PLANNED', 'REPORTING')).toBe(false);
    expect(engagementMove('FOLLOW_UP', 'REPORTING')).toBe(true);
  });
});

describe('questionnaires (Phase 4.2)', () => {
  const def = questionnaireDefinitionSchema.parse({
    sections: [
      {
        id: 's',
        questions: [
          { id: 'known', type: 'YES_NO_NA', textEn: 'Known?', required: true, weight: 2 },
          {
            id: 'why',
            type: 'TEXT',
            textEn: 'Why not?',
            required: true,
            showIf: { questionId: 'known', equals: ['NO'] },
          },
          {
            id: 'pick',
            type: 'SINGLE',
            textEn: 'Pick',
            weight: 1,
            options: [
              { id: 'a', en: 'A', score: 2 },
              { id: 'b', en: 'B', score: 0 },
            ],
          },
          { id: 'rate', type: 'RATING', textEn: 'Rate', weight: 1 },
        ],
      },
    ],
  });

  it('shows conditional questions and checks required answers', () => {
    expect(isQuestionVisible(def.sections[0].questions[1], { known: 'YES' })).toBe(false);
    expect(answerProblems(def, { known: 'NO' })).toEqual([{ questionId: 'why', code: 'REQUIRED' }]);
    expect(answerProblems(def, { known: 'YES', pick: 'z', rate: 7 })).toEqual([
      { questionId: 'pick', code: 'INVALID' },
      { questionId: 'rate', code: 'INVALID' },
    ]);
  });

  it('scores weighted answers, skipping N/A', () => {
    expect(scoreAnswers(def, { known: 'YES', pick: 'a', rate: 5 })).toEqual({
      score: 2 + 2 + 5,
      maxScore: 2 + 2 + 5,
      percent: 100,
    });
    expect(scoreAnswers(def, { known: 'NA', pick: 'b', rate: 1 })?.maxScore).toBe(7);
  });

  it('refuses conditions on later questions and invalid self-assessment links', () => {
    const bad = {
      sections: [
        {
          id: 's',
          questions: [
            { id: 'a', type: 'TEXT', textEn: 'A', showIf: { questionId: 'b', equals: ['x'] } },
            { id: 'b', type: 'TEXT', textEn: 'B' },
          ],
        },
      ],
    };
    expect(questionnaireDefinitionSchema.safeParse(bad).success).toBe(false);
    const link = {
      sections: [
        {
          id: 's',
          questions: [
            {
              id: 'a',
              type: 'TEXT',
              textEn: 'A',
              link: { objectId: '0f8fad5b-d9cb-469f-a165-70867728950e', field: 'LIKELIHOOD' },
            },
          ],
        },
      ],
    };
    expect(questionnaireDefinitionSchema.safeParse(link).success).toBe(false);
  });
});
