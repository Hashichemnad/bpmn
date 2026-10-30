import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRC_SETTINGS,
  createLinkSchema,
  createRiskSchema,
  grcSettingsSchema,
  heatMap,
  isEffectiveControl,
  isOverdue,
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
