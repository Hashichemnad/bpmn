import { describe, expect, it } from 'vitest';
import { aiSettingsSchema, matchByName, normalizeTerm } from './ai';

describe('AI terminology helpers', () => {
  it('normalises Arabic and English names', () => {
    expect(normalizeTerm('  The IT-Support Team ')).toBe('it support team');
    expect(normalizeTerm('إدارة المُشتريات')).toBe(normalizeTerm('ادارة المشتريات'));
    expect(normalizeTerm('الموارد البشرية')).toBe(normalizeTerm('الموارد البشريه'));
  });

  it('matches library entries exactly or by contained words, never ambiguously', () => {
    const lib = [
      { id: 1, code: 'R01', nameEn: 'HR Officer', nameAr: 'موظف الموارد البشرية' },
      { id: 2, code: 'R02', nameEn: 'IT Support', nameAr: 'الدعم الفني' },
      { id: 3, code: null, nameEn: 'Finance Manager', nameAr: 'المدير المالي' },
      { id: 4, code: null, nameEn: 'Purchasing Manager', nameAr: 'مدير المشتريات' },
    ];
    expect(matchByName({ en: 'hr officer', ar: '' }, lib)?.id).toBe(1);
    expect(matchByName({ en: '', ar: 'الدعم الفنى' }, lib)?.id).toBe(2);
    expect(matchByName({ en: 'IT Support team', ar: '' }, lib)?.id).toBe(2);
    expect(matchByName({ en: 'R02', ar: '' }, lib)?.id).toBe(2);
    expect(matchByName({ en: 'Manager', ar: '' }, lib)).toBeNull();
    expect(matchByName({ en: 'Legal Counsel', ar: '' }, lib)).toBeNull();
    expect(matchByName({ en: '', ar: '' }, lib)).toBeNull();
  });

  it('validates AI settings', () => {
    const base = {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      fastModel: 'claude-haiku-5-5',
      allowedRoles: ['MODELER'],
      userDailyLimit: 10,
      orgMonthlyLimit: 0,
      noticeEn: '',
      noticeAr: '',
    };
    expect(aiSettingsSchema.safeParse(base).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ ...base, model: 'bad model;' }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ ...base, provider: 'other' }).success).toBe(false);
    expect(
      aiSettingsSchema.safeParse({ ...base, suggestions: { PORTAL_QA: [{ en: '', ar: '' }] } })
        .success,
    ).toBe(false);
  });
});
