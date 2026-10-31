import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptProposalInput,
  MigrationBulkInput,
  MigrationBulkResultDto,
  MigrationDashboardDto,
  MigrationItemDto,
  MigrationAiRunDto,
  MigrationAiRunInput,
  MigrationProposalDto,
  ImportBatchDto,
  ImportBatchSummaryDto,
  ImportDecisionInput,
  ImportItemRecordDto,
  ImportKind,
  ImportKindDto,
  ImportOptions,
  ImportPreviewItem,
  ImportSettings,
  ImportUndoCheckDto,
  Paginated,
} from '@processhub/shared';
import { api } from './client';

/** Import Center (M15): batches, preview, apply, undo. */
export type ImportQuery = Record<string, string | number | boolean | undefined | null>;

export const importKeys = {
  all: ['imports'] as const,
  kinds: ['imports', 'kinds'] as const,
  list: (q: ImportQuery) => ['imports', 'list', q] as const,
  batch: (id: string) => ['imports', 'batch', id] as const,
  items: (id: string, q: ImportQuery) => ['imports', 'items', id, q] as const,
  records: (id: string, q: ImportQuery) => ['imports', 'records', id, q] as const,
  undo: (id: string) => ['imports', 'undo', id] as const,
};

const RUNNING = ['UPLOADED', 'PARSING', 'APPLYING'];

export const useImportKinds = () =>
  useQuery({ queryKey: importKeys.kinds, queryFn: () => api<ImportKindDto[]>('/imports/kinds') });

export const useImportBatches = (q: ImportQuery) =>
  useQuery({
    queryKey: importKeys.list(q),
    queryFn: () => api<Paginated<ImportBatchSummaryDto>>('/imports', { query: q }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((b) => RUNNING.includes(b.status)) ? 2000 : false,
  });

/** Polls while the parse / apply job runs. */
export const useImportBatch = (id: string | undefined) =>
  useQuery({
    queryKey: importKeys.batch(id ?? ''),
    queryFn: () => api<ImportBatchDto>(`/imports/${id}`),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data && RUNNING.includes(query.state.data.status) ? 1000 : false,
  });

export const useImportItems = (id: string, q: ImportQuery, enabled = true) =>
  useQuery({
    queryKey: importKeys.items(id, q),
    queryFn: () => api<Paginated<ImportPreviewItem>>(`/imports/${id}/items`, { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useImportRecords = (id: string, q: ImportQuery, enabled = true) =>
  useQuery({
    queryKey: importKeys.records(id, q),
    queryFn: () =>
      api<Paginated<ImportItemRecordDto>>(`/imports/${id}/records`, {
        query: { page: q.page, pageSize: q.pageSize },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: q.status === 'APPLYING' ? 1500 : false,
    enabled,
  });

export const useUndoCheck = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: importKeys.undo(id),
    queryFn: () => api<ImportUndoCheckDto>(`/imports/${id}/undo`),
    enabled,
  });

export function useCreateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: ImportKind;
      files: File[];
      options: ImportOptions;
      note?: string;
    }) => {
      const form = new FormData();
      form.append('kind', input.kind);
      form.append('options', JSON.stringify(input.options));
      if (input.note) form.append('note', input.note);
      for (const f of input.files) form.append('files', f, f.name);
      return api<ImportBatchDto>('/imports', { method: 'POST', body: form });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

function useBatchMutation<V>(fn: (id: string, v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...v }: { id: string } & V) => fn(id, v as V),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export const useUpdateImportOptions = () =>
  useBatchMutation<{ options: ImportOptions }>((id, v) =>
    api<ImportBatchDto>(`/imports/${id}/options`, { method: 'PUT', body: v.options }),
  );

export const useDecideImportItem = () =>
  useBatchMutation<{ ref: string; decision: ImportDecisionInput }>((id, v) =>
    api<ImportPreviewItem>(`/imports/${id}/items/${encodeURIComponent(v.ref)}`, {
      method: 'PUT',
      body: v.decision,
    }),
  );

export const useDecideAllSuggestions = () =>
  useBatchMutation<{ accepted: boolean }>((id, v) =>
    api<ImportBatchDto>(`/imports/${id}/suggestions`, { method: 'PUT', body: v }),
  );

export const useApplyImport = () =>
  useBatchMutation<object>((id) => api<ImportBatchDto>(`/imports/${id}/apply`, { method: 'POST' }));

export const useCancelImport = () =>
  useBatchMutation<object>((id) =>
    api<ImportBatchDto>(`/imports/${id}/cancel`, { method: 'POST' }),
  );

export const useUndoImport = () =>
  useBatchMutation<object>((id) => api<ImportBatchDto>(`/imports/${id}/undo`, { method: 'POST' }));

export const useDiscardImport = () =>
  useBatchMutation<object>((id) => api<void>(`/imports/${id}`, { method: 'DELETE' }));

// ---------- AI-assisted migration (step 5) ----------

export const proposalKeys = {
  list: (q: ImportQuery) => ['imports', 'proposals', q] as const,
  one: (id: string) => ['imports', 'proposal', id] as const,
};

export const useProposals = (q: ImportQuery) =>
  useQuery({
    queryKey: proposalKeys.list(q),
    queryFn: () => api<Paginated<MigrationProposalDto>>('/migration-ai/proposals', { query: q }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });

export const useProposal = (id: string | undefined) =>
  useQuery({
    queryKey: proposalKeys.one(id ?? ''),
    queryFn: () => api<MigrationProposalDto>(`/migration-ai/proposals/${id}`),
    enabled: !!id,
  });

export function useRunMigrationAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MigrationAiRunInput) =>
      api<MigrationAiRunDto>('/migration-ai/run', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useDecideProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      accept,
      body,
    }: {
      id: string;
      accept: boolean;
      body?: AcceptProposalInput;
    }) =>
      api<MigrationProposalDto>(`/migration-ai/proposals/${id}/${accept ? 'accept' : 'reject'}`, {
        method: 'POST',
        body: body ?? {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

// ---------- Migration tracker and review queue (step 6) ----------

export const useMigrationDashboard = (scope: string) =>
  useQuery({
    queryKey: ['imports', 'migration', 'dashboard', scope],
    queryFn: () => api<MigrationDashboardDto>('/migration/dashboard', { query: { scope } }),
    placeholderData: keepPreviousData,
  });

export const useMigrationItems = (q: ImportQuery) =>
  useQuery({
    queryKey: ['imports', 'migration', 'items', q],
    queryFn: () => api<Paginated<MigrationItemDto>>('/migration/items', { query: q }),
    placeholderData: keepPreviousData,
  });

export const useMyImportedDrafts = (enabled = true) =>
  useQuery({
    queryKey: ['imports', 'migration', 'mine'],
    queryFn: () => api<MigrationItemDto[]>('/migration/my-drafts'),
    enabled,
  });

export function useMigrationBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MigrationBulkInput) =>
      api<MigrationBulkResultDto>('/migration/bulk', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

/** Import settings (D-164): SSO welcome e-mail, AI on imported documents. */
export const useImportSettings = (enabled = true) =>
  useQuery({
    queryKey: ['imports', 'settings'],
    queryFn: () => api<ImportSettings>('/imports/settings'),
    enabled,
  });

export function useSaveImportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportSettings) =>
      api<ImportSettings>('/imports/settings', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['imports', 'settings'] }),
  });
}
