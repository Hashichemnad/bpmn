import { Navigate, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { usePublicSettings } from '@/api/hooks';
import { LoadingState } from '@/components/states';
import { RequirePermission } from '@/components/RequirePermission';
import { lazyPage } from '@/app/lazyPage';
import { SuspenseOutlet } from '@/app/SuspenseOutlet';

const ProcessHousePage = lazyPage(
  () => import('@/features/processes/ProcessHousePage'),
  'ProcessHousePage',
);

/** Route elements of the router in App.tsx: sign-in and workspace guards, home and not-found. */

/** Applies the organisation's default language for visitors who have not chosen one. */
export function DefaultLocale() {
  const settings = usePublicSettings();
  const { explicit, locale, setLocale } = useLocale();
  useEffect(() => {
    if (!explicit && settings.data && settings.data.defaultLocale !== locale)
      setLocale(settings.data.defaultLocale);
  }, [explicit, settings.data, locale, setLocale]);
  return <SuspenseOutlet />;
}

export function RequireAuth() {
  const { user, loading, signedOut } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState />;
  if (!user) {
    // After an explicit sign-out the next user starts on the home page.
    const state = signedOut ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <SuspenseOutlet />;
}

/** Workspace home; Viewers (portal only) land in the Knowledge Portal. */
export function Home() {
  const { can } = useAuth();
  if (!can(PERMISSIONS.PROCESSES_READ) && can(PERMISSIONS.PORTAL_READ)) {
    return <Navigate to="/portal" replace />;
  }
  return (
    <RequirePermission all={[PERMISSIONS.PROCESSES_READ]}>
      <ProcessHousePage />
    </RequirePermission>
  );
}

/** Pages only for users with workspace access; Viewers are sent to the portal. */
/** Workspace pages that people without the workspace open in the portal (from notifications). */
const PORTAL_EQUIVALENTS: [RegExp, string][] = [
  [/^\/grc\/issues\/([^/]+)$/, '/portal/issues/$1'],
  [/^\/grc\/findings\/([^/]+)$/, '/portal/findings/$1'],
  [/^\/surveys\/([^/]+)$/, '/portal/surveys/$1'],
  [/^\/workflow\/(tasks|cases)\/([^/]+)$/, '/portal/workflow/$1/$2'],
  [/^\/workflow\/requests$/, '/portal/requests'],
];

export function WorkspaceOnly() {
  const { canAny } = useAuth();
  const location = useLocation();
  if (
    !canAny(
      PERMISSIONS.PROCESSES_READ,
      PERMISSIONS.DOCS_READ,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    )
  ) {
    const match = PORTAL_EQUIVALENTS.find(([re]) => re.test(location.pathname));
    return (
      <Navigate to={match ? location.pathname.replace(match[0], match[1]) : '/portal'} replace />
    );
  }
  return <SuspenseOutlet />;
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <Result
      status="404"
      title={t('notFoundTitle')}
      subTitle={t('notFoundText')}
      extra={
        <Button type="primary" href="/">
          {t('nav.processHouse')}
        </Button>
      }
    />
  );
}
