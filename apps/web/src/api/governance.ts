import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveInput,
  CommentDto,
  ContentType,
  CreateCommentInput,
  CreateFeedbackInput,
  EmailSettingsDto,
  EmailSettingsInput,
  FeedbackDto,
  FeedbackListQuery,
  GovernanceDashboardDto,
  GovernanceInfoDto,
  GovernanceSettingsDto,
  GovernanceSettingsInput,
  ItemGovernanceInput,
  MyTasksDto,
  NotificationDto,
  NotificationPrefsDto,
  NotificationPrefsInput,
  Paginated,
  PublicationDto,
  PublishInput,
  ReviewDecisionInput,
  ReviewDetailDto,
  ReviewSummaryDto,
  SubmitReviewInput,
  UpdateFeedbackInput,
  UserRef,
  WorkflowDto,
  WorkflowInput,
} from '@processhub/shared';
import { api } from './client';

/** `processes` / `pages` segment of governance and comment URLs. */
export const typePath = (type: ContentType) => (type === 'PROCESS' ? 'processes' : 'pages');

export const govKeys = {
  info: (type: ContentType, id: string) => ['governance', type, id] as const,
  reviews: (type: ContentType, id: string) => ['governance', type, id, 'reviews'] as const,
  publications: (type: ContentType, id: string) =>
    ['governance', type, id, 'publications'] as const,
  review: (id: string) => ['reviews', id] as const,
  tasks: ['tasks'] as const,
  dashboard: ['governance', 'dashboard'] as const,
  settings: ['governance', 'settings'] as const,
  workflows: ['workflows'] as const,
  comments: (type: ContentType, id: string) => ['comments', type, id] as const,
  notifications: (q: object) => ['notifications', 'list', q] as const,
  unread: ['notifications', 'unread'] as const,
  prefs: ['notifications', 'prefs'] as const,
  feedback: (q: object) => ['feedback', q] as const,
  email: ['settings', 'email'] as const,
  directory: (q: string) => ['users', 'directory', q] as const,
};

/** Everything that shows a status, a task or a publication. */
function invalidateGovernance(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['governance', 'reviews', 'tasks', 'processes', 'pages', 'spaces', 'portal']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

// ---------- Item lifecycle ----------
export const useGovernance = (type: ContentType, id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: govKeys.info(type, id ?? ''),
    queryFn: () => api<GovernanceInfoDto>(`/governance/${typePath(type)}/${id}`),
    enabled: !!id && enabled,
  });

export const useItemReviews = (type: ContentType, id: string, enabled = true) =>
  useQuery({
    queryKey: govKeys.reviews(type, id),
    queryFn: () => api<ReviewSummaryDto[]>(`/governance/${typePath(type)}/${id}/reviews`),
    enabled,
  });

export const useItemPublications = (type: ContentType, id: string, enabled = true) =>
  useQuery({
    queryKey: govKeys.publications(type, id),
    queryFn: () =>
      api<(PublicationDto & { current: boolean; endedAt: string | null })[]>(
        `/governance/${typePath(type)}/${id}/publications`,
      ),
    enabled,
  });

type Action =
  | { action: 'submit'; body: SubmitReviewInput }
  | { action: 'withdraw' }
  | { action: 'publish'; body: PublishInput }
  | { action: 'archive'; body: ArchiveInput }
  | { action: 'restore' }
  | { action: 'confirm-review' };

export function useGovernanceAction(type: ContentType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Action) =>
      api<GovernanceInfoDto>(`/governance/${typePath(type)}/${id}/${a.action}`, {
        method: 'POST',
        body: 'body' in a ? a.body : undefined,
      }),
    onSuccess: (info) => {
      qc.setQueryData(govKeys.info(type, id), info);
      invalidateGovernance(qc);
    },
  });
}

export function useUpdateItemGovernance(type: ContentType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemGovernanceInput) =>
      api<GovernanceInfoDto>(`/governance/${typePath(type)}/${id}`, { method: 'PATCH', body }),
    onSuccess: (info) => {
      qc.setQueryData(govKeys.info(type, id), info);
      invalidateGovernance(qc);
    },
  });
}

// ---------- Reviews & tasks ----------
export const useReview = (id: string | undefined) =>
  useQuery({
    queryKey: govKeys.review(id ?? ''),
    queryFn: () => api<ReviewDetailDto>(`/reviews/${id}`),
    enabled: !!id,
  });

export function useDecide(reviewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewDecisionInput) =>
      api<ReviewDetailDto>(`/reviews/${reviewId}/decision`, { method: 'POST', body }),
    onSuccess: (review) => {
      qc.setQueryData(govKeys.review(reviewId), review);
      invalidateGovernance(qc);
    },
  });
}

export const useMyTasks = () =>
  useQuery({ queryKey: govKeys.tasks, queryFn: () => api<MyTasksDto>('/tasks') });

export const useGovernanceDashboard = () =>
  useQuery({
    queryKey: govKeys.dashboard,
    queryFn: () => api<GovernanceDashboardDto>('/governance/dashboard'),
  });

// ---------- Workflows & settings ----------
export const useWorkflows = (enabled = true) =>
  useQuery({
    queryKey: govKeys.workflows,
    queryFn: () => api<WorkflowDto[]>('/workflows'),
    enabled,
  });

export function useSaveWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: WorkflowInput }) =>
      id
        ? api<WorkflowDto>(`/workflows/${id}`, { method: 'PUT', body })
        : api<WorkflowDto>('/workflows', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: govKeys.workflows }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: govKeys.workflows }),
  });
}

export const useGovernanceSettings = (enabled = true) =>
  useQuery({
    queryKey: govKeys.settings,
    queryFn: () => api<GovernanceSettingsDto>('/governance/settings'),
    enabled,
  });

export function useSaveGovernanceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GovernanceSettingsInput) =>
      api<GovernanceSettingsDto>('/governance/settings', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(govKeys.settings, data);
      void qc.invalidateQueries({ queryKey: govKeys.workflows });
    },
  });
}

export function useSetSpaceWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, workflowId }: { spaceId: string; workflowId: string | null }) =>
      api(`/governance/spaces/${spaceId}/workflow`, { method: 'PUT', body: { workflowId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.workflows });
      void qc.invalidateQueries({ queryKey: ['governance'] });
    },
  });
}

// ---------- Comments ----------
export const useComments = (type: ContentType, id: string, enabled = true) =>
  useQuery({
    queryKey: govKeys.comments(type, id),
    queryFn: () => api<CommentDto[]>(`/comments/${typePath(type)}/${id}`),
    enabled,
  });

export function useCommentActions(type: ContentType, id: string) {
  const qc = useQueryClient();
  const set = (threads: CommentDto[]) => qc.setQueryData(govKeys.comments(type, id), threads);
  return {
    create: useMutation({
      mutationFn: (body: CreateCommentInput) =>
        api<CommentDto[]>(`/comments/${typePath(type)}/${id}`, { method: 'POST', body }),
      onSuccess: set,
    }),
    update: useMutation({
      mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
        api<CommentDto[]>(`/comments/${commentId}`, { method: 'PATCH', body: { body } }),
      onSuccess: set,
    }),
    remove: useMutation({
      mutationFn: (commentId: string) =>
        api<CommentDto[]>(`/comments/${commentId}`, { method: 'DELETE' }),
      onSuccess: set,
    }),
    resolve: useMutation({
      mutationFn: ({ commentId, resolved }: { commentId: string; resolved: boolean }) =>
        api<CommentDto[]>(`/comments/${commentId}/${resolved ? 'resolve' : 'reopen'}`, {
          method: 'POST',
        }),
      onSuccess: set,
    }),
  };
}

export const useUserDirectory = (q: string, enabled = true) =>
  useQuery({
    queryKey: govKeys.directory(q),
    queryFn: () => api<UserRef[]>('/users/directory', { query: { q } }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

// ---------- Notifications ----------
export const useUnreadCount = (enabled = true) =>
  useQuery({
    queryKey: govKeys.unread,
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    enabled,
  });

export const useNotifications = (q: { unread?: boolean; page?: number; pageSize?: number }) =>
  useQuery({
    queryKey: govKeys.notifications(q),
    queryFn: () =>
      api<Paginated<NotificationDto>>('/notifications', {
        query: { unread: q.unread ? 'true' : undefined, page: q.page, pageSize: q.pageSize },
      }),
    placeholderData: keepPreviousData,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      api<{ count: number }>(
        id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`,
        {
          method: 'POST',
        },
      ),
    onSuccess: (data) => {
      qc.setQueryData(govKeys.unread, data);
      void qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      void qc.invalidateQueries({ queryKey: govKeys.tasks });
    },
  });
}

export const useNotificationPrefs = () =>
  useQuery({
    queryKey: govKeys.prefs,
    queryFn: () => api<NotificationPrefsDto>('/notifications/preferences'),
  });

export function useSaveNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPrefsInput) =>
      api<NotificationPrefsDto>('/notifications/preferences', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(govKeys.prefs, data),
  });
}

// ---------- Email settings ----------
export const useEmailSettings = () =>
  useQuery({ queryKey: govKeys.email, queryFn: () => api<EmailSettingsDto>('/settings/email') });

export function useSaveEmailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EmailSettingsInput) =>
      api<EmailSettingsDto>('/settings/email', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(govKeys.email, data);
      void qc.invalidateQueries({ queryKey: govKeys.prefs });
    },
  });
}

export const useTestEmail = () =>
  useMutation({
    mutationFn: (to: string) =>
      api<{ ok: boolean; error: string | null }>('/settings/email/test', {
        method: 'POST',
        body: { to },
      }),
  });

// ---------- Feedback ----------
export const useFeedbackList = (q: Partial<FeedbackListQuery>, enabled = true) =>
  useQuery({
    queryKey: govKeys.feedback(q),
    queryFn: () =>
      api<Paginated<FeedbackDto>>('/feedback', {
        query: q as Record<string, string | number | undefined>,
      }),
    enabled,
    placeholderData: keepPreviousData,
  });

export function useSendFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFeedbackInput) =>
      api<FeedbackDto>('/feedback', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feedback'] });
      void qc.invalidateQueries({ queryKey: ['portal', 'feedback'] });
    },
  });
}

export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFeedbackInput }) =>
      api<FeedbackDto>(`/feedback/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feedback'] });
      void qc.invalidateQueries({ queryKey: govKeys.tasks });
      void qc.invalidateQueries({ queryKey: govKeys.dashboard });
    },
  });
}
