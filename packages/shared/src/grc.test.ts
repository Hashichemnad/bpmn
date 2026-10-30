import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRC_SETTINGS,
  createLinkSchema,
  createRiskSchema,
  detectControlGaps,
  parseBpmnGraph,
  grcSettingsSchema,
  heatMap,
  isEffectiveControl,
  isOverdue,
  needsChangeApproval,
  testedResidual,
  rateRisk,
  ratingBand,
  resolveGrcSettings,
  riskScore,
  summariseSteps,
} from './index';

const bands = DEFAULT_GRC_SETTINGS.bands;

describe('risk ratings', () => {
  it('scores likelihood × impact and finds the band', () => {
    expect(riskScore(4, 5)).toBe(20);
    expect(riskScore(null, 3)).toBeNull();
    expect(ratingBand(4, bands)?.key).toBe('LOW');
    expect(ratingBand(5, bands)?.key).toBe('MEDIUM');
    expect(ratingBand(12, bands)?.key).toBe('HIGH');
    expect(ratingBand(25, bands)?.key).toBe('CRITICAL');
    expect(ratingBand(null, bands)).toBeNull();
  });

  it('uses the inherent rating until a residual assessment exists', () => {
    expect(
      rateRisk(
        {
          inherentLikelihood: 4,
          inherentImpact: 4,
          residualLikelihood: null,
          residualImpact: null,
        },
        bands,
      ),
    ).toEqual({
      inherentScore: 16,
      inherentBand: 'CRITICAL',
      residualScore: 16,
      residualBand: 'CRITICAL',
      alert: true,
    });
    expect(
      rateRisk(
        { inherentLikelihood: 4, inherentImpact: 4, residualLikelihood: 2, residualImpact: 2 },
        bands,
      ),
    ).toMatchObject({ residualScore: 4, residualBand: 'LOW', alert: false });
  });

  it('counts risks per heat-map cell and ignores out-of-range values', () => {
    const cells = heatMap([
      { likelihood: 1, impact: 5 },
      { likelihood: 1, impact: 5 },
      { likelihood: 5, impact: 1 },
      { likelihood: 0, impact: 3 },
    ]);
    expect(cells[0][4]).toBe(2);
    expect(cells[4][0]).toBe(1);
    expect(cells.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('treats active (partly) effective controls as protection and flags overdue reviews', () => {
    expect(isEffectiveControl({ status: 'ACTIVE', effectiveness: 'PARTLY' })).toBe(true);
    expect(isEffectiveControl({ status: 'DRAFT', effectiveness: 'EFFECTIVE' })).toBe(false);
    expect(isEffectiveControl({ status: 'ACTIVE', effectiveness: 'NOT_ASSESSED' })).toBe(false);
    const now = new Date('2026-10-30T12:00:00Z');
    expect(isOverdue('2026-10-29', now)).toBe(true);
    expect(isOverdue('2026-11-01', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });
});

describe('GRC settings and inputs', () => {
  it('validates bands (ascending, starting at 1) and unique keys', () => {
    expect(grcSettingsSchema.safeParse(DEFAULT_GRC_SETTINGS).success).toBe(true);
    const bad = { ...DEFAULT_GRC_SETTINGS, bands: [...bands].reverse() };
    expect(grcSettingsSchema.safeParse(bad).success).toBe(false);
    const dup = {
      ...DEFAULT_GRC_SETTINGS,
      categories: [...DEFAULT_GRC_SETTINGS.categories, DEFAULT_GRC_SETTINGS.categories[0]],
    };
    expect(grcSettingsSchema.safeParse(dup).success).toBe(false);
    expect(resolveGrcSettings({ portalVisibility: 'ALL' }).portalVisibility).toBe('ALL');
    expect(resolveGrcSettings({ bands: 'nonsense' })).toEqual(DEFAULT_GRC_SETTINGS);
  });

  it('requires a name, ratings within 1–5 and both residual values together', () => {
    const base = { nameEn: 'Fraud', category: 'FRAUD', inherentLikelihood: 3, inherentImpact: 3 };
    expect(createRiskSchema.safeParse(base).success).toBe(true);
    expect(createRiskSchema.safeParse({ ...base, nameEn: '' }).success).toBe(false);
    expect(createRiskSchema.safeParse({ ...base, inherentImpact: 0 }).success).toBe(false);
    expect(createRiskSchema.safeParse({ ...base, residualLikelihood: 2 }).success).toBe(false);
    expect(
      createRiskSchema.safeParse({ ...base, residualLikelihood: 2, residualImpact: 2 }).success,
    ).toBe(true);
  });

  it('accepts process-level links but no other non-id element', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(
      createLinkSchema.safeParse({ bpmnElementId: '#process', repoObjectId: id }).success,
    ).toBe(true);
    expect(createLinkSchema.safeParse({ bpmnElementId: '#other', repoObjectId: id }).success).toBe(
      false,
    );
  });
});

describe('per-step coverage', () => {
  const rating = (score: number, alert: boolean) => ({
    inherentScore: score,
    inherentBand: null,
    residualScore: score,
    residualBand: alert ? 'HIGH' : 'LOW',
    alert,
  });
  const base = { code: null, nameEn: 'x', nameAr: '', descriptionEn: '', descriptionAr: '' };
  it('flags high risks whose own controls are not effective and risks without any control', () => {
    const s = summariseSteps([
      {
        ...base,
        id: 'r1',
        type: 'RISK',
        status: 'ACTIVE',
        linkId: 'l1',
        bpmnElementId: 'A',
        rating: rating(16, true),
      },
      {
        ...base,
        id: 'c1',
        type: 'CONTROL',
        status: 'ACTIVE',
        linkId: 'l2',
        bpmnElementId: 'A',
        effectiveness: 'NOT_EFFECTIVE',
      },
      {
        ...base,
        id: 'r2',
        type: 'RISK',
        status: 'ACTIVE',
        linkId: 'l3',
        bpmnElementId: 'B',
        rating: rating(12, true),
        effectivelyControlled: true,
      },
      {
        ...base,
        id: 'c2',
        type: 'CONTROL',
        status: 'ACTIVE',
        linkId: 'l4',
        bpmnElementId: 'B',
        effectiveness: 'EFFECTIVE',
      },
      {
        ...base,
        id: 'r3',
        type: 'RISK',
        status: 'ACTIVE',
        linkId: 'l5',
        bpmnElementId: 'C',
        rating: rating(4, false),
      },
      {
        ...base,
        id: 'r4',
        type: 'RISK',
        status: 'RETIRED',
        linkId: 'l6',
        bpmnElementId: 'D',
        rating: rating(25, true),
      },
    ]);
    expect(s.get('A')).toMatchObject({
      risks: 1,
      controls: 1,
      alert: true,
      uncovered: false,
      maxResidualScore: 16,
    });
    expect(s.get('B')).toMatchObject({ alert: false, uncovered: false });
    expect(s.get('C')).toMatchObject({ alert: false, uncovered: true });
    expect(s.has('D')).toBe(false);
  });
});

describe('control-gap rules', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">
    <bpmn:laneSet id="LS"><bpmn:lane id="Lane_Clerk" name="Clerk"><bpmn:flowNodeRef>Task_Submit</bpmn:flowNodeRef><bpmn:flowNodeRef>Task_Approve</bpmn:flowNodeRef></bpmn:lane>
    <bpmn:lane id="Lane_Boss" name="Manager"><bpmn:flowNodeRef>Task_Pay</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:userTask id="Task_Submit" name="Submit request" />
    <bpmn:exclusiveGateway id="Gw" />
    <bpmn:userTask id="Task_Approve" name="Approve request" ph:stepKind="approval" />
    <bpmn:userTask id="Task_Pay" name="Pay" />
    <bpmn:sequenceFlow id="F1" sourceRef="Task_Submit" targetRef="Gw" />
    <bpmn:sequenceFlow id="F2" sourceRef="Gw" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_Approve" targetRef="Task_Pay" />
  </bpmn:process>
</bpmn:definitions>`;
  const base = {
    code: null,
    nameEn: 'x',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    status: 'ACTIVE' as const,
  };
  it('finds high risks, segregation of duties, orphan links, uncovered requirements and missing reviews', () => {
    const graph = parseBpmnGraph(xml);
    const gaps = detectControlGaps(graph, [
      {
        ...base,
        id: 'r1',
        type: 'RISK',
        linkId: '1',
        bpmnElementId: 'Task_Pay',
        rating: {
          inherentScore: 20,
          inherentBand: 'CRITICAL',
          residualScore: 20,
          residualBand: 'CRITICAL',
          alert: true,
        },
        effectivelyControlled: false,
      },
      {
        ...base,
        id: 'c1',
        type: 'CONTROL',
        linkId: '2',
        bpmnElementId: 'Gone',
        effectiveness: 'EFFECTIVE',
      },
      { ...base, id: 'q1', type: 'REQUIREMENT', linkId: '3', bpmnElementId: '#process' },
    ]);
    expect(gaps.map((g) => g.kind).sort()).toEqual(
      [
        'HIGH_RISK_NO_CONTROL',
        'ORPHAN_LINK',
        'REQUIREMENT_NOT_COVERED',
        'SEGREGATION_OF_DUTIES',
      ].sort(),
    );
    expect(gaps.find((g) => g.kind === 'SEGREGATION_OF_DUTIES')?.elementIds).toEqual([
      'Task_Submit',
      'Task_Approve',
    ]);
    const withControl = detectControlGaps(graph, [
      {
        ...base,
        id: 'c2',
        type: 'CONTROL',
        linkId: '4',
        bpmnElementId: 'Task_Pay',
        effectiveness: 'NOT_ASSESSED',
        keyControl: true,
      },
      { ...base, id: 'q1', type: 'REQUIREMENT', linkId: '3', bpmnElementId: '#process' },
    ]);
    expect(withControl.map((g) => g.kind)).toEqual([
      'SEGREGATION_OF_DUTIES',
      'MISSING_REVIEW_EVIDENCE',
    ]);
  });
});

describe('approval of changes (Phase 4.2)', () => {
  it('routes only non-draft items of the configured types while enabled', () => {
    const on = {
      changeApproval: { enabled: true, types: ['RISK' as const], workflowId: null },
    };
    expect(needsChangeApproval('RISK', 'ACTIVE', on)).toBe(true);
    expect(needsChangeApproval('RISK', 'RETIRED', on)).toBe(true);
    expect(needsChangeApproval('RISK', 'DRAFT', on)).toBe(false);
    expect(needsChangeApproval('CONTROL', 'ACTIVE', on)).toBe(false);
    expect(needsChangeApproval('RISK', 'ACTIVE', DEFAULT_GRC_SETTINGS)).toBe(false);
  });

  it('keeps stored settings from before Phase 4.2 valid (approval off)', () => {
    const { changeApproval: _c, ...old } = DEFAULT_GRC_SETTINGS;
    expect(resolveGrcSettings({ ...old, reminderDaysBefore: 7 })).toMatchObject({
      reminderDaysBefore: 7,
      changeApproval: { enabled: false },
    });
  });
});

describe('tested residual (Phase 4.2)', () => {
  const r = { inherentLikelihood: 5, inherentImpact: 4, residualLikelihood: 2, residualImpact: 2 };
  it('keeps the residual only with a control tested (partly) effective', () => {
    expect(testedResidual(r, [{ status: 'ACTIVE', operatingEffectiveness: 'PARTLY' }])).toEqual({
      likelihood: 2,
      impact: 2,
    });
    expect(
      testedResidual(r, [{ status: 'ACTIVE', operatingEffectiveness: 'NOT_EFFECTIVE' }]),
    ).toEqual({
      likelihood: 5,
      impact: 4,
    });
    expect(testedResidual(r, [{ status: 'RETIRED', operatingEffectiveness: 'EFFECTIVE' }])).toEqual(
      {
        likelihood: 5,
        impact: 4,
      },
    );
  });
  it('uses the tested result of a control when it has one', () => {
    expect(
      isEffectiveControl({
        status: 'ACTIVE',
        effectiveness: 'EFFECTIVE',
        operatingEffectiveness: 'NOT_EFFECTIVE',
      }),
    ).toBe(false);
    expect(
      isEffectiveControl({
        status: 'ACTIVE',
        effectiveness: 'NOT_ASSESSED',
        operatingEffectiveness: 'PARTLY',
      }),
    ).toBe(true);
    expect(
      isEffectiveControl({
        status: 'ACTIVE',
        effectiveness: 'EFFECTIVE',
        operatingEffectiveness: 'NOT_ASSESSED',
      }),
    ).toBe(true);
  });
});
