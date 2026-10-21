import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser, LoginInput, Permission } from '@processhub/shared';
import { ApiError, api, onSessionExpired } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  /** True after an explicit sign-out (the next sign-in should not return to the previous page). */
  signedOut: boolean;
  login: (input: LoginInput) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  can: (...permissions: Permission[]) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  setUser: (user: CurrentUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

async function fetchMe(): Promise<CurrentUser | null> {
  try {
    return await api<CurrentUser>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Access token may have expired: try a silent refresh once.
      try {
        await api('/auth/refresh', { method: 'POST' });
        return await api<CurrentUser>('/auth/me');
      } catch {
        return null;
      }
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setLocale, locale } = useLocale();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity, retry: false });
  const user = me.data ?? null;
  // A ref, not state: it must be set before the cache update re-renders the route guards.
  const signedOutRef = useRef(false);

  useEffect(
    () =>
      onSessionExpired(() => {
        qc.setQueryData(ME_KEY, null);
      }),
    [qc],
  );

  // The user's saved language wins once signed in.
  useEffect(() => {
    if (user && user.locale !== locale) setLocale(user.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.locale]);

  // Drop cached data of the previous session, but keep the observed "me" query.
  const clearUserData = useCallback(
    () =>
      qc.removeQueries({
        predicate: (q) => q.queryKey[0] !== 'auth' && q.queryKey.join('/') !== 'settings/public',
      }),
    [qc],
  );

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await api<{ user: CurrentUser }>('/auth/login', { method: 'POST', body: input });
      qc.setQueryData(ME_KEY, res.user);
      clearUserData();
      signedOutRef.current = false;
      return res.user;
    },
    [qc, clearUserData],
  );

  const logout = useCallback(async () => {
    // Set before the request: requests failing with 401 meanwhile also clear the session.
    signedOutRef.current = true;
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      qc.setQueryData(ME_KEY, null);
      clearUserData();
    }
  }, [qc, clearUserData]);

  const value = useMemo<AuthContextValue>(() => {
    const perms = new Set(user?.permissions ?? []);
    return {
      user,
      loading: me.isLoading,
      signedOut: signedOutRef.current,
      login,
      logout,
      can: (...p) => p.every((x) => perms.has(x)),
      canAny: (...p) => p.some((x) => perms.has(x)),
      setUser: (u) => qc.setQueryData(ME_KEY, u),
    };
  }, [user, me.isLoading, login, logout, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
