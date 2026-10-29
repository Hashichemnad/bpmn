import { type ReactNode } from 'react';
import { App as AntApp, ConfigProvider, type ConfigProviderProps } from 'antd';
import enUS from 'antd/locale/en_US';
import arEGBase from 'antd/locale/ar_EG';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { LocaleProvider, useLocale } from './LocaleProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { buildTheme } from './theme';

/** Ant Design's Arabic locale has no text for optional form fields ("(optional)" otherwise). */
const arEG: ConfigProviderProps['locale'] = {
  ...arEGBase,
  Form: { defaultValidateMessages: {}, ...arEGBase.Form, optional: '(اختياري)' },
};

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
    <ConfigProvider
      direction={dir}
      locale={locale === 'ar' ? arEG : enUS}
      theme={buildTheme(locale)}
    >
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
