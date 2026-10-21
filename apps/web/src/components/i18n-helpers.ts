import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { localized } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { ApiError } from '@/api/client';

/** Returns a function that reads `${field}En/Ar` in the active language with fallback. */
export function useLocalized() {
  const { locale } = useLocale();
  return useCallback(
    (entity: Record<string, unknown> | object | null | undefined, field = 'name') =>
      localized(entity as Record<string, unknown> | null | undefined, field, locale),
    [locale],
  );
}

/** Translates an API error code into a user-facing message. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const key = `errors:${err.code}`;
        const translated = t(key);
        return translated === err.code || translated === key ? t('errors:GENERIC') : translated;
      }
      return t('errors:NETWORK');
    },
    [t],
  );
}

/** Formats dates with Intl in the active locale. */
export function useFormatDate() {
  const { locale } = useLocale();
  return useCallback(
    (iso: string | null | undefined, withTime = true) => {
      if (!iso) return '—';
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
        dateStyle: 'medium',
        ...(withTime ? { timeStyle: 'short' } : {}),
      }).format(new Date(iso));
    },
    [locale],
  );
}

export function useFormatNumber() {
  const { locale } = useLocale();
  return useCallback((n: number) => new Intl.NumberFormat(locale).format(n), [locale]);
}
