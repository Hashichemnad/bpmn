import { describe, expect, it } from 'vitest';
import { detectLocale, exportName, labelAttr, normaliseLabel, pickLabel } from './labels';

describe('bilingual BPMN labels', () => {
  it('maps locales to attributes', () => {
    expect(labelAttr('en')).toBe('nameEn');
    expect(labelAttr('ar')).toBe('nameAr');
  });
  it('picks the active language with fallback', () => {
    const bo = { name: 'x', nameEn: 'Approve', nameAr: 'اعتماد' };
    expect(pickLabel(bo, 'en')).toBe('Approve');
    expect(pickLabel(bo, 'ar')).toBe('اعتماد');
    expect(pickLabel({ nameEn: 'Only EN' }, 'ar')).toBe('Only EN');
    expect(pickLabel({ name: 'Legacy' }, 'ar')).toBe('Legacy');
    expect(pickLabel({}, 'en')).toBe('');
  });
  it('detects Arabic text', () => {
    expect(detectLocale('مراجعة الطلب')).toBe('ar');
    expect(detectLocale('Review request')).toBe('en');
  });
  it('normalises plain names from foreign BPMN files', () => {
    expect(normaliseLabel({ name: 'Review' })).toEqual({ nameEn: 'Review' });
    expect(normaliseLabel({ name: 'مراجعة' })).toEqual({ nameAr: 'مراجعة' });
    expect(normaliseLabel({ name: 'x', nameEn: 'x' })).toBeNull();
    expect(normaliseLabel({})).toBeNull();
  });
  it('exports English first', () => {
    expect(exportName({ name: 'عربي', nameEn: 'English', nameAr: 'عربي' })).toBe('English');
    expect(exportName({ name: 'عربي', nameAr: 'عربي' })).toBe('عربي');
    expect(exportName({})).toBeUndefined();
  });
});
