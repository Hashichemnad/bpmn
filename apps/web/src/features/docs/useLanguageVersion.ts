import { useState } from 'react';
import type { Locale, PageDto } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';

/**
 * Which language version of a page to show: the reader's language by default, falling
 * back to the other one when the page has no content in it. The reader can switch.
 */
export function useLanguageVersion(page: Pick<PageDto, 'hasEn' | 'hasAr'> | undefined) {
  const { locale } = useLocale();
  const [chosen, setChosen] = useState<Locale | null>(null);
  const has = (l: Locale) => (l === 'ar' ? !!page?.hasAr : !!page?.hasEn);
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const auto: Locale = has(locale) || !has(other) ? locale : other;
  const lang = chosen ?? auto;
  return { lang, setLang: setChosen, fallback: !chosen && auto !== locale, has };
}

export function pageVersionFor(page: PageDto, lang: Locale) {
  return lang === 'ar'
    ? { title: page.titleAr || page.titleEn, html: page.contentAr, dir: page.dirAr }
    : { title: page.titleEn || page.titleAr, html: page.contentEn, dir: page.dirEn };
}
