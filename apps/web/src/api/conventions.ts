import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelingConventions } from '@processhub/shared';
import { api } from './client';

const KEY = ['settings', 'modeling-conventions'] as const;

/** Modeling conventions (D-088): read by everyone in the workspace (Validation panel). */
export const useConventions = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<ModelingConventions>('/settings/modeling-conventions'),
    enabled,
    staleTime: 60_000,
  });

export function useSaveConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModelingConventions) =>
      api<ModelingConventions>('/settings/modeling-conventions', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
