import type {
  ApplySuggestionsInput,
  ConformanceResult,
  MiningFilter,
  ProcessLogDto,
  StepSuggestionDto,
  AnalysisRequest,
  AnalysisResponse,
  DiscoverProcessInput,
  DiscoverResultDto,
  FilterPresetDto,
  FilterPresetInput,
  LogAnalysis,
  MiningExportKind,
} from '@processhub/shared';
import { useState } from 'react';
import { apiDownload } from './client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityMappingInput,
  EventLogDto,
  LogActivitiesDto,
  LogGrantDto,
  LogPreviewDto,
  MappingTemplateDto,
  MappingTemplateInput,
  MiningEventDto,
  MiningJobDto,
  MiningMappingInput,
  MiningSettings,
  Paginated,
  ProcessHubLogInput,
  UpdateEventLogInput,
} from '@processhub/shared';
import { api } from './client';

/** Process mining (Phase 5.1): event logs, import, jobs, templates, settings. */
export type MiningQuery = Record<string, string | number | boolean | undefined | null>;

export const miningKeys = {
  all: ['mining'] as const,
  logs: (q: MiningQuery) => ['mining', 'logs', q] as const,
  log: (id: string) => ['mining', 'log', id] as const,
  preview: (id: string, q: MiningQuery) => ['mining', 'preview', id, q] as const,
  activities: (id: string) => ['mining', 'activities', id] as const,
  grants: (id: string) => ['mining', 'grants', id] as const,
  job: (id: string) => ['mining', 'job', id] as const,
  templates: ['mining', 'templates'] as const,
  settings: ['mining', 'settings'] as const,
  caseEvents: (id: string, caseId: string) => ['mining', 'case', id, caseId] as const,
};

export const useEventLogs = (q: MiningQuery, enabled = true) =>
  useQuery({
    queryKey: miningKeys.logs(q),
    queryFn: () => api<Paginated<EventLogDto>>('/mining/logs', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useEventLog = (id: string | undefined) =>
  useQuery({
    queryKey: miningKeys.log(id ?? ''),
    queryFn: () => api<EventLogDto>(`/mining/logs/${id}`),
    enabled: !!id,
    // While an import runs the status changes on the server.
    refetchInterval: (q) =>
      q.state.data?.status === 'IMPORTING' || q.state.data?.job ? 2000 : false,
  });

export const useLogPreview = (id: string | undefined, q: MiningQuery, enabled = true) =>
  useQuery({
    queryKey: miningKeys.preview(id ?? '', q),
    queryFn: () => api<LogPreviewDto>(`/mining/logs/${id}/preview`, { query: q }),
    enabled: !!id && enabled,
    retry: false,
  });

export const useLogActivities = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: miningKeys.activities(id ?? ''),
    queryFn: () => api<LogActivitiesDto>(`/mining/logs/${id}/activities`),
    enabled: !!id && enabled,
  });

export const useLogGrants = (id: string | undefined) =>
  useQuery({
    queryKey: miningKeys.grants(id ?? ''),
    queryFn: () => api<LogGrantDto[]>(`/mining/logs/${id}/grants`),
    enabled: !!id,
  });

export const useCaseEvents = (logId: string | undefined, caseId: string | null) =>
  useQuery({
    queryKey: miningKeys.caseEvents(logId ?? '', caseId ?? ''),
    queryFn: () =>
      api<MiningEventDto[]>(`/mining/logs/${logId}/cases/${encodeURIComponent(caseId ?? '')}`),
    enabled: !!logId && !!caseId,
  });

/** Polls a job (long-poll of 5 s) until it has finished. */
export const useMiningJob = (id: string | null | undefined) =>
  useQuery({
    queryKey: miningKeys.job(id ?? ''),
    queryFn: () => api<MiningJobDto>(`/mining/jobs/${id}`, { query: { wait: 5 } }),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data && ['DONE', 'FAILED', 'CANCELLED'].includes(q.state.data.status) ? false : 300,
  });

export const useMiningTemplates = (enabled = true) =>
  useQuery({
    queryKey: miningKeys.templates,
    queryFn: () => api<MappingTemplateDto[]>('/mining/templates'),
    enabled,
  });

export const useMiningSettings = (enabled = true) =>
  useQuery({
    queryKey: miningKeys.settings,
    queryFn: () => api<MiningSettings>('/mining/settings'),
    enabled,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: miningKeys.all });
}

export function useUploadLog() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { file: File; fields: Record<string, string> }) => {
      const form = new FormData();
      for (const [k, x] of Object.entries(v.fields)) if (x) form.append(k, x);
      form.append('file', v.file);
      return api<EventLogDto>('/mining/logs/upload', { method: 'POST', body: form });
    },
    onSuccess: invalidate,
  });
}

export function useCreateProcessHubLog() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Partial<ProcessHubLogInput>) =>
      api<EventLogDto>('/mining/logs/processhub', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateLog(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateEventLogInput) =>
      api<EventLogDto>(`/mining/logs/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteLog() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<MiningJobDto>(`/mining/logs/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useSaveMapping(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MiningMappingInput) =>
      api<EventLogDto>(`/mining/logs/${id}/mapping`, { method: 'PUT', body }),
    onSuccess: (log) => qc.setQueryData(miningKeys.log(id), log),
  });
}

export function useStartLogJob(id: string, kind: 'validate' | 'import') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<MiningJobDto>(`/mining/logs/${id}/${kind}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: miningKeys.log(id) }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<MiningJobDto>(`/mining/jobs/${id}/cancel`, { method: 'POST' }),
    onSuccess: (job) => qc.setQueryData(miningKeys.job(job.id), job),
  });
}

export function useMapActivities(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ActivityMappingInput) =>
      api<LogActivitiesDto>(`/mining/logs/${id}/activities`, { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(miningKeys.activities(id), data);
      void qc.invalidateQueries({ queryKey: ['mining', 'analysis', id] });
    },
  });
}

export function useAutoMatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<LogActivitiesDto & { matched: number }>(`/mining/logs/${id}/activities/auto-match`, {
        method: 'POST',
      }),
    onSuccess: (data) => qc.setQueryData(miningKeys.activities(id), data),
  });
}

export function useSetGrants(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<LogGrantDto[]>(`/mining/logs/${id}/grants`, { method: 'PUT', body: { userIds } }),
    onSuccess: (data) => qc.setQueryData(miningKeys.grants(id), data),
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MappingTemplateInput) =>
      api<MappingTemplateDto>('/mining/templates', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: miningKeys.templates }),
  });
}

export function useSaveMiningSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MiningSettings) =>
      api<MiningSettings>('/mining/settings', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(miningKeys.settings, data),
  });
}

// ---------- Analysis (step 2) ----------

/**
 * Analysis of a log for a request (filters, activity slider): the server answers from its cache or
 * runs a job; while it runs the job is long-polled and its progress exposed.
 */
export function useAnalysis(logId: string | undefined, request: Partial<AnalysisRequest>) {
  const [job, setJob] = useState<MiningJobDto | null>(null);
  const query = useQuery({
    queryKey: ['mining', 'analysis', logId ?? '', request],
    queryFn: async ({ signal }) => {
      for (;;) {
        const res = await api<AnalysisResponse<LogAnalysis>>(`/mining/logs/${logId}/analysis`, {
          method: 'POST',
          body: request,
          signal,
        });
        if (res.status === 'DONE' && res.result) {
          setJob(null);
          return res.result;
        }
        let j = res.job!;
        setJob(j);
        while (j.status === 'QUEUED' || j.status === 'RUNNING') {
          j = await api<MiningJobDto>(`/mining/jobs/${j.id}`, { query: { wait: 5 }, signal });
          setJob(j);
        }
        if (j.status !== 'DONE') throw new Error(j.error ?? j.status);
      }
    },
    enabled: !!logId,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  return { ...query, job };
}

export const useFilterPresets = (logId: string) =>
  useQuery({
    queryKey: ['mining', 'presets', logId],
    queryFn: () => api<FilterPresetDto[]>(`/mining/logs/${logId}/presets`),
  });

export function useSavePreset(logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FilterPresetInput) =>
      api<FilterPresetDto>(`/mining/logs/${logId}/presets`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mining', 'presets', logId] }),
  });
}

export function useDeletePreset(logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/mining/presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mining', 'presets', logId] }),
  });
}

export function useDiscover(logId: string) {
  return useMutation({
    mutationFn: (body: Partial<DiscoverProcessInput>) =>
      api<DiscoverResultDto>(`/mining/logs/${logId}/discover`, { method: 'POST', body }),
  });
}

export async function exportAnalysis(
  logId: string,
  kind: MiningExportKind,
  request: Partial<AnalysisRequest>,
) {
  const file = await apiDownload(
    `/mining/logs/${logId}/export`,
    { method: 'POST', body: { kind, request } },
    `${kind}.xlsx`,
  );
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Conformance (step 3) ----------

export const useProcessLogs = (processId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['mining', 'process-logs', processId ?? ''],
    queryFn: () => api<ProcessLogDto[]>(`/mining/processes/${processId}/logs`),
    enabled: !!processId && enabled,
  });

/** Conformance of a log (cached on the server; long-polls the job when it runs). */
export function useConformance(logId: string | undefined, filters: MiningFilter[] = []) {
  const [job, setJob] = useState<MiningJobDto | null>(null);
  const query = useQuery({
    queryKey: ['mining', 'analysis', logId ?? '', 'conformance', filters],
    queryFn: async ({ signal }) => {
      for (;;) {
        const res = await api<AnalysisResponse<ConformanceResult>>(
          `/mining/logs/${logId}/conformance`,
          {
            method: 'POST',
            body: { filters },
            signal,
          },
        );
        if (res.status === 'DONE' && res.result) {
          setJob(null);
          return res.result;
        }
        let j = res.job!;
        setJob(j);
        while (j.status === 'QUEUED' || j.status === 'RUNNING') {
          j = await api<MiningJobDto>(`/mining/jobs/${j.id}`, { query: { wait: 5 }, signal });
          setJob(j);
        }
        if (j.status !== 'DONE') throw new Error(j.error ?? j.status);
      }
    },
    enabled: !!logId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { ...query, job };
}

export const useStepSuggestions = (logId: string, enabled = true) =>
  useQuery({
    queryKey: ['mining', 'analysis', logId, 'suggestions'],
    queryFn: () => api<StepSuggestionDto[]>(`/mining/logs/${logId}/step-suggestions`),
    enabled,
    retry: false,
  });

export function useApplySuggestions(logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApplySuggestionsInput) =>
      api<{ processId: string }>(`/mining/logs/${logId}/step-suggestions/apply`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mining', 'analysis', logId] }),
  });
}

export function useRecalculateMiningKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kpiId: string) =>
      api<MiningJobDto>(`/mining/kpis/${kpiId}/recalculate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kpis'] }),
  });
}
