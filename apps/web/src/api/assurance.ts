import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssuranceDashboardDto,
  AssuranceFileDto,
  CampaignDetailDto,
  CampaignDto,
  CampaignResultsDto,
  CreateCampaignInput,
  CreateQuestionnaireInput,
  FeedbackRequestInput,
  MyResponseDto,
  QuestionnaireDto,
  SaveAnswersInput,
  SurveyProposalDto,
  UpdateCampaignInput,
  UpdateQuestionnaireInput,
  AuditEngagementDetailDto,
  AuditEngagementDto,
  AuditFindingDto,
  AuditUniverseRow,
  CreateEngagementInput,
  CreateFindingInput,
  EngagementStatusInput,
  FindingResponseInput,
  UpdateEngagementInput,
  UpdateFindingInput,
  WorkItemInput,
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

// ---------- Audits ----------

export const auditKeys = {
  universe: (year: number) => ['assurance', 'audits', 'universe', year] as const,
  list: (q: Record<string, unknown>) => ['assurance', 'audits', 'list', q] as const,
  one: (id: string) => ['assurance', 'audits', 'one', id] as const,
  finding: (id: string) => ['assurance', 'audits', 'finding', id] as const,
};

export const useAuditUniverse = (year: number) =>
  useQuery({
    queryKey: auditKeys.universe(year),
    queryFn: () => api<AuditUniverseRow[]>(`/audits/universe?year=${year}`),
  });

export const useEngagements = (q: Record<string, unknown>) =>
  useQuery({
    queryKey: auditKeys.list(q),
    queryFn: () => api<AuditEngagementDto[]>(`/audits?${qs(q)}`),
    placeholderData: keepPreviousData,
  });

export const useEngagement = (id: string | undefined) =>
  useQuery({
    queryKey: auditKeys.one(id ?? ''),
    queryFn: () => api<AuditEngagementDetailDto>(`/audits/${id}`),
    enabled: !!id,
  });

export const useFinding = (id: string | undefined) =>
  useQuery({
    queryKey: auditKeys.finding(id ?? ''),
    queryFn: () => api<AuditFindingDto>(`/audits/findings/${id}`),
    enabled: !!id,
  });

export function useSaveEngagement() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: CreateEngagementInput | UpdateEngagementInput;
    }) =>
      id
        ? api<AuditEngagementDetailDto>(`/audits/${id}`, { method: 'PATCH', body })
        : api<AuditEngagementDetailDto>('/audits', { method: 'POST', body }),
    onSuccess: done,
  });
}

/** Engagement actions: status, comments, work items, findings, responses and evidence. */
export function useEngagementAction(engagementId: string) {
  const qc = useQueryClient();
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (
      a:
        | { kind: 'status'; body: EngagementStatusInput }
        | { kind: 'comment'; body: string }
        | { kind: 'addItem'; body: WorkItemInput }
        | { kind: 'updateItem'; id: string; body: WorkItemInput }
        | { kind: 'removeItem'; id: string }
        | { kind: 'addFinding'; body: CreateFindingInput }
        | { kind: 'updateFinding'; id: string; body: UpdateFindingInput }
        | { kind: 'removeFinding'; id: string }
        | { kind: 'respond'; id: string; body: FindingResponseInput }
        | { kind: 'itemFile' | 'findingFile'; id: string; file: File }
        | { kind: 'delete' },
    ): Promise<unknown> => {
      const form = (file: File) => {
        const f = new FormData();
        f.append('file', file);
        return f;
      };
      switch (a.kind) {
        case 'status':
          return api(`/audits/${engagementId}/status`, { method: 'POST', body: a.body });
        case 'comment':
          return api(`/audits/${engagementId}/comments`, {
            method: 'POST',
            body: { body: a.body },
          });
        case 'addItem':
          return api(`/audits/${engagementId}/items`, { method: 'POST', body: a.body });
        case 'updateItem':
          return api(`/audits/items/${a.id}`, { method: 'PATCH', body: a.body });
        case 'removeItem':
          return api(`/audits/items/${a.id}`, { method: 'DELETE' });
        case 'addFinding':
          return api(`/audits/${engagementId}/findings`, { method: 'POST', body: a.body });
        case 'updateFinding':
          return api(`/audits/findings/${a.id}`, { method: 'PATCH', body: a.body });
        case 'removeFinding':
          return api(`/audits/findings/${a.id}`, { method: 'DELETE' });
        case 'respond':
          return api(`/audits/findings/${a.id}/response`, { method: 'POST', body: a.body });
        case 'itemFile':
          return api(`/audits/items/${a.id}/files`, { method: 'POST', body: form(a.file) });
        case 'findingFile':
          return api(`/audits/findings/${a.id}/files`, { method: 'POST', body: form(a.file) });
        case 'delete':
          return api(`/audits/${engagementId}`, { method: 'DELETE' });
      }
    },
    onSuccess: (data) => {
      if (data && typeof data === 'object' && 'findings' in data && 'items' in data)
        qc.setQueryData(auditKeys.one(engagementId), data);
      done();
    },
  });
}

// ---------- Questionnaires and surveys ----------

export const surveyKeys = {
  questionnaires: ['assurance', 'surveys', 'questionnaires'] as const,
  questionnaire: (id: string) => ['assurance', 'surveys', 'questionnaire', id] as const,
  campaigns: (q: Record<string, unknown>) => ['assurance', 'surveys', 'campaigns', q] as const,
  campaign: (id: string) => ['assurance', 'surveys', 'campaign', id] as const,
  results: (id: string) => ['assurance', 'surveys', 'results', id] as const,
  proposals: (id: string) => ['assurance', 'surveys', 'proposals', id] as const,
  response: (id: string) => ['assurance', 'surveys', 'response', id] as const,
};

export const useQuestionnaires = () =>
  useQuery({
    queryKey: surveyKeys.questionnaires,
    queryFn: () => api<QuestionnaireDto[]>('/surveys/questionnaires'),
  });

export const useQuestionnaire = (id: string | undefined) =>
  useQuery({
    queryKey: surveyKeys.questionnaire(id ?? ''),
    queryFn: () => api<QuestionnaireDto>(`/surveys/questionnaires/${id}`),
    enabled: !!id,
  });

export function useSaveQuestionnaire() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: CreateQuestionnaireInput | UpdateQuestionnaireInput;
    }) =>
      id
        ? api<QuestionnaireDto>(`/surveys/questionnaires/${id}`, { method: 'PATCH', body })
        : api<QuestionnaireDto>('/surveys/questionnaires', { method: 'POST', body }),
    onSuccess: done,
  });
}

export const useCampaigns = (q: Record<string, unknown>, enabled = true) =>
  useQuery({
    queryKey: surveyKeys.campaigns(q),
    queryFn: () => api<CampaignDto[]>(`/surveys/campaigns?${qs(q)}`),
    enabled,
  });

export const useCampaign = (id: string | undefined) =>
  useQuery({
    queryKey: surveyKeys.campaign(id ?? ''),
    queryFn: () => api<CampaignDetailDto>(`/surveys/campaigns/${id}`),
    enabled: !!id,
  });

export const useCampaignResults = (id: string | undefined) =>
  useQuery({
    queryKey: surveyKeys.results(id ?? ''),
    queryFn: () => api<CampaignResultsDto>(`/surveys/campaigns/${id}/results`),
    enabled: !!id,
  });

export const useCampaignProposals = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: surveyKeys.proposals(id ?? ''),
    queryFn: () => api<SurveyProposalDto[]>(`/surveys/campaigns/${id}/proposals`),
    enabled: !!id && enabled,
  });

/** Campaign actions: create, update, launch, close, delete, feedback request, proposal decisions. */
export function useCampaignAction() {
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (
      a:
        | { kind: 'create'; body: CreateCampaignInput }
        | { kind: 'update'; id: string; body: UpdateCampaignInput }
        | { kind: 'launch' | 'close' | 'delete'; id: string }
        | { kind: 'feedback'; body: FeedbackRequestInput }
        | { kind: 'decide'; id: string; decision: 'ACCEPT' | 'DISMISS' },
    ): Promise<unknown> => {
      switch (a.kind) {
        case 'create':
          return api<CampaignDetailDto>('/surveys/campaigns', { method: 'POST', body: a.body });
        case 'update':
          return api(`/surveys/campaigns/${a.id}`, { method: 'PATCH', body: a.body });
        case 'launch':
        case 'close':
          return api(`/surveys/campaigns/${a.id}/${a.kind}`, { method: 'POST' });
        case 'delete':
          return api(`/surveys/campaigns/${a.id}`, { method: 'DELETE' });
        case 'feedback':
          return api<CampaignDetailDto>('/surveys/feedback-requests', {
            method: 'POST',
            body: a.body,
          });
        case 'decide':
          return api(`/surveys/proposals/${a.id}/decision`, {
            method: 'POST',
            body: { decision: a.decision },
          });
      }
    },
    onSuccess: done,
  });
}

export const useMyResponse = (id: string | undefined) =>
  useQuery({
    queryKey: surveyKeys.response(id ?? ''),
    queryFn: () => api<MyResponseDto>(`/surveys/responses/${id}`),
    enabled: !!id,
  });

export const useResponseDiagram = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['assurance', 'surveys', 'diagram', id ?? ''],
    queryFn: () => api<{ bpmnXml: string }>(`/surveys/responses/${id}/diagram`),
    enabled: !!id && enabled,
  });

export function useSaveAnswers(id: string) {
  const qc = useQueryClient();
  const done = useInvalidateAll();
  return useMutation({
    mutationFn: (body: SaveAnswersInput) =>
      api<MyResponseDto>(`/surveys/responses/${id}`, { method: 'PUT', body }),
    onSuccess: (r) => {
      qc.setQueryData(surveyKeys.response(id), r);
      done();
    },
  });
}

export function useUploadAnswerFile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<AssuranceFileDto>(`/surveys/responses/${id}/files`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: surveyKeys.response(id) }),
  });
}

// ---------- Dashboard ----------

export const useAssuranceDashboard = (q: Record<string, unknown>) =>
  useQuery({
    queryKey: ['assurance', 'dashboard', q],
    queryFn: () => api<AssuranceDashboardDto>(`/assurance/dashboard?${qs(q)}`),
    placeholderData: keepPreviousData,
  });
