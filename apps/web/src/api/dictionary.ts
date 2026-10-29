import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateObjectInput,
  LabelSourceType,
  LabelSuggestionDto,
  RenameObjectInput,
  RenamePreviewDto,
  RenamePreviewInput,
  RenameProcessDto,
  RepoObjectDto,
  UpdateObjectInput,
} from '@processhub/shared';
import { api } from './client';

/** Dictionary (Modeler design B2): label autocomplete, term proposals and rename with preview. */
export const dictionaryKeys = {
  suggest: (q: string, types: readonly LabelSourceType[]) =>
    ['dictionary', 'suggest', q, types.join(',')] as const,
};

/** Suggestions for a label being typed (debounce `q` in the caller); off for fewer than 2 characters. */
export const useLabelSuggestions = (
  q: string,
  types: readonly LabelSourceType[] = ['TERM', 'ROLE', 'SYSTEM'],
  enabled = true,
) =>
  useQuery({
    queryKey: dictionaryKeys.suggest(q.trim(), types),
    queryFn: () =>
      api<LabelSuggestionDto[]>('/dictionary/suggest', {
        query: { q: q.trim(), types: types.join(','), limit: 8 },
      }),
    enabled: enabled && q.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** Fetches suggestions outside React (canvas label editing). */
export const fetchLabelSuggestions = (q: string, types: readonly LabelSourceType[]) =>
  api<LabelSuggestionDto[]>('/dictionary/suggest', {
    query: { q: q.trim(), types: types.join(','), limit: 8 },
  });

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['objects'] }),
    qc.invalidateQueries({ queryKey: ['dictionary'] }),
  ]);

/** Creates (proposes) or edits a dictionary term through the dictionary endpoints. */
export function useSaveTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateObjectInput | UpdateObjectInput }) =>
      id
        ? api<RepoObjectDto>(`/dictionary/terms/${id}`, { method: 'PATCH', body })
        : api<RepoObjectDto>('/dictionary/terms', { method: 'POST', body }),
    onSuccess: () => invalidate(qc),
  });
}

export function useApproveTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<RepoObjectDto>(`/dictionary/terms/${id}/approve`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useRejectTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<void>(`/dictionary/terms/${id}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => invalidate(qc),
  });
}

export const useRenamePreview = () =>
  useMutation({
    mutationFn: ({ id, body }: { id: string; body: RenamePreviewInput }) =>
      api<RenamePreviewDto>(`/dictionary/objects/${id}/rename-preview`, {
        method: 'POST',
        body,
      }),
  });

export function useRenameObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RenameObjectInput }) =>
      api<{ object: RepoObjectDto; processes: RenameProcessDto[] }>(
        `/dictionary/objects/${id}/rename`,
        { method: 'POST', body },
      ),
    onSuccess: () =>
      Promise.all([invalidate(qc), qc.invalidateQueries({ queryKey: ['processes'] })]),
  });
}
