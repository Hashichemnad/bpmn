import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ControlDto,
  CreateControlInput,
  CreateRequirementInput,
  CreateRiskInput,
  GrcActivityDto,
  GrcImportKind,
  GrcImportReportDto,
  GrcItemDetailDto,
  GrcObjectType,
  GrcSettings,
  Paginated,
  ProcessGrcDto,
  RequirementDto,
  RiskDto,
  UpdateControlInput,
  UpdateRequirementInput,
  UpdateRiskInput,
} from '@processhub/shared';
import { api } from './client';

/** Risk & Compliance (Phase 4.1): registers, details, timeline, settings, process view. */
export type GrcQuery = Record<string, string | number | boolean | undefined | null>;

export const GRC_PATH: Record<GrcObjectType, string> = {
  RISK: 'risks',
  CONTROL: 'controls',
  REQUIREMENT: 'requirements',
};

export const grcKeys = {
  all: ['grc'] as const,
  settings: ['grc', 'settings'] as const,
  list: (type: GrcObjectType, q: GrcQuery) => ['grc', type, 'list', q] as const,
  item: (type: GrcObjectType, id: string) => ['grc', type, 'one', id] as const,
  timeline: (id: string) => ['grc', 'timeline', id] as const,
  process: (id: string) => ['grc', 'process', id] as const,
};

export const useGrcSettings = (enabled = true) =>
  useQuery({
    queryKey: grcKeys.settings,
    queryFn: () => api<GrcSettings>('/grc/settings'),
    staleTime: 60_000,
    enabled,
  });

export function useSaveGrcSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GrcSettings) => api<GrcSettings>('/grc/settings', { method: 'PUT', body }),
    onSuccess: (s) => {
      qc.setQueryData(grcKeys.settings, s);
      void qc.invalidateQueries({ queryKey: grcKeys.all });
    },
  });
}

type ItemOf<T extends GrcObjectType> = T extends 'RISK'
  ? RiskDto
  : T extends 'CONTROL'
    ? ControlDto
    : RequirementDto;

export const useGrcList = <T extends GrcObjectType>(type: T, q: GrcQuery, enabled = true) =>
  useQuery({
    queryKey: grcKeys.list(type, q),
    queryFn: () => api<Paginated<ItemOf<T>>>(`/grc/${GRC_PATH[type]}`, { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useGrcItem = <T extends GrcObjectType>(type: T, id: string | undefined) =>
  useQuery({
    queryKey: grcKeys.item(type, id ?? ''),
    queryFn: () => api<GrcItemDetailDto<ItemOf<T>>>(`/grc/${GRC_PATH[type]}/${id}`),
    enabled: !!id,
  });

type SaveBody =
  | CreateRiskInput
  | UpdateRiskInput
  | CreateControlInput
  | UpdateControlInput
  | CreateRequirementInput
  | UpdateRequirementInput;

export function useSaveGrcItem<T extends GrcObjectType>(type: T) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveBody }) =>
      api<GrcItemDetailDto<ItemOf<T>>>(`/grc/${GRC_PATH[type]}${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: grcKeys.all });
      void qc.invalidateQueries({ queryKey: ['objects'] });
    },
  });
}

export function useDeleteGrcItem(type: GrcObjectType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/grc/${GRC_PATH[type]}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: grcKeys.all });
      void qc.invalidateQueries({ queryKey: ['objects'] });
      void qc.invalidateQueries({ queryKey: ['processes'] });
    },
  });
}

export const useGrcTimeline = (id: string | undefined) =>
  useQuery({
    queryKey: grcKeys.timeline(id ?? ''),
    queryFn: () => api<GrcActivityDto[]>(`/grc/items/${id}/timeline`),
    enabled: !!id,
  });

export function useAddGrcComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<GrcActivityDto[]>(`/grc/items/${id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (list) => qc.setQueryData(grcKeys.timeline(id), list),
  });
}

/** Risks, controls and requirements per step of a process (modeler panel, badges, colour-by). */
export const useProcessGrc = (processId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: grcKeys.process(processId ?? ''),
    queryFn: () => api<ProcessGrcDto>(`/grc/processes/${processId}`),
    enabled: !!processId && enabled,
  });

export function useGrcImport(kind: GrcImportKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      return api<GrcImportReportDto>(`/grc/import/${kind}`, {
        method: 'POST',
        body: form,
        query: { dryRun },
      });
    },
    onSuccess: (r) => {
      if (r.imported) {
        void qc.invalidateQueries({ queryKey: grcKeys.all });
        void qc.invalidateQueries({ queryKey: ['objects'] });
      }
    },
  });
}
