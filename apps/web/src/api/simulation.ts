import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiScenarioProposal,
  CreateSimulationInput,
  MiningJobDto,
  ScenarioInput,
  SimulationDto,
  SimulationListItemDto,
  UpdateSimulationInput,
} from '@processhub/shared';
import { api, apiDownload } from './client';

/** Simulation (Phase 5.1): simulations of a process, scenarios, runs, comparison, AI. */
export const simKeys = {
  all: ['simulations'] as const,
  list: (processId?: string) => ['simulations', 'list', processId ?? ''] as const,
  item: (id: string) => ['simulations', 'one', id] as const,
};

export const useSimulations = (processId?: string, enabled = true) =>
  useQuery({
    queryKey: simKeys.list(processId),
    queryFn: () => api<SimulationListItemDto[]>('/simulations', { query: { processId } }),
    enabled,
  });

export const useSimulation = (id: string | undefined) =>
  useQuery({
    queryKey: simKeys.item(id ?? ''),
    queryFn: () => api<SimulationDto>(`/simulations/${id}`),
    enabled: !!id,
    // While scenarios run the results arrive on the server.
    refetchInterval: (q) => (q.state.data?.job ? 1500 : false),
  });

function useSet() {
  const qc = useQueryClient();
  return (dto: SimulationDto) => {
    qc.setQueryData(simKeys.item(dto.id), dto);
    void qc.invalidateQueries({ queryKey: ['simulations', 'list'] });
  };
}

export function useCreateSimulation() {
  const set = useSet();
  return useMutation({
    mutationFn: (body: Partial<CreateSimulationInput>) =>
      api<SimulationDto>('/simulations', { method: 'POST', body }),
    onSuccess: set,
  });
}

export function useUpdateSimulation(id: string) {
  const set = useSet();
  return useMutation({
    mutationFn: (body: UpdateSimulationInput) =>
      api<SimulationDto>(`/simulations/${id}`, { method: 'PATCH', body }),
    onSuccess: set,
  });
}

export function useDeleteSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/simulations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: simKeys.all }),
  });
}

export function useSaveScenario(id: string) {
  const set = useSet();
  return useMutation({
    mutationFn: (v: { scenarioId?: string; body: ScenarioInput }) =>
      api<SimulationDto>(
        v.scenarioId
          ? `/simulations/${id}/scenarios/${v.scenarioId}`
          : `/simulations/${id}/scenarios`,
        { method: v.scenarioId ? 'PATCH' : 'POST', body: v.body },
      ),
    onSuccess: set,
  });
}

export function useDeleteScenario(id: string) {
  const set = useSet();
  return useMutation({
    mutationFn: (scenarioId: string) =>
      api<SimulationDto>(`/simulations/${id}/scenarios/${scenarioId}`, { method: 'DELETE' }),
    onSuccess: set,
  });
}

export function useRunSimulation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenarioIds?: string[]) =>
      api<MiningJobDto[]>(`/simulations/${id}/run`, { method: 'POST', body: { scenarioIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: simKeys.item(id) }),
  });
}

export function useSimulationAi(id: string) {
  return {
    explain: useMutation({
      mutationFn: () => api<{ text: string }>(`/simulations/${id}/ai/explain`, { method: 'POST' }),
    }),
    suggest: useMutation({
      mutationFn: () =>
        api<{ proposals: AiScenarioProposal[] }>(`/simulations/${id}/ai/suggest`, {
          method: 'POST',
        }),
    }),
  };
}

export async function exportSimulation(id: string) {
  const file = await apiDownload(`/simulations/${id}/export`, {}, 'simulation.xlsx');
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
