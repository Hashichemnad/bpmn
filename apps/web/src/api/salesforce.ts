import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SalesforceFieldDto,
  SalesforcePreviewDto,
  SalesforceRunDto,
  SalesforceSettingsDto,
  SalesforceSettingsInput,
  SalesforceTestResultDto,
} from '@processhub/shared';
import { api } from './client';

/** Salesforce KPI link (Phase 4.3): Super Admin settings, preview, sync, runs. */
const KEY = ['salesforce'] as const;

export const useSalesforceSettings = () =>
  useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: () => api<SalesforceSettingsDto>('/integrations/salesforce'),
  });

export const useSalesforceRuns = () =>
  useQuery({
    queryKey: [...KEY, 'runs'],
    queryFn: () => api<SalesforceRunDto[]>('/integrations/salesforce/runs'),
  });

export function useSaveSalesforce() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SalesforceSettingsInput) =>
      api<SalesforceSettingsDto>('/integrations/salesforce', { method: 'PUT', body }),
    onSuccess: (d) => qc.setQueryData([...KEY, 'settings'], d),
  });
}

export const useTestSalesforce = () =>
  useMutation({
    mutationFn: () =>
      api<SalesforceTestResultDto>('/integrations/salesforce/test', { method: 'POST' }),
  });

export const useDescribeSalesforce = () =>
  useMutation({
    mutationFn: (object: string) =>
      api<SalesforceFieldDto[]>(`/integrations/salesforce/describe/${encodeURIComponent(object)}`),
  });

export const usePreviewSalesforce = () =>
  useMutation({
    mutationFn: () =>
      api<SalesforcePreviewDto>('/integrations/salesforce/preview', { method: 'POST' }),
  });

export function useRunSalesforce() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SalesforceRunDto>('/integrations/salesforce/sync', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}
