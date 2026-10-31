import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDiagramInput,
  CreateDiagramLinkInput,
  CreateDiagramVersionInput,
  DiagramContentDto,
  DiagramDto,
  DiagramLinkDto,
  DiagramSummaryDto,
  DiagramType,
  DiagramUsageDto,
  DiagramVersionDto,
  PortalDiagramDto,
  ProcessFactDto,
  PortalItemDto,
  SaveDiagramContentInput,
  UpdateDiagramInput,
} from '@processhub/shared';
import { api } from './client';

/** Diagrams other than BPMN (value chain, org chart, DMN, EPC, SIPOC — D-120). */
export const diagramKeys = {
  all: ['diagrams'] as const,
  list: ['diagrams', 'all'] as const,
  one: (id: string) => ['diagrams', id] as const,
  content: (id: string) => ['diagrams', id, 'content'] as const,
  versions: (id: string) => ['diagrams', id, 'versions'] as const,
  links: (id: string) => ['diagrams', id, 'links'] as const,
  whereUsed: (q: object) => ['diagrams', 'where-used', q] as const,
  portal: (type?: string) => ['portal', 'diagrams', type ?? 'all'] as const,
  portalOne: (id: string) => ['portal', 'diagrams', 'one', id] as const,
};

export const useAllDiagrams = (enabled = true) =>
  useQuery({
    queryKey: diagramKeys.list,
    queryFn: () => api<DiagramSummaryDto[]>('/diagrams/all'),
    enabled,
  });

export const useDiagram = (id: string | undefined) =>
  useQuery({
    queryKey: diagramKeys.one(id ?? ''),
    queryFn: () => api<DiagramDto>(`/diagrams/${id}`),
    enabled: !!id,
  });

export function useCreateDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDiagramInput) =>
      api<DiagramSummaryDto>('/diagrams', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: diagramKeys.all }),
  });
}

export function useUpdateDiagram(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDiagramInput) =>
      api<DiagramSummaryDto>(`/diagrams/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: diagramKeys.all });
      void qc.invalidateQueries({ queryKey: ['governance'] });
    },
  });
}

export function useDeleteDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/diagrams/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: diagramKeys.all }),
  });
}

export const useDiagramContent = (id: string) =>
  useQuery({
    queryKey: diagramKeys.content(id),
    queryFn: () => api<DiagramContentDto>(`/diagrams/${id}/content`),
  });

export function useSaveDiagramContent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveDiagramContentInput) =>
      api<DiagramContentDto>(`/diagrams/${id}/content`, { method: 'PUT', body }),
    onSuccess: (content) => {
      qc.setQueryData(diagramKeys.content(id), content);
      void qc.invalidateQueries({ queryKey: diagramKeys.one(id) });
      void qc.invalidateQueries({ queryKey: diagramKeys.links(id) });
      void qc.invalidateQueries({ queryKey: ['governance'] });
    },
  });
}

export const useDiagramVersions = (id: string) =>
  useQuery({
    queryKey: diagramKeys.versions(id),
    queryFn: () => api<DiagramVersionDto[]>(`/diagrams/${id}/versions`),
  });

export const fetchDiagramVersion = (id: string, versionId: string) =>
  api<DiagramVersionDto & { content: string }>(`/diagrams/${id}/versions/${versionId}`);

export function useCreateDiagramVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDiagramVersionInput) =>
      api<DiagramVersionDto>(`/diagrams/${id}/versions`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: diagramKeys.one(id) });
      void qc.invalidateQueries({ queryKey: ['governance'] });
    },
  });
}

export function useRestoreDiagramVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, changeNote }: { versionId: string; changeNote?: string }) =>
      api<DiagramVersionDto>(`/diagrams/${id}/versions/${versionId}/restore`, {
        method: 'POST',
        body: { changeNote },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: diagramKeys.one(id) });
      void qc.invalidateQueries({ queryKey: ['governance'] });
    },
  });
}

export function useLabelDiagramVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, label }: { versionId: string; label: string | null }) =>
      api<DiagramVersionDto[]>(`/diagrams/${id}/versions/${versionId}`, {
        method: 'PATCH',
        body: { label },
      }),
    onSuccess: (list) => qc.setQueryData(diagramKeys.versions(id), list),
  });
}

export const useDiagramLinks = (id: string, enabled = true) =>
  useQuery({
    queryKey: diagramKeys.links(id),
    queryFn: () => api<DiagramLinkDto[]>(`/diagrams/${id}/links`),
    enabled,
  });

export function useDiagramLinkActions(id: string) {
  const qc = useQueryClient();
  const done = (links: DiagramLinkDto[]) => qc.setQueryData(diagramKeys.links(id), links);
  return {
    create: useMutation({
      mutationFn: (body: CreateDiagramLinkInput) =>
        api<DiagramLinkDto[]>(`/diagrams/${id}/links`, { method: 'POST', body }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (linkId: string) =>
        api<DiagramLinkDto[]>(`/diagrams/${id}/links/${linkId}`, { method: 'DELETE' }),
      onSuccess: done,
    }),
  };
}

export const useDiagramWhereUsed = (
  q: { processId?: string; diagramId?: string; objectId?: string },
  enabled = true,
) =>
  useQuery({
    queryKey: diagramKeys.whereUsed(q),
    queryFn: () =>
      api<DiagramUsageDto[]>('/diagrams/where-used', { query: q as Record<string, string> }),
    enabled,
  });

// ---------- Portal ----------

export const usePortalDiagrams = (type?: DiagramType) =>
  useQuery({
    queryKey: diagramKeys.portal(type),
    queryFn: () => api<PortalItemDto[]>('/portal/diagrams', { query: type ? { type } : undefined }),
  });

export const usePortalDiagram = (id: string | undefined) =>
  useQuery({
    queryKey: diagramKeys.portalOne(id ?? ''),
    queryFn: () => api<PortalDiagramDto>(`/portal/diagrams/${id}`),
    enabled: !!id,
  });

/** Status / KPI / risk facts of processes linked from a value chain (D-121). */
export const useProcessFacts = (ids: string[], enabled = true) =>
  useQuery({
    queryKey: ['diagrams', 'process-facts', [...ids].sort().join(',')],
    queryFn: () =>
      api<ProcessFactDto[]>('/diagrams/process-facts', {
        query: { ids: [...ids].sort().join(',') },
      }),
    enabled: enabled && ids.length > 0,
    staleTime: 30_000,
  });
