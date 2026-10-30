import { NOTIFICATION_TYPES } from '@processhub/shared';
import { KIND_TEMPLATES, renderEmail } from './email-templates';
import { effectivePrefs } from './notifications.service';

describe('notification emails', () => {
  const params = {
    titleEn: 'Order <handling>',
    titleAr: 'معالجة الطلبات',
    code: 'C.02',
    actorEn: 'Sara',
    actorAr: 'سارة',
    stepEn: 'Review',
    stepAr: 'مراجعة',
    version: 3,
    comment: 'Fix <b>step 2</b>',
  };

  it('renders every type in both languages without leftover placeholders', () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const locale of ['en', 'ar'] as const) {
        const m = renderEmail(
          type,
          { ...params, due: '2026-11-01T00:00:00Z', kind: 'task' },
          locale,
          'http://x/y',
        );
        expect(m.subject).not.toMatch(/\{\w+\}/);
        expect(m.text).not.toMatch(/\{\w+\}/);
        expect(m.subject.length).toBeGreaterThan(3);
      }
    }
  });

  it('uses the recipient language and direction, and escapes content', () => {
    const en = renderEmail('CHANGES_REQUESTED', params, 'en', 'http://hub/processes/1');
    expect(en.subject).toBe('Changes requested: C.02 Order <handling>');
    expect(en.html).toContain('Order &lt;handling&gt;');
    expect(en.html).toContain('Fix &lt;b&gt;step 2&lt;/b&gt;');
    expect(en.html).not.toContain('<b>step');
    expect(en.html).toContain('href="http://hub/processes/1"');

    const ar = renderEmail('REVIEW_REQUESTED', params, 'ar', null);
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.text).toContain('معالجة الطلبات');
    expect(ar.text).toContain('سارة');
    expect(ar.text).toContain('مراجعة');
  });

  it('periodic and task overdue reminders differ', () => {
    const task = renderEmail(
      'REVIEW_OVERDUE',
      { ...params, due: '2026-11-01', kind: 'task' },
      'en',
      null,
    );
    const periodic = renderEmail(
      'REVIEW_OVERDUE',
      { ...params, due: '2026-11-01', kind: 'periodic' },
      'en',
      null,
    );
    expect(task.text).toContain('Your review');
    expect(periodic.text).toContain('periodic review');
    expect(periodic.text).toContain('1 November 2026');
  });

  it('preferences default to on and keep explicit choices', () => {
    const p = effectivePrefs({ MENTIONED: { inApp: true, email: false } });
    expect(p.MENTIONED).toEqual({ inApp: true, email: false });
    expect(p.PUBLISHED).toEqual({ inApp: true, email: true });
  });

  it('has a text for every kind of the Phase 4.2 types in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      const keys = Object.keys(KIND_TEMPLATES[locale]);
      expect(keys.sort()).toEqual(Object.keys(KIND_TEMPLATES.en).sort());
      for (const key of keys) {
        const [type, kind] = key.split(':');
        const m = renderEmail(
          type as never,
          { ...params, kind, due: '2026-11-01', period: '2026-Q4' },
          locale,
          null,
        );
        expect(m.subject).not.toMatch(/\{\w+\}/);
        expect(m.text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
