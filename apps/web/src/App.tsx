import {
  Navigate,
  Outlet,
  createBrowserRouter,
  useLocation,
  type RouteObject,
} from 'react-router-dom';
import { Result, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { usePublicSettings } from '@/api/hooks';
import { LoadingState } from '@/components/states';
import { RequirePermission } from '@/components/RequirePermission';
import { AppLayout } from '@/layout/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { UsersPage } from '@/features/admin/UsersPage';
import { DepartmentsPage } from '@/features/admin/DepartmentsPage';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ProcessHousePage } from '@/features/processes/ProcessHousePage';
import { RepositoryLayout } from '@/features/processes/RepositoryLayout';
import { ProcessListPage } from '@/features/processes/ProcessListPage';
import { ProcessDetailPage } from '@/features/processes/ProcessDetailPage';
import { ObjectLibraryPage } from '@/features/objects/ObjectLibraryPage';
import { ObjectDetailPage } from '@/features/objects/ObjectDetailPage';

/** Applies the organisation's default language for visitors who have not chosen one. */
function DefaultLocale() {
  const settings = usePublicSettings();
  const { explicit, locale, setLocale } = useLocale();
  useEffect(() => {
    if (!explicit && settings.data && settings.data.defaultLocale !== locale)
      setLocale(settings.data.defaultLocale);
  }, [explicit, settings.data, locale, setLocale]);
  return <Outlet />;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function NotFound() {
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

const P = PERMISSIONS;

export const routes: RouteObject[] = [
  {
    element: <DefaultLocale />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              {
                index: true,
                element: (
                  <RequirePermission all={[P.PROCESSES_READ]}>
                    <ProcessHousePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'processes',
                element: (
                  <RequirePermission all={[P.PROCESSES_READ]}>
                    <RepositoryLayout />
                  </RequirePermission>
                ),
                children: [
                  { index: true, element: <ProcessListPage /> },
                  { path: ':id', element: <ProcessDetailPage /> },
                ],
              },
              {
                path: 'library/roles',
                element: (
                  <RequirePermission all={[P.OBJECTS_READ]}>
                    <ObjectLibraryPage key="ROLE" type="ROLE" />
                  </RequirePermission>
                ),
              },
              {
                path: 'library/systems',
                element: (
                  <RequirePermission all={[P.OBJECTS_READ]}>
                    <ObjectLibraryPage key="SYSTEM" type="SYSTEM" />
                  </RequirePermission>
                ),
              },
              {
                path: 'library/objects/:id',
                element: (
                  <RequirePermission all={[P.OBJECTS_READ]}>
                    <ObjectDetailPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/users',
                element: (
                  <RequirePermission all={[P.USERS_MANAGE]}>
                    <UsersPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/departments',
                element: (
                  <RequirePermission all={[P.DEPARTMENTS_MANAGE]}>
                    <DepartmentsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/audit',
                element: (
                  <RequirePermission all={[P.AUDIT_READ]}>
                    <AuditLogPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'settings',
                element: (
                  <RequirePermission all={[P.SETTINGS_MANAGE]}>
                    <SettingsPage />
                  </RequirePermission>
                ),
              },
              { path: 'profile', element: <ProfilePage /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];

export const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

export const createRouter = () => createBrowserRouter(routes, { future: ROUTER_FUTURE });
