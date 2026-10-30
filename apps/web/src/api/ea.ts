import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplicationDetailDto,
  ApplicationDto,
  CapabilityDto,
  DataObjectDto,
  EaImportKind,
  EaImportReportDto,
  InterfaceDto,
  Paginated,
} from '@processhub/shared';
import { api } from './client';

/** Enterprise architecture (Phase 4.3): applications, interfaces, data objects, capabilities. */
export type EaQuery = Record<string, string | number | boolean | undefined | null>;

export const eaKeys = {
  all: ['ea'] as const,
  applications: (q: EaQuery) => ['ea', 'applications', q] as const,
  application: (id: string) => ['ea', 'application', id] as const,
  interfaces: (q: EaQuery) => ['ea', 'interfaces', q] as const,
  dataObjects: (q: EaQuery) => ['ea', 'data-objects', q] as const,
  capabilities: ['ea', 'capabilities'] as const,
};

export const useApplications = (q: EaQuery, enabled = true) =>
  useQuery({
    queryKey: eaKeys.applications(q),
    queryFn: () => api<Paginated<ApplicationDto>>('/ea/applications', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

/** Every application (pickers, diagrams). */
export const useAllApplications = (enabled = true) =>
  useApplications({ pageSize: 500, sort: 'nameEn' }, enabled);

export const useApplication = (id: string | undefined) =>
  useQuery({
    queryKey: eaKeys.application(id ?? ''),
    queryFn: () => api<ApplicationDetailDto>(`/ea/applications/${id}`),
    enabled: !!id,
  });

export const useInterfaces = (q: EaQuery, enabled = true) =>
  useQuery({
    queryKey: eaKeys.interfaces(q),
    queryFn: () => api<Paginated<InterfaceDto>>('/ea/interfaces', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useDataObjects = (q: EaQuery, enabled = true) =>
  useQuery({
    queryKey: eaKeys.dataObjects(q),
    queryFn: () => api<Paginated<DataObjectDto>>('/ea/data-objects', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useCapabilities = (enabled = true) =>
  useQuery({
    queryKey: eaKeys.capabilities,
    queryFn: () => api<CapabilityDto[]>('/ea/capabilities'),
    enabled,
  });

const PATHS = {
  application: 'applications',
  interface: 'interfaces',
  dataObject: 'data-objects',
  capability: 'capabilities',
} as const;
export type EaEntity = keyof typeof PATHS;

/** Create (no id) or update an architecture item; refreshes every EA query and the library. */
export function useSaveEa<T = unknown>(entity: EaEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: object }) =>
      api<T>(`/ea/${PATHS[entity]}${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eaKeys.all });
      void qc.invalidateQueries({ queryKey: ['objects'] });
    },
  });
}

export function useDeleteEa(entity: EaEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/ea/${PATHS[entity]}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eaKeys.all });
      void qc.invalidateQueries({ queryKey: ['objects'] });
      void qc.invalidateQueries({ queryKey: ['processes'] });
    },
  });
}

export function useEaImport(kind: EaImportKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      return api<EaImportReportDto>(`/ea/import/${kind}`, {
        method: 'POST',
        body: form,
        query: { dryRun },
      });
    },
    onSuccess: (r) => {
      if (r.imported) {
        void qc.invalidateQueries({ queryKey: eaKeys.all });
        void qc.invalidateQueries({ queryKey: ['objects'] });
      }
    },
  });
}
