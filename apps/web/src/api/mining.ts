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
