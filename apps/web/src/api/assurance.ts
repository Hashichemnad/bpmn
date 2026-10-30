import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssuranceSettings,
  AssuranceTasksDto,
  CreateIssueInput,
  IssueActionInput,
  IssueDetailDto,
  IssueDto,
  IssueTransitionInput,
  UpdateIssueInput,
  ControlTestDetailDto,
  ControlTestDto,
  CreateControlTestInput,
  CreateTestPlanInput,
  GrcChangeDecisionInput,
  GrcChangeDto,
  Paginated,
  TestPlanDto,
  UpdateTestPlanInput,
} from '@processhub/shared';
import { api } from './client';
import { grcKeys } from './grc';

/** Assurance (Phase 4.2): change approvals, control tests, issues, audits, surveys. */
export const assuranceKeys = {
  all: ['assurance'] as const,
  tasks: ['assurance', 'tasks'] as const,
  changes: (q: Record<string, string | undefined>) => ['assurance', 'changes', q] as const,
};

export const useGrcChanges = (q: Record<string, string | undefined>, enabled = true) =>
  useQuery({
    queryKey: assuranceKeys.changes(q),
    queryFn: () =>
      api<GrcChangeDto[]>(
        `/grc/changes?${new URLSearchParams(
          Object.entries(q).filter((e): e is [string, string] => !!e[1]),
        )}`,
      ),
    enabled,
  });

export function useDecideGrcChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: GrcChangeDecisionInput }) =>
      api<GrcChangeDto>(`/grc/changes/${id}/decision`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: grcKeys.all });
      void qc.invalidateQueries({ queryKey: assuranceKeys.all });
    },
  });
}

export function useWithdrawGrcChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<GrcChangeDto>(`/grc/changes/${id}/withdraw`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: grcKeys.all });
      void qc.invalidateQueries({ queryKey: assuranceKeys.all });
    },
  });
}

export const useAssuranceTasks = (enabled = true) =>
  useQuery({
    queryKey: assuranceKeys.tasks,
    queryFn: () => api<AssuranceTasksDto>('/assurance/tasks'),
    refetchInterval: 60_000,
    enabled,
  });

/** Number of open assurance tasks (menu badge). */
export const assuranceTaskCount = (d: AssuranceTasksDto | undefined) =>
  d ? Object.values(d).reduce((n, list) => n + (list as unknown[]).length, 0) : 0;

// ---------- Control testing ----------

export const testKeys = {
  all: ['assurance', 'tests'] as const,
  plans: (controlId?: string) => ['assurance', 'tests', 'plans', controlId ?? ''] as const,
  list: (q: Record<string, unknown>) => ['assurance', 'tests', 'list', q] as const,
  one: (id: string) => ['assurance', 'tests', 'one', id] as const,
};

const qs = (q: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const useTestPlans = (controlId: string | undefined) =>
  useQuery({
    queryKey: testKeys.plans(controlId),
    queryFn: () => api<TestPlanDto[]>(`/control-tests/plans?${qs({ controlId })}`),
    enabled: !!controlId,
  });

/** Invalidates everything assurance and GRC related after a change (lists, tasks, effectiveness). */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: assuranceKeys.all });
    void qc.invalidateQueries({ queryKey: grcKeys.all });
  };
}

export function useSaveTestPlan() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateTestPlanInput | UpdateTestPlanInput }) =>
      id
        ? api<TestPlanDto>(`/control-tests/plans/${id}`, { method: 'PATCH', body })
        : api<TestPlanDto>('/control-tests/plans', { method: 'POST', body }),
    onSuccess: done,
  });
}

export function useDeleteTestPlan() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/control-tests/plans/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });
}

export const useControlTests = (q: Record<string, unknown>, enabled = true) =>
  useQuery({
    queryKey: testKeys.list(q),
    queryFn: () => api<Paginated<ControlTestDto>>(`/control-tests?${qs(q)}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useControlTest = (id: string | undefined) =>
  useQuery({
    queryKey: testKeys.one(id ?? ''),
    queryFn: () => api<ControlTestDetailDto>(`/control-tests/${id}`),
    enabled: !!id,
  });

export function useCreateControlTest() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (body: CreateControlTestInput) =>
      api<ControlTestDetailDto>('/control-tests', { method: 'POST', body }),
    onSuccess: done,
  });
}

/** Lifecycle actions of a test: start, results, submit, review, close, comment, evidence. */
export function useControlTestAction(id: string) {
  const qc = useQueryClient();
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      action,
      body,
    }: {
      action: 'start' | 'results' | 'submit' | 'review' | 'close' | 'comments' | 'files' | 'delete';
      body?: unknown;
    }) => {
      if (action === 'results')
        return api<ControlTestDetailDto>(`/control-tests/${id}/results`, { method: 'PUT', body });
      if (action === 'delete') return api<void>(`/control-tests/${id}`, { method: 'DELETE' });
      if (action === 'files') {
        const form = new FormData();
        form.append('file', body as File);
        return api<unknown>(`/control-tests/${id}/files`, { method: 'POST', body: form });
      }
      return api<unknown>(`/control-tests/${id}/${action}`, { method: 'POST', body });
    },
    onSuccess: (data, { action }) => {
      if (data && typeof data === 'object' && 'status' in data && action !== 'comments')
        qc.setQueryData(testKeys.one(id), data);
      done();
    },
  });
}

export function useDeleteAssuranceFile() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/assurance/files/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });
}

// ---------- Settings, issues and actions ----------

export const useAssuranceSettings = (enabled = true) =>
  useQuery({
    queryKey: ['assurance', 'settings'],
    queryFn: () => api<AssuranceSettings>('/assurance/settings'),
    staleTime: 60_000,
    enabled,
  });

export function useSaveAssuranceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssuranceSettings) =>
      api<AssuranceSettings>('/assurance/settings', { method: 'PUT', body }),
    onSuccess: (s) => qc.setQueryData(['assurance', 'settings'], s),
  });
}

export const issueKeys = {
  list: (q: Record<string, unknown>) => ['assurance', 'issues', 'list', q] as const,
  one: (id: string) => ['assurance', 'issues', 'one', id] as const,
};

export const useIssues = (q: Record<string, unknown>, enabled = true) =>
  useQuery({
    queryKey: issueKeys.list(q),
    queryFn: () => api<Paginated<IssueDto>>(`/issues?${qs(q)}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useIssue = (id: string | undefined) =>
  useQuery({
    queryKey: issueKeys.one(id ?? ''),
    queryFn: () => api<IssueDetailDto>(`/issues/${id}`),
    enabled: !!id,
  });

export function useSaveIssue() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateIssueInput | UpdateIssueInput }) =>
      id
        ? api<IssueDetailDto>(`/issues/${id}`, { method: 'PATCH', body })
        : api<IssueDetailDto>('/issues', { method: 'POST', body }),
    onSuccess: done,
  });
}

/** Issue lifecycle, comments, actions and evidence. */
export function useIssueAction(issueId: string) {
  const qc = useQueryClient();
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (
      a:
        | { kind: 'transition'; body: IssueTransitionInput }
        | { kind: 'comment'; body: string }
        | { kind: 'addAction'; body: IssueActionInput }
        | { kind: 'updateAction'; actionId: string; body: IssueActionInput }
        | { kind: 'removeAction'; actionId: string }
        | { kind: 'file'; file: File; actionId?: string },
    ): Promise<unknown> => {
      switch (a.kind) {
        case 'transition':
          return api(`/issues/${issueId}/transition`, { method: 'POST', body: a.body });
        case 'comment':
          return api(`/issues/${issueId}/comments`, { method: 'POST', body: { body: a.body } });
        case 'addAction':
          return api(`/issues/${issueId}/actions`, { method: 'POST', body: a.body });
        case 'updateAction':
          return api(`/issues/actions/${a.actionId}`, { method: 'PATCH', body: a.body });
        case 'removeAction':
          return api(`/issues/actions/${a.actionId}`, { method: 'DELETE' });
        case 'file': {
          const form = new FormData();
          form.append('file', a.file);
          return api(
            a.actionId ? `/issues/actions/${a.actionId}/files` : `/issues/${issueId}/files`,
            { method: 'POST', body: form },
          );
        }
      }
    },
    onSuccess: (data) => {
      if (data && typeof data === 'object' && 'code' in data && 'actions' in data)
        qc.setQueryData(issueKeys.one(issueId), data);
      done();
    },
  });
}
