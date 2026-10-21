import type { Locale } from '@processhub/shared';

/** The label-related properties of a BPMN business object. */
export interface LabelHolder {
  name?: string;
  nameEn?: string;
  nameAr?: string;
}

export const labelAttr = (locale: Locale): 'nameEn' | 'nameAr' =>
  locale === 'ar' ? 'nameAr' : 'nameEn';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/;

/** Guesses the language of a plain label (used for BPMN files imported from other tools). */
export function detectLocale(text: string): Locale {
  return ARABIC.test(text) ? 'ar' : 'en';
}

/** Label to display in `locale`, falling back to the other language. */
export function pickLabel(bo: LabelHolder, locale: Locale): string {
  const primary = bo[labelAttr(locale)];
  const secondary = bo[labelAttr(locale === 'ar' ? 'en' : 'ar')];
  if (primary?.trim()) return primary;
  if (secondary?.trim()) return secondary;
  return bo.name ?? '';
}

/**
 * For elements that only have a plain `name` (foreign BPMN), store it under the
 * detected language so it survives language switches. Returns the attributes to set.
 */
export function normaliseLabel(bo: LabelHolder): Partial<LabelHolder> | null {
  if (bo.nameEn || bo.nameAr || !bo.name?.trim()) return null;
  return { [labelAttr(detectLocale(bo.name))]: bo.name };
}

/** Name written to the standard `name` attribute on save, for other BPMN tools (English first). */
export function exportName(bo: LabelHolder): string | undefined {
  return bo.nameEn?.trim() || bo.nameAr?.trim() || bo.name || undefined;
}
