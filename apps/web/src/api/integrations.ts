import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiKeyCreateInput,
  ApiKeyDto,
  ApiKeySecretDto,
  ApiKeyUpdateInput,
  ApiKeyUsageDto,
  ApiSettings,
  DemoStatusDto,
  Paginated,
  WebhookCreateInput,
  WebhookDeliveryDto,
  WebhookDto,
  WebhookKind,
  WebhookSecretDto,
  WebhookSettings,
  WebhookUpdateInput,
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
  webhooks: (kind: WebhookKind) => ['integrations', 'webhooks', kind] as const,
  deliveries: (id: string, page: number, status?: string) =>
    ['integrations', 'deliveries', id, page, status] as const,
  webhookSettings: ['integrations', 'webhook-settings'] as const,
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

// ---------- Webhooks and Teams destinations ----------

export const useWebhooks = (kind: WebhookKind) =>
  useQuery({
    queryKey: integrationKeys.webhooks(kind),
    queryFn: () => api<WebhookDto[]>('/integrations/webhooks', { query: { kind } }),
  });

export const useWebhookDeliveries = (id: string | undefined, page: number, status?: string) =>
  useQuery({
    queryKey: integrationKeys.deliveries(id ?? '', page, status),
    queryFn: () =>
      api<Paginated<WebhookDeliveryDto>>(`/integrations/webhooks/${id}/deliveries`, {
        query: { page, pageSize: 20, status },
      }),
    enabled: !!id,
    refetchInterval: 10_000,
  });

export const useWebhookSettings = () =>
  useQuery({
    queryKey: integrationKeys.webhookSettings,
    queryFn: () => api<WebhookSettings>('/integrations/webhook-settings'),
  });

export function useCreateWebhook() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: WebhookCreateInput) =>
      api<WebhookSecretDto>('/integrations/webhooks', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateWebhook() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WebhookUpdateInput }) =>
      api<WebhookDto>(`/integrations/webhooks/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteWebhook() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/integrations/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useRotateWebhookSecret() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api<WebhookSecretDto>(`/integrations/webhooks/${id}/secret`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useTestWebhook() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api<WebhookDeliveryDto>(`/integrations/webhooks/${id}/test`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useResendDelivery() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, deliveryId }: { id: string; deliveryId: string }) =>
      api<WebhookDeliveryDto>(`/integrations/webhooks/${id}/deliveries/${deliveryId}/resend`, {
        method: 'POST',
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateWebhookSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: WebhookSettings) =>
      api<WebhookSettings>('/integrations/webhook-settings', { method: 'PUT', body }),
    onSuccess: invalidate,
  });
}

// ---------- Demo installation warning (D-180) ----------

export const demoStatusKey = ['settings', 'demo-status'] as const;

export const useDemoStatus = (enabled: boolean) =>
  useQuery({
    queryKey: demoStatusKey,
    queryFn: () => api<DemoStatusDto>('/settings/demo-status'),
    enabled,
    staleTime: 60_000,
  });

export function useClearDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DemoStatusDto>('/settings/demo-status/clear', { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(demoStatusKey, data),
  });
}
