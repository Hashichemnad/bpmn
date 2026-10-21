import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContentType,
  FeedbackDto,
  MyPortalDto,
  PortalHomeDto,
  PortalPageDto,
  PortalPageNodeDto,
  PortalProcessDto,
  PortalProcessNodeDto,
  PortalSearchQuery,
  PortalSearchResultDto,
  PortalSettingsDto,
  PortalSettingsInput,
  PortalSpaceDto,
} from '@processhub/shared';
import { api } from './client';
import { typePath } from './governance';

export const portalKeys = {
  home: ['portal', 'home'] as const,
  settings: ['portal', 'settings'] as const,
  processes: ['portal', 'processes'] as const,
  process: (id: string) => ['portal', 'processes', id] as const,
  spaces: ['portal', 'spaces'] as const,
  spacePages: (id: string) => ['portal', 'spaces', id, 'pages'] as const,
  page: (id: string) => ['portal', 'pages', id] as const,
  search: (q: object) => ['portal', 'search', q] as const,
  my: ['portal', 'my'] as const,
  feedback: (type: ContentType, id: string) => ['portal', 'feedback', type, id] as const,
};

export const usePortalHome = () =>
  useQuery({ queryKey: portalKeys.home, queryFn: () => api<PortalHomeDto>('/portal/home') });

export const usePortalProcesses = () =>
  useQuery({
    queryKey: portalKeys.processes,
    queryFn: () => api<PortalProcessNodeDto[]>('/portal/processes'),
  });

export const usePortalProcess = (id: string | undefined) =>
  useQuery({
    queryKey: portalKeys.process(id ?? ''),
    queryFn: () => api<PortalProcessDto>(`/portal/processes/${id}`),
    enabled: !!id,
  });

export const usePortalSpaces = () =>
  useQuery({ queryKey: portalKeys.spaces, queryFn: () => api<PortalSpaceDto[]>('/portal/spaces') });

export const usePortalSpacePages = (id: string | undefined) =>
  useQuery({
    queryKey: portalKeys.spacePages(id ?? ''),
    queryFn: () => api<PortalPageNodeDto[]>(`/portal/spaces/${id}/pages`),
    enabled: !!id,
  });

export const usePortalPage = (id: string | undefined) =>
  useQuery({
    queryKey: portalKeys.page(id ?? ''),
    queryFn: () => api<PortalPageDto>(`/portal/pages/${id}`),
    enabled: !!id,
  });

export const usePortalSearch = (q: Partial<PortalSearchQuery>) =>
  useQuery({
    queryKey: portalKeys.search(q),
    queryFn: () =>
      api<PortalSearchResultDto>('/portal/search', {
        query: q as Record<string, string | number | undefined>,
      }),
    enabled: !!q.q?.trim(),
    placeholderData: keepPreviousData,
  });

export const useMyPortal = () =>
  useQuery({ queryKey: portalKeys.my, queryFn: () => api<MyPortalDto>('/portal/my') });

export const useItemFeedback = (type: ContentType, id: string) =>
  useQuery({
    queryKey: portalKeys.feedback(type, id),
    queryFn: () => api<FeedbackDto[]>(`/portal/${typePath(type)}/${id}/feedback`),
  });

export const usePortalSettings = () =>
  useQuery({
    queryKey: portalKeys.settings,
    queryFn: () => api<PortalSettingsDto>('/portal/settings'),
  });

export function useSavePortalSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PortalSettingsInput) =>
      api<PortalSettingsDto>('/portal/settings', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(portalKeys.settings, data);
      void qc.invalidateQueries({ queryKey: portalKeys.home });
    },
  });
}
