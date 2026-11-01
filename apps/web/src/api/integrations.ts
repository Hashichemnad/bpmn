import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiKeyCreateInput,
  ApiKeyDto,
  ApiKeySecretDto,
  ApiKeyUpdateInput,
  ApiKeyUsageDto,
  ApiSettings,
} from '@processhub/shared';
import { api } from './client';

/** Settings → Integrations (Phase 4.4): API keys, webhooks, Teams destinations. */
export const integrationKeys = {
  apiKeys: ['integrations', 'api-keys'] as const,
  apiKey: (id: string) => ['integrations', 'api-keys', id] as const,
  usage: (id: string, errors: boolean) =>
    ['integrations', 'api-keys', id, 'usage', errors] as const,
  apiSettings: ['integrations', 'api-settings'] as const,
  renderer: ['integrations', 'renderer'] as const,
};

export const useApiKeys = () =>
  useQuery({
    queryKey: integrationKeys.apiKeys,
    queryFn: () => api<ApiKeyDto[]>('/integrations/api-keys'),
  });

export const useApiKeyUsage = (id: string | undefined, errors = false) =>
  useQuery({
    queryKey: integrationKeys.usage(id ?? '', errors),
    queryFn: () =>
      api<ApiKeyUsageDto>(`/integrations/api-keys/${id}/usage`, {
        query: { status: errors ? 'errors' : 'all' },
      }),
    enabled: !!id,
  });

export const useApiSettings = () =>
  useQuery({
    queryKey: integrationKeys.apiSettings,
    queryFn: () => api<ApiSettings>('/integrations/api-settings'),
  });

export const useRendererStatus = () =>
  useQuery({
    queryKey: integrationKeys.renderer,
    queryFn: () => api<{ status: 'OFF' | 'OK' | 'DOWN' }>('/integrations/renderer'),
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['integrations'] });
}

export function useCreateApiKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: ApiKeyCreateInput) =>
      api<ApiKeySecretDto>('/integrations/api-keys', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateApiKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApiKeyUpdateInput }) =>
      api<ApiKeyDto>(`/integrations/api-keys/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useRotateApiKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api<ApiKeySecretDto>(`/integrations/api-keys/${id}/rotate`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRevokeApiKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api<ApiKeyDto>(`/integrations/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useUpdateApiSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: ApiSettings) =>
      api<ApiSettings>('/integrations/api-settings', { method: 'PUT', body }),
    onSuccess: invalidate,
  });
}
