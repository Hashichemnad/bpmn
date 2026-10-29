import type { TFunction } from 'i18next';

/**
 * Minutes as days (24 h), hours and minutes, e.g. "1 d 2 h 30 min" / "1 ي 2 س 30 د"; numbers in
 * the active locale.
 */
export function formatMinutes(minutes: number, t: TFunction, locale: string): string {
  const n = (v: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(v);
  const total = Math.round(minutes);
  if (total === 0) return t('modeler:attributes.short.minutes', { n: n(0) });
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return [
    d && t('modeler:attributes.short.days', { n: n(d) }),
    h && t('modeler:attributes.short.hours', { n: n(h) }),
    m && t('modeler:attributes.short.minutes', { n: n(m) }),
  ]
    .filter(Boolean)
    .join(' ');
}
