import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  ApplyThemeResultDto,
  DiagramThemeInput,
  AuditListQuery,
  AuditLogDto,
  CreateDepartmentInput,
  CreateLinkInput,
  CreateObjectInput,
  CreateProcessInput,
  CreateUserInput,
  CreateVersionInput,
  DepartmentDto,
  MoveProcessInput,
  ObjectLinkDto,
  ObjectListQuery,
  ObjectUsageDto,
  Paginated,
  ProcessDto,
  ProcessModelDto,
  ProcessSummaryDto,
  ProcessVersionDto,
  PublicSettingsDto,
  RepoObjectDto,
  RoleDto,
  SaveModelInput,
  SettingsDto,
  UpdateDepartmentInput,
  UpdateObjectInput,
  UpdateProcessInput,
  UpdateSettingsInput,
  UpdateUserInput,
  UserDto,
  UserListQuery,
} from '@processhub/shared';
import { api } from './client';

type Query<T> = Partial<Record<keyof T, string | number | boolean | undefined | null>>;

export const keys = {
  publicSettings: ['settings', 'public'] as const,
  settings: ['settings'] as const,
  users: (q?: object) => ['users', q ?? {}] as const,
  roles: ['roles'] as const,
  departments: ['departments'] as const,
  audit: (q: object) => ['audit', q] as const,
  tree: ['processes', 'tree'] as const,
  process: (id: string) => ['processes', id] as const,
  model: (id: string) => ['processes', id, 'model'] as const,
  versions: (id: string) => ['processes', id, 'versions'] as const,
  links: (id: string) => ['processes', id, 'links'] as const,
  objects: (q: object) => ['objects', q] as const,
  object: (id: string) => ['objects', 'one', id] as const,
  usage: (id: string) => ['objects', 'usage', id] as const,
};

// ---------- Settings ----------
export const usePublicSettings = () =>
  useQuery({
    queryKey: keys.publicSettings,
    queryFn: () => api<PublicSettingsDto>('/settings/public'),
    staleTime: 5 * 60_000,
  });

export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsDto>('/settings') });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsInput) =>
      api<SettingsDto>('/settings', { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<SettingsDto>('/settings/logo', { method: 'POST', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useSetDiagramTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DiagramThemeInput) =>
      api<SettingsDto>('/settings/diagram-theme', { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useResetDiagramTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SettingsDto>('/settings/diagram-theme', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

/** "Apply theme to existing diagrams": dry run (counts only) or apply. */
export function useApplyDiagramTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ApplyThemeResultDto>('/settings/diagram-theme/apply', {
        method: 'POST',
        body: { dryRun },
      }),
    onSuccess: (res) => {
      if (!res.dryRun) void qc.invalidateQueries({ queryKey: ['processes'] });
    },
  });
}

export function useRemoveLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SettingsDto>('/settings/logo', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

// ---------- Users & roles ----------
export const useUsers = (q: Query<UserListQuery>, enabled = true) =>
  useQuery({
    queryKey: keys.users(q),
    queryFn: () => api<Paginated<UserDto>>('/users', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useRoles = () =>
  useQuery({ queryKey: keys.roles, queryFn: () => api<RoleDto[]>('/roles') });

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateUserInput | UpdateUserInput }) =>
      id
        ? api<UserDto>(`/users/${id}`, { method: 'PATCH', body })
        : api<UserDto>('/users', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export const useResetPassword = () =>
  useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api<void>(`/users/${id}/reset-password`, { method: 'POST', body: { newPassword } }),
  });

export function useUnlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<UserDto>(`/users/${id}/unlock`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ---------- Departments ----------
export const useDepartments = (enabled = true) =>
  useQuery({
    queryKey: keys.departments,
    queryFn: () => api<DepartmentDto[]>('/departments'),
    enabled,
  });

export function useSaveDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: CreateDepartmentInput | UpdateDepartmentInput;
    }) =>
      id
        ? api<DepartmentDto>(`/departments/${id}`, { method: 'PATCH', body })
        : api<DepartmentDto>('/departments', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.departments }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.departments }),
  });
}

// ---------- Audit ----------
export const useAuditLogs = (q: Query<AuditListQuery>) =>
  useQuery({
    queryKey: keys.audit(q),
    queryFn: () => api<Paginated<AuditLogDto>>('/audit-logs', { query: q }),
    placeholderData: keepPreviousData,
  });

// ---------- Processes ----------
export const useProcessTree = () =>
  useQuery({ queryKey: keys.tree, queryFn: () => api<ProcessSummaryDto[]>('/processes/tree') });

export const useProcess = (id: string | undefined) =>
  useQuery({
    queryKey: keys.process(id ?? ''),
    queryFn: () => api<ProcessDto>(`/processes/${id}`),
    enabled: !!id,
  });

export function useSaveProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateProcessInput | UpdateProcessInput }) =>
      id
        ? api<ProcessSummaryDto>(`/processes/${id}`, { method: 'PATCH', body })
        : api<ProcessSummaryDto>('/processes', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processes'] }),
  });
}

export function useMoveProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveProcessInput }) =>
      api<ProcessSummaryDto[]>(`/processes/${id}/move`, { method: 'POST', body }),
    onSuccess: (tree) => {
      qc.setQueryData(keys.tree, tree);
      void qc.invalidateQueries({
        queryKey: ['processes'],
        predicate: (q) => q.queryKey[1] !== 'tree',
      });
    },
  });
}

export function useDeleteProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/processes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processes'] }),
  });
}

// ---------- Models & versions ----------
export const useProcessModel = (id: string) =>
  useQuery({
    queryKey: keys.model(id),
    queryFn: () => api<ProcessModelDto>(`/processes/${id}/model`),
  });

export function useSaveModel(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveModelInput) =>
      api<ProcessModelDto>(`/processes/${id}/model`, { method: 'PUT', body }),
    onSuccess: (model) => {
      qc.setQueryData(keys.model(id), model);
      void qc.invalidateQueries({ queryKey: keys.links(id) });
      void qc.invalidateQueries({ queryKey: keys.process(id) });
    },
  });
}

export const useVersions = (id: string) =>
  useQuery({
    queryKey: keys.versions(id),
    queryFn: () => api<ProcessVersionDto[]>(`/processes/${id}/versions`),
  });

export function useCreateVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVersionInput) =>
      api<ProcessVersionDto>(`/processes/${id}/versions`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processes', id] }),
  });
}

export const fetchVersion = (processId: string, versionId: string) =>
  api<ProcessVersionDto & { bpmnXml: string }>(`/processes/${processId}/versions/${versionId}`);

// ---------- Links ----------
export const useLinks = (id: string) =>
  useQuery({
    queryKey: keys.links(id),
    queryFn: () => api<ObjectLinkDto[]>(`/processes/${id}/links`),
  });

export function useCreateLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLinkInput) =>
      api<ObjectLinkDto[]>(`/processes/${id}/links`, { method: 'POST', body }),
    onSuccess: (links) => {
      qc.setQueryData(keys.links(id), links);
      void qc.invalidateQueries({ queryKey: ['objects'] });
    },
  });
}

export function useDeleteLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      api<ObjectLinkDto[]>(`/processes/${id}/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: (links) => {
      qc.setQueryData(keys.links(id), links);
      void qc.invalidateQueries({ queryKey: ['objects'] });
    },
  });
}

// ---------- Objects ----------
export const useObjects = (q: Query<ObjectListQuery>, enabled = true) =>
  useQuery({
    queryKey: keys.objects(q),
    queryFn: () => api<Paginated<RepoObjectDto>>('/objects', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useObject = (id: string | undefined) =>
  useQuery({
    queryKey: keys.object(id ?? ''),
    queryFn: () => api<RepoObjectDto>(`/objects/${id}`),
    enabled: !!id,
  });

export const useObjectUsage = (id: string | undefined) =>
  useQuery({
    queryKey: keys.usage(id ?? ''),
    queryFn: () => api<ObjectUsageDto[]>(`/objects/${id}/usage`),
    enabled: !!id,
  });

export function useSaveObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateObjectInput | UpdateObjectInput }) =>
      id
        ? api<RepoObjectDto>(`/objects/${id}`, { method: 'PATCH', body })
        : api<RepoObjectDto>('/objects', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  });
}

export function useDeleteObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/objects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['objects'] });
      void qc.invalidateQueries({ queryKey: ['processes'] });
    },
  });
}
