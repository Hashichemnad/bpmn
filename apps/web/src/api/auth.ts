import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuthSettingsDto,
  AuthSettingsInput,
  AuthTestResultDto,
  MfaConfirmInput,
  MfaRecoveryCodesDto,
  MfaSetupDto,
  MfaStatusDto,
  PublicAuthDto,
} from '@processhub/shared';
import { api } from './client';

/** Keys start with 'auth' so they survive the per-session cache clean-up (see AuthProvider). */
export const authKeys = {
  options: ['auth', 'options'] as const,
  mfa: ['auth', 'mfa'] as const,
  settings: ['settings', 'auth'] as const,
};

/** Sign-in options for the login page (SSO button, password sign-in on/off). */
export const useAuthOptions = () =>
  useQuery({
    queryKey: authKeys.options,
    queryFn: () => api<PublicAuthDto>('/auth/options'),
    staleTime: 60_000,
  });

// ---------- Two-factor authentication (own account) ----------

export const useMfaStatus = () =>
  useQuery({ queryKey: authKeys.mfa, queryFn: () => api<MfaStatusDto>('/auth/mfa') });

export const useMfaSetup = () =>
  useMutation({
    mutationFn: (password: string) =>
      api<MfaSetupDto>('/auth/mfa/setup', { method: 'POST', body: { password } }),
  });

function useMfaMutation<I, O>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: I) => api<O>(path, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: authKeys.mfa });
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

export const useMfaEnable = () =>
  useMfaMutation<{ code: string }, MfaRecoveryCodesDto>('/auth/mfa/enable');
export const useMfaDisable = () => useMfaMutation<MfaConfirmInput, void>('/auth/mfa/disable');
export const useMfaRecoveryCodes = () =>
  useMfaMutation<MfaConfirmInput, MfaRecoveryCodesDto>('/auth/mfa/recovery-codes');

/** Admin: remove a user's 2FA (lost phone). */
export function useResetUserMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/users/${id}/mfa/reset`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/** Admin: end all sessions of a user on every device (SEC-38). */
export function useRevokeUserSessions() {
  return useMutation({
    mutationFn: (id: string) => api<void>(`/users/${id}/sessions/revoke`, { method: 'POST' }),
  });
}

// ---------- Settings → Authentication (Super Admin) ----------

export const useAuthSettings = () =>
  useQuery({
    queryKey: authKeys.settings,
    queryFn: () => api<AuthSettingsDto>('/settings/auth'),
  });

export function useUpdateAuthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AuthSettingsInput) =>
      api<AuthSettingsDto>('/settings/auth', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(authKeys.settings, data);
      void qc.invalidateQueries({ queryKey: authKeys.options });
    },
  });
}

export const useTestAuthSettings = () =>
  useMutation({
    mutationFn: (body: AuthSettingsInput) =>
      api<AuthTestResultDto>('/settings/auth/test', { method: 'POST', body }),
  });
