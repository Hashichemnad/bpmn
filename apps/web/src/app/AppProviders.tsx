import { type ReactNode } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import arEG from 'antd/locale/ar_EG';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { LocaleProvider, useLocale } from './LocaleProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { buildTheme } from './theme';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

function ThemedApp({ children }: { children: ReactNode }) {
  const { locale, dir } = useLocale();
  return (
    <ConfigProvider direction={dir} locale={locale === 'ar' ? arEG : enUS} theme={buildTheme(locale)}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

export function AppProviders({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ThemedApp>
          <AuthProvider>{children}</AuthProvider>
        </ThemedApp>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
