import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssuranceTasksDto, GrcChangeDecisionInput, GrcChangeDto } from '@processhub/shared';
import { api } from './client';
import { grcKeys } from './grc';

/** Assurance (Phase 4.2): change approvals, control tests, issues, audits, surveys. */
export const assuranceKeys = {
  all: ['assurance'] as const,
  tasks: ['assurance', 'tasks'] as const,
  changes: (q: Record<string, string | undefined>) => ['assurance', 'changes', q] as const,
};

export const useGrcChanges = (q: Record<string, string | undefined>, enabled = true) =>
  useQuery({
    queryKey: assuranceKeys.changes(q),
    queryFn: () =>
      api<GrcChangeDto[]>(
        `/grc/changes?${new URLSearchParams(
          Object.entries(q).filter((e): e is [string, string] => !!e[1]),
        )}`,
      ),
    enabled,
  });

export function useDecideGrcChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: GrcChangeDecisionInput }) =>
      api<GrcChangeDto>(`/grc/changes/${id}/decision`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: grcKeys.all });
      void qc.invalidateQueries({ queryKey: assuranceKeys.all });
    },
  });
}

export function useWithdrawGrcChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<GrcChangeDto>(`/grc/changes/${id}/withdraw`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: grcKeys.all });
      void qc.invalidateQueries({ queryKey: assuranceKeys.all });
    },
  });
}

export const useAssuranceTasks = (enabled = true) =>
  useQuery({
    queryKey: assuranceKeys.tasks,
    queryFn: () => api<AssuranceTasksDto>('/assurance/tasks'),
    refetchInterval: 60_000,
    enabled,
  });

/** Number of open assurance tasks (menu badge). */
export const assuranceTaskCount = (d: AssuranceTasksDto | undefined) =>
  d ? Object.values(d).reduce((n, list) => n + (list as unknown[]).length, 0) : 0;
