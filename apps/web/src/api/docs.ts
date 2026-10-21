import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttachmentDto,
  CreatePageInput,
  CreatePageLinkInput,
  CreateSpaceInput,
  GitSettingsDto,
  GitSettingsInput,
  GitSyncNowInput,
  GitSyncStatusDto,
  GitTestResultDto,
  MovePageInput,
  PageDraftDto,
  PageDraftInput,
  PageDto,
  PageLinkDto,
  PageSummaryDto,
  PageTemplateDto,
  PageVersionDetailDto,
  PageVersionDto,
  ProcessVersionDto,
  RelatedPageDto,
  RestoreVersionInput,
  SavePageInput,
  SearchQuery,
  SearchResultDto,
  SpaceDto,
  SpacePermissionsDto,
  SpacePermissionsInput,
  TemplateInput,
  TrashedPageDto,
  UpdateSpaceInput,
  VersionLabelInput,
} from '@processhub/shared';
import { api } from './client';
import { keys as baseKeys } from './hooks';

export const docKeys = {
  spaces: ['spaces'] as const,
  space: (id: string) => ['spaces', id] as const,
  permissions: (id: string) => ['spaces', id, 'permissions'] as const,
  tree: (spaceId: string) => ['spaces', spaceId, 'pages'] as const,
  trash: (spaceId: string) => ['spaces', spaceId, 'trash'] as const,
  page: (id: string) => ['pages', id] as const,
  draft: (id: string) => ['pages', id, 'draft'] as const,
  versions: (id: string) => ['pages', id, 'versions'] as const,
  links: (id: string) => ['pages', id, 'links'] as const,
  attachments: (id: string) => ['pages', id, 'attachments'] as const,
  templates: ['templates'] as const,
  related: (kind: 'processes' | 'objects', id: string) => ['related-pages', kind, id] as const,
  search: (q: object) => ['search', q] as const,
  git: ['integrations', 'git'] as const,
  gitStatus: ['integrations', 'git', 'status'] as const,
};

// ---------- Spaces ----------
export const useSpaces = () =>
  useQuery({ queryKey: docKeys.spaces, queryFn: () => api<SpaceDto[]>('/spaces') });

export const useSpace = (id: string | undefined) =>
  useQuery({
    queryKey: docKeys.space(id ?? ''),
    queryFn: () => api<SpaceDto>(`/spaces/${id}`),
    enabled: !!id,
  });

export function useSaveSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateSpaceInput | UpdateSpaceInput }) =>
      id
        ? api<SpaceDto>(`/spaces/${id}`, { method: 'PATCH', body })
        : api<SpaceDto>('/spaces', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.spaces }),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/spaces/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.spaces }),
  });
}

export const useSpacePermissions = (id: string, enabled = true) =>
  useQuery({
    queryKey: docKeys.permissions(id),
    queryFn: () => api<SpacePermissionsDto>(`/spaces/${id}/permissions`),
    enabled,
  });

export function useSaveSpacePermissions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SpacePermissionsInput) =>
      api<SpacePermissionsDto>(`/spaces/${id}/permissions`, { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(docKeys.permissions(id), data);
      void qc.invalidateQueries({ queryKey: docKeys.spaces });
    },
  });
}

// ---------- Pages ----------
export const usePageTree = (spaceId: string | undefined) =>
  useQuery({
    queryKey: docKeys.tree(spaceId ?? ''),
    queryFn: () => api<PageSummaryDto[]>(`/spaces/${spaceId}/pages`),
    enabled: !!spaceId,
  });

export const usePage = (id: string | undefined) =>
  useQuery({
    queryKey: docKeys.page(id ?? ''),
    queryFn: () => api<PageDto>(`/pages/${id}`),
    enabled: !!id,
  });

export const fetchPage = (id: string) => api<PageDto>(`/pages/${id}`);

/** Invalidates everything that shows page titles or content. */
function invalidatePages(qc: ReturnType<typeof useQueryClient>, spaceId?: string) {
  void qc.invalidateQueries({ queryKey: ['pages'] });
  void qc.invalidateQueries({ queryKey: ['related-pages'] });
  void qc.invalidateQueries({ queryKey: spaceId ? ['spaces', spaceId] : ['spaces'] });
  void qc.invalidateQueries({ queryKey: docKeys.spaces, exact: true });
}

export function useCreatePage(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePageInput) =>
      api<PageDto>(`/spaces/${spaceId}/pages`, { method: 'POST', body }),
    onSuccess: () => invalidatePages(qc, spaceId),
  });
}

export function useSavePage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SavePageInput) => api<PageDto>(`/pages/${id}`, { method: 'PUT', body }),
    onSuccess: (page) => {
      qc.setQueryData(docKeys.page(id), page);
      qc.setQueryData(docKeys.draft(id), { draft: null });
      invalidatePages(qc, page.spaceId);
    },
  });
}

export const usePageDraft = (id: string, enabled = true) =>
  useQuery({
    queryKey: docKeys.draft(id),
    queryFn: () => api<{ draft: PageDraftDto | null }>(`/pages/${id}/draft`),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

export const saveDraft = (id: string, body: PageDraftInput) =>
  api<{ draft: PageDraftDto }>(`/pages/${id}/draft`, { method: 'PUT', body });

export const discardDraft = (id: string) => api<void>(`/pages/${id}/draft`, { method: 'DELETE' });

export function useMovePage(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MovePageInput }) =>
      api<PageSummaryDto[]>(`/pages/${id}/move`, { method: 'POST', body }),
    onSuccess: (tree) => {
      qc.setQueryData(docKeys.tree(spaceId), tree);
      void qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeletePage(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePages(qc, spaceId),
  });
}

export const useTrash = (spaceId: string) =>
  useQuery({
    queryKey: docKeys.trash(spaceId),
    queryFn: () => api<TrashedPageDto[]>(`/spaces/${spaceId}/trash`),
  });

export function useRestorePage(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PageDto>(`/pages/${id}/restore`, { method: 'POST' }),
    onSuccess: () => invalidatePages(qc, spaceId),
  });
}

export function usePurgePage(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/pages/${id}/purge`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.trash(spaceId) }),
  });
}

// ---------- Page versions ----------
export const usePageVersions = (id: string) =>
  useQuery({
    queryKey: docKeys.versions(id),
    queryFn: () => api<PageVersionDto[]>(`/pages/${id}/versions`),
  });

export const fetchPageVersion = (pageId: string, versionId: string) =>
  api<PageVersionDetailDto>(`/pages/${pageId}/versions/${versionId}`);

export function useRestorePageVersion(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, body }: { versionId: string; body: RestoreVersionInput }) =>
      api<PageDto>(`/pages/${pageId}/versions/${versionId}/restore`, { method: 'POST', body }),
    onSuccess: (page) => {
      qc.setQueryData(docKeys.page(pageId), page);
      invalidatePages(qc, page.spaceId);
    },
  });
}

export function useLabelPageVersion(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, body }: { versionId: string; body: VersionLabelInput }) =>
      api<PageVersionDto[]>(`/pages/${pageId}/versions/${versionId}`, { method: 'PATCH', body }),
    onSuccess: (list) => qc.setQueryData(docKeys.versions(pageId), list),
  });
}

// ---------- Links & attachments ----------
export const usePageLinks = (id: string) =>
  useQuery({
    queryKey: docKeys.links(id),
    queryFn: () => api<PageLinkDto[]>(`/pages/${id}/links`),
  });

export function useAddPageLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePageLinkInput) =>
      api<PageLinkDto[]>(`/pages/${id}/links`, { method: 'POST', body }),
    onSuccess: (links) => {
      qc.setQueryData(docKeys.links(id), links);
      void qc.invalidateQueries({ queryKey: ['related-pages'] });
    },
  });
}

export function useRemovePageLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      api<PageLinkDto[]>(`/pages/${id}/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: (links) => {
      qc.setQueryData(docKeys.links(id), links);
      void qc.invalidateQueries({ queryKey: ['related-pages'] });
    },
  });
}

export const useRelatedPages = (
  kind: 'processes' | 'objects',
  id: string | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: docKeys.related(kind, id ?? ''),
    queryFn: () => api<RelatedPageDto[]>(`/${kind}/${id}/pages`),
    enabled: !!id && enabled,
  });

export const useAttachments = (pageId: string) =>
  useQuery({
    queryKey: docKeys.attachments(pageId),
    queryFn: () => api<AttachmentDto[]>(`/pages/${pageId}/attachments`),
  });

export const uploadAttachment = (pageId: string, file: File) => {
  const body = new FormData();
  body.append('file', file);
  return api<AttachmentDto>(`/pages/${pageId}/attachments`, { method: 'POST', body });
};

export function useDeleteAttachment(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.attachments(pageId) }),
  });
}

// ---------- Templates ----------
export const useTemplates = () =>
  useQuery({ queryKey: docKeys.templates, queryFn: () => api<PageTemplateDto[]>('/templates') });

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: TemplateInput }) =>
      id
        ? api<PageTemplateDto>(`/templates/${id}`, { method: 'PUT', body })
        : api<PageTemplateDto>('/templates', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.templates }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.templates }),
  });
}

// ---------- Search ----------
export const useSearch = (q: Partial<SearchQuery>, enabled = true) =>
  useQuery({
    queryKey: docKeys.search(q),
    queryFn: () =>
      api<SearchResultDto>('/search', {
        query: q as Record<string, string | number | undefined>,
      }),
    enabled: enabled && !!q.q?.trim(),
    placeholderData: keepPreviousData,
  });

// ---------- Process versions (restore / label) ----------
export function useRestoreProcessVersion(processId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, body }: { versionId: string; body: RestoreVersionInput }) =>
      api<ProcessVersionDto>(`/processes/${processId}/versions/${versionId}/restore`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: baseKeys.process(processId) }),
  });
}

export function useLabelProcessVersion(processId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, body }: { versionId: string; body: VersionLabelInput }) =>
      api<ProcessVersionDto[]>(`/processes/${processId}/versions/${versionId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (list) => qc.setQueryData(baseKeys.versions(processId), list),
  });
}

// ---------- Git integration ----------
export const useGitSettings = () =>
  useQuery({ queryKey: docKeys.git, queryFn: () => api<GitSettingsDto>('/integrations/git') });

export function useSaveGitSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GitSettingsInput) =>
      api<GitSettingsDto>('/integrations/git', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(docKeys.git, data);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: docKeys.gitStatus });
    },
  });
}

export const useTestGitConnection = () =>
  useMutation({
    mutationFn: (body: GitSettingsInput) =>
      api<GitTestResultDto>('/integrations/git/test', { method: 'POST', body }),
  });

export const useGitStatus = (poll: boolean) =>
  useQuery({
    queryKey: docKeys.gitStatus,
    queryFn: () => api<GitSyncStatusDto>('/integrations/git/status'),
    refetchInterval: poll ? 2000 : false,
  });

export function useGitSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GitSyncNowInput) =>
      api<{ queued: number }>('/integrations/git/sync', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.gitStatus }),
  });
}

export function useGitRetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<GitSyncStatusDto>(`/integrations/git/items/${id}/retry`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(docKeys.gitStatus, data),
  });
}
