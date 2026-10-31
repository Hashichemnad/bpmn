import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';

export const logPath = (id: string, tab?: string) => `/mining/logs/${id}${tab ? `/${tab}` : ''}`;

export function useMiningAccess() {
  const { can } = useAuth();
  return {
    canRead: can(PERMISSIONS.MINING_READ),
    canManage: can(PERMISSIONS.MINING_MANAGE),
    canSettings: can(PERMISSIONS.SETTINGS_MANAGE),
  };
}

/** Durations (ms) as "2 d 4 h", "35 min", "12 s" in the active language. */
export function useFormatDuration() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  return useCallback(
    (ms: number | null | undefined) => {
      if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
      const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
      const abs = Math.abs(ms);
      const min = abs / 60_000;
      if (min < 1) return t('mining:units.s', { n: nf.format(abs / 1000) });
      if (min < 60) return t('mining:units.min', { n: nf.format(min) });
      const h = min / 60;
      if (h < 24) return t('mining:units.h', { n: nf.format(h) });
      const d = Math.floor(h / 24);
      const rest = Math.round(h - d * 24);
      return rest
        ? t('mining:units.dh', { d: nf.format(d), h: nf.format(rest) })
        : t('mining:units.d', { n: nf.format(d) });
    },
    [t, locale],
  );
}

export function usePercent() {
  const { locale } = useLocale();
  return useCallback(
    (v: number | null | undefined, digits = 1) =>
      v === null || v === undefined || !Number.isFinite(v)
        ? '—'
        : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits }).format(
            v,
          ),
    [locale],
  );
}
