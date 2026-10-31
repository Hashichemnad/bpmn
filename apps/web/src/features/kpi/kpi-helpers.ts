import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  buildTree,
  type KpiRag,
  type ObjectiveDto,
  type TreeNode,
} from '@processhub/shared';
import { useObjectives } from '@/api/kpi';
import { useLocalized } from '@/components/i18n-helpers';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';

/** What the signed-in user may do with KPIs (the server checks again). */
export function useKpiAccess() {
  const { user, can } = useAuth();
  const canEdit = can(PERMISSIONS.KPI_EDIT);
  return {
    canRead: can(PERMISSIONS.KPI_READ),
    canEdit,
    /** Enter values: editors, or owners with `kpi.measure` for their own KPIs. */
    canMeasure: (k: { owner: { id: string } | null }) =>
      canEdit || (can(PERMISSIONS.KPI_MEASURE) && !!user && k.owner?.id === user.id),
    canMeasureAny: canEdit || can(PERMISSIONS.KPI_MEASURE),
  };
}

export const RAG_HEX: Record<KpiRag, string> = {
  GREEN: '#16a34a',
  AMBER: '#d97706',
  RED: '#dc2626',
};
export const NO_RAG_HEX = '#94a3b8';

export const kpiPath = (id: string) => `/kpis/${id}`;

/** Numbers with the active locale (Intl), the unit after them ("%" without a space). */
export function useFormatValue() {
  const { locale } = useLocale();
  return useCallback(
    (n: number | null | undefined, unit = '') => {
      if (n === null || n === undefined) return '—';
      const s = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
      if (!unit) return s;
      return unit === '%' ? `${s}%` : `${s} ${unit}`;
    },
    [locale],
  );
}

/** "Mar 2026", "Q1 2026", "2026" in the active language. */
export function useFormatPeriod() {
  const { locale } = useLocale();
  const { t } = useTranslation();
  return useCallback(
    (period: string) => {
      const m = /^(\d{4})-(\d{2})$/.exec(period);
      if (m)
        return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
      const q = /^(\d{4})-Q([1-4])$/.exec(period);
      if (q) return t('kpi:period.quarter', { q: q[2], year: q[1] });
      const h = /^(\d{4})-H([12])$/.exec(period);
      if (h) return t('kpi:period.half', { h: h[2], year: h[1] });
      return period;
    },
    [locale, t],
  );
}

/** Objectives as TreeSelect data ("code name"). */
export function useObjectiveTreeData() {
  const objectives = useObjectives();
  const loc = useLocalized();
  type Node = { title: string; value: string; children: Node[] };
  const map = (nodes: TreeNode<ObjectiveDto>[]): Node[] =>
    nodes.map((o) => ({
      title: [o.code, loc(o)].filter(Boolean).join(' · '),
      value: o.id,
      children: map(o.children),
    }));
  return map(buildTree(objectives.data ?? []));
}
