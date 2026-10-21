import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiSettingsDto,
  AiSettingsInput,
  AiStatusDto,
  AiTestResultDto,
  AiUsageReportDto,
} from '@processhub/shared';
import { ApiError, api, apiStream } from './client';

export const aiKeys = {
  status: ['ai', 'status'] as const,
  settings: ['ai', 'settings'] as const,
  usage: (month?: string) => ['ai', 'usage', month ?? ''] as const,
};

/** Whether the assistant is available to the current user (every ✨ AI button depends on it). */
export const useAiStatus = (enabled = true) =>
  useQuery({
    queryKey: aiKeys.status,
    queryFn: () => api<AiStatusDto>('/ai/status'),
    staleTime: 60_000,
    enabled,
  });

export const useAiSettings = () =>
  useQuery({ queryKey: aiKeys.settings, queryFn: () => api<AiSettingsDto>('/ai/settings') });

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiSettingsInput) =>
      api<AiSettingsDto>('/ai/settings', { method: 'PUT', body }),
    onSuccess: (dto) => {
      qc.setQueryData(aiKeys.settings, dto);
      void qc.invalidateQueries({ queryKey: aiKeys.status });
    },
  });
}

export const useTestAi = () =>
  useMutation({
    mutationFn: (body: AiSettingsInput) =>
      api<AiTestResultDto>('/ai/settings/test', { method: 'POST', body }),
  });

export const useAiUsage = (month?: string) =>
  useQuery({
    queryKey: aiKeys.usage(month),
    queryFn: () => api<AiUsageReportDto>('/ai/usage', { query: { month } }),
  });

export interface AiStreamHandlers {
  onDelta?: (text: string) => void;
  onProgress?: (chars: number) => void;
  signal?: AbortSignal;
}

/**
 * Runs a streamed AI request and resolves with its result. An `error` event is thrown as an
 * ApiError with the AI error code (translated through errors.json like any API error).
 */
export async function runAi<T>(path: string, body: unknown, h: AiStreamHandlers = {}): Promise<T> {
  let result: T | undefined;
  let failure: ApiError | undefined;
  await apiStream(
    path,
    body,
    (e) => {
      if (e.event === 'delta') h.onDelta?.((e.data as { text: string }).text);
      else if (e.event === 'progress') h.onProgress?.((e.data as { chars: number }).chars);
      else if (e.event === 'result') result = e.data as T;
      else if (e.event === 'error') {
        const d = e.data as { code: string; message: string; details?: unknown };
        failure = new ApiError(200, d.code, d.message, d.details);
      }
    },
    h.signal,
  );
  if (failure) throw failure;
  if (result === undefined) throw new ApiError(0, 'AI_PROVIDER_ERROR', 'The response ended early');
  return result;
}
