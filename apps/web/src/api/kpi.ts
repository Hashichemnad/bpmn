import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KpiDetailDto,
  KpiDto,
  KpiImportKind,
  KpiImportReportDto,
  KpiSettings,
  KpiTaskDto,
  MeasurementInput,
  ObjectiveDto,
  Paginated,
  ProcessKpisDto,
} from '@processhub/shared';
import { api } from './client';

/** KPIs (Phase 4.3): catalogue, objectives, measurements, process view, tasks, settings. */
export type KpiQuery = Record<string, string | number | boolean | undefined | null>;

export const kpiKeys = {
  all: ['kpis'] as const,
  list: (q: KpiQuery) => ['kpis', 'list', q] as const,
  item: (id: string) => ['kpis', 'one', id] as const,
  objectives: ['kpis', 'objectives'] as const,
  process: (id: string) => ['kpis', 'process', id] as const,
  tasks: ['kpis', 'tasks'] as const,
  settings: ['kpis', 'settings'] as const,
};

export const useKpis = (q: KpiQuery, enabled = true) =>
  useQuery({
    queryKey: kpiKeys.list(q),
    queryFn: () => api<Paginated<KpiDto>>('/kpis', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useKpi = (id: string | undefined) =>
  useQuery({
    queryKey: kpiKeys.item(id ?? ''),
    queryFn: () => api<KpiDetailDto>(`/kpis/${id}`),
    enabled: !!id,
  });

export const useObjectives = (enabled = true) =>
  useQuery({
    queryKey: kpiKeys.objectives,
    queryFn: () => api<ObjectiveDto[]>('/kpis/objectives'),
    enabled,
  });

export const useProcessKpis = (processId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: kpiKeys.process(processId ?? ''),
    queryFn: () => api<ProcessKpisDto>(`/kpis/processes/${processId}`),
    enabled: !!processId && enabled,
  });

export const useKpiTasks = (enabled = true) =>
  useQuery({
    queryKey: kpiKeys.tasks,
    queryFn: () => api<KpiTaskDto[]>('/kpis/tasks'),
    enabled,
    staleTime: 60_000,
  });

export const useKpiSettings = (enabled = true) =>
  useQuery({
    queryKey: kpiKeys.settings,
    queryFn: () => api<KpiSettings>('/kpis/settings'),
    enabled,
    staleTime: 60_000,
  });

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: kpiKeys.all });
  void qc.invalidateQueries({ queryKey: ['objects'] });
};

export function useSaveKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: object }) =>
      api<KpiDetailDto>(`/kpis${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/kpis/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useSaveObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: object }) =>
      api<ObjectiveDto>(`/kpis/objectives${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/kpis/objectives/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useMeasure(kpiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MeasurementInput) =>
      api<KpiDetailDto>(`/kpis/${kpiId}/measurements`, { method: 'PUT', body }),
    onSuccess: (d) => {
      qc.setQueryData(kpiKeys.item(kpiId), d);
      invalidate(qc);
    },
  });
}

export function useDeleteMeasurement(kpiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (measurementId: string) =>
      api<void>(`/kpis/${kpiId}/measurements/${measurementId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUploadEvidence(kpiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ measurementId, file }: { measurementId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api(`/kpis/measurements/${measurementId}/files`, { method: 'POST', body: form });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: kpiKeys.item(kpiId) }),
  });
}

export function useRecalculate(kpiId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<KpiDetailDto>(`/kpis/${kpiId}/recalculate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useSaveKpiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KpiSettings) => api<KpiSettings>('/kpis/settings', { method: 'PUT', body }),
    onSuccess: (s) => qc.setQueryData(kpiKeys.settings, s),
  });
}

export function useKpiImport(kind: KpiImportKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      return api<KpiImportReportDto>(`/kpis/import/${kind}`, {
        method: 'POST',
        body: form,
        query: { dryRun },
      });
    },
    onSuccess: (r) => {
      if (r.imported) invalidate(qc);
    },
  });
}
