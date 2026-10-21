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
  const { locale } = useLocale();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const key = `errors:${err.code}`;
        // Details such as a workflow step's bilingual name are interpolated into the message.
        const details =
          err.details && typeof err.details === 'object'
            ? (err.details as Record<string, unknown>)
            : {};
        const translated = t(key, {
          ...details,
          stepName: localized(details, 'name', locale) || '—',
        });
        return translated === err.code || translated === key ? t('errors:GENERIC') : translated;
      }
      return t('errors:NETWORK');
    },
    [t, locale],
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
