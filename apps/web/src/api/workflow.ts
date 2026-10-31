import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CaseCommentDto,
  CaseDetailDto,
  CaseFileDto,
  CaseSummaryDto,
  CatalogueItemDto,
  CompleteTaskInput,
  ExecCheckDto,
  MonitorDto,
  OutOfOfficeDto,
  OutOfOfficeInput,
  Paginated,
  StartFormDto,
  UserRef,
  WfTaskDetailDto,
  WfTaskSummaryDto,
  WorkflowConfigDto,
  WorkflowConfigInput,
  WorkflowDashboardDto,
  WorkflowSettings,
} from '@processhub/shared';
import { api } from './client';

/** Workflow execution (Phase 5.2): execution settings, cases, tasks, monitor. */
export type WfQuery = Record<string, string | number | boolean | undefined | null>;

export const wfKeys = {
  all: ['workflow'] as const,
  config: (processId: string) => ['workflow', 'config', processId] as const,
  settings: ['workflow', 'settings'] as const,
  catalogue: ['workflow', 'catalogue'] as const,
  startForm: (processId: string) => ['workflow', 'start', processId] as const,
  cases: (q: WfQuery) => ['workflow', 'cases', q] as const,
  case: (id: string) => ['workflow', 'case', id] as const,
  tasks: (q: WfQuery) => ['workflow', 'tasks', q] as const,
  task: (id: string) => ['workflow', 'task', id] as const,
  counts: ['workflow', 'counts'] as const,
  ooo: ['workflow', 'ooo'] as const,
  monitor: ['workflow', 'monitor'] as const,
  dashboard: (q: WfQuery) => ['workflow', 'dashboard', q] as const,
  departments: ['workflow', 'departments'] as const,
};

const useInvalidateAll = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: wfKeys.all });
};

// ---------- Execution settings ----------

export const useWorkflowConfig = (processId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: wfKeys.config(processId ?? ''),
    queryFn: () => api<WorkflowConfigDto>(`/workflow/processes/${processId}/config`),
    enabled: !!processId && enabled,
  });

export function useSaveWorkflowConfig(processId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowConfigInput) =>
      api<WorkflowConfigDto>(`/workflow/processes/${processId}/config`, { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(wfKeys.config(processId), data),
  });
}

export function useDeployWorkflow(processId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<WorkflowConfigDto>(`/workflow/processes/${processId}/deploy`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.setQueryData(wfKeys.config(processId), data);
      void qc.invalidateQueries({ queryKey: wfKeys.catalogue });
    },
  });
}

export const checkExecutableOnServer = (
  processId: string,
  body: { source: 'working' | 'published'; xml?: string },
) => api<ExecCheckDto>(`/workflow/processes/${processId}/check`, { method: 'POST', body });

export const useWorkflowSettings = (enabled = true) =>
  useQuery({
    queryKey: wfKeys.settings,
    queryFn: () => api<WorkflowSettings>('/workflow/settings'),
    enabled,
  });

export function useSaveWorkflowSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowSettings) =>
      api<WorkflowSettings>('/workflow/settings', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(wfKeys.settings, data),
  });
}

// ---------- Catalogue and start ----------

export const useCatalogue = (enabled = true) =>
  useQuery({
    queryKey: wfKeys.catalogue,
    queryFn: () => api<CatalogueItemDto[]>('/workflow/catalogue'),
    enabled,
  });

export const useStartForm = (processId: string | undefined) =>
  useQuery({
    queryKey: wfKeys.startForm(processId ?? ''),
    queryFn: () => api<StartFormDto>(`/workflow/catalogue/${processId}`),
    enabled: !!processId,
  });

export function useStartCase(processId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: { data: Record<string, unknown>; fileIds?: string[] }) =>
      api<{ id: string; number: string }>(`/workflow/catalogue/${processId}/start`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void invalidate(),
  });
}

// ---------- Cases ----------

export const useCases = (q: WfQuery, enabled = true) =>
  useQuery({
    queryKey: wfKeys.cases(q),
    queryFn: () => api<Paginated<CaseSummaryDto>>('/workflow/cases', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useCase = (id: string | undefined) =>
  useQuery({
    queryKey: wfKeys.case(id ?? ''),
    queryFn: () => api<CaseDetailDto>(`/workflow/cases/${id}`),
    enabled: !!id,
    // Asynchronous steps (documents, timers) finish in the background.
    refetchInterval: (q) =>
      q.state.data?.status === 'RUNNING' && !q.state.data.tasks.some((t) => t.status === 'OPEN')
        ? 3000
        : false,
  });

export function useCaseAction(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (a: { action: 'withdraw' | 'cancel' | 'retry'; reason?: string }) =>
      api<void>(`/workflow/cases/${id}/${a.action}`, {
        method: 'POST',
        body: a.action === 'retry' ? {} : { reason: a.reason },
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useAddCaseComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<CaseCommentDto>(`/workflow/cases/${id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: wfKeys.case(id) }),
  });
}

/** Uploads an attachment (for a case, or a draft for a start form). */
export async function uploadWorkflowFile(
  file: File,
  opts: { caseId?: string; taskId?: string } = {},
): Promise<CaseFileDto> {
  const form = new FormData();
  form.append('file', file);
  if (opts.caseId) form.append('caseId', opts.caseId);
  if (opts.taskId) form.append('taskId', opts.taskId);
  return api<CaseFileDto>('/workflow/files', { method: 'POST', body: form });
}

export const workflowFileUrl = (id: string) => `/api/v1/workflow/files/${id}`;

// ---------- Tasks ----------

export const useWfTasks = (q: WfQuery, enabled = true) =>
  useQuery({
    queryKey: wfKeys.tasks(q),
    queryFn: () => api<Paginated<WfTaskSummaryDto>>('/workflow/tasks', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: 60_000,
  });

export const useWfTaskCounts = (enabled = true) =>
  useQuery({
    queryKey: wfKeys.counts,
    queryFn: () => api<{ mine: number; group: number; overdue: number }>('/workflow/tasks/counts'),
    enabled,
    refetchInterval: 60_000,
  });

export const useWfTask = (id: string | undefined) =>
  useQuery({
    queryKey: wfKeys.task(id ?? ''),
    queryFn: () => api<WfTaskDetailDto>(`/workflow/tasks/${id}`),
    enabled: !!id,
  });

export function useTaskAction(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (
      a:
        | { action: 'claim' | 'unclaim' }
        | { action: 'complete'; body: CompleteTaskInput }
        | { action: 'draft'; data: Record<string, unknown> }
        | { action: 'delegate' | 'reassign'; userId: string; comment: string },
    ) => {
      if (a.action === 'complete')
        return api<unknown>(`/workflow/tasks/${id}/complete`, { method: 'POST', body: a.body });
      if (a.action === 'draft')
        return api<unknown>(`/workflow/tasks/${id}/draft`, {
          method: 'PUT',
          body: { data: a.data },
        });
      if (a.action === 'delegate' || a.action === 'reassign')
        return api<unknown>(`/workflow/tasks/${id}/${a.action}`, {
          method: 'POST',
          body: { userId: a.userId, comment: a.comment },
        });
      return api<unknown>(`/workflow/tasks/${id}/${a.action}`, { method: 'POST' });
    },
    onSuccess: () => void invalidate(),
  });
}

// ---------- Users, departments, out of office ----------

export const searchWorkflowUsers = (q: string) =>
  api<UserRef[]>('/workflow/users', { query: { q } });

export const useWorkflowDepartments = () =>
  useQuery({
    queryKey: wfKeys.departments,
    queryFn: () =>
      api<{ id: string; nameEn: string; nameAr: string; parentId: string | null }[]>(
        '/workflow/departments',
      ),
    staleTime: 5 * 60_000,
  });

export const useOutOfOffice = () =>
  useQuery({ queryKey: wfKeys.ooo, queryFn: () => api<OutOfOfficeDto>('/workflow/out-of-office') });

export function useSaveOutOfOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OutOfOfficeInput) =>
      api<OutOfOfficeDto>('/workflow/out-of-office', { method: 'PUT', body }),
    onSuccess: (d) => qc.setQueryData(wfKeys.ooo, d),
  });
}

// ---------- Monitor and dashboard ----------

export const useWorkflowMonitor = (enabled = true) =>
  useQuery({
    queryKey: wfKeys.monitor,
    queryFn: () => api<MonitorDto>('/workflow/monitor'),
    enabled,
    refetchInterval: 60_000,
  });

export const useWorkflowDashboard = (q: WfQuery, enabled = true) =>
  useQuery({
    queryKey: wfKeys.dashboard(q),
    queryFn: () => api<WorkflowDashboardDto>('/workflow/dashboard', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });
