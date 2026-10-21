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
import { SpacesPage } from '@/features/docs/SpacesPage';
import { SpaceLayout } from '@/features/docs/SpaceLayout';
import { SpaceHomePage } from '@/features/docs/SpaceHomePage';
import { PageViewPage } from '@/features/docs/PageViewPage';
import { PageEditorPage } from '@/features/docs/PageEditorPage';
import { PageHistoryPage } from '@/features/docs/PageHistoryPage';
import { TrashPage } from '@/features/docs/TrashPage';
import { TemplatesPage } from '@/features/docs/TemplatesPage';
import { PrintPage } from '@/features/docs/PrintPage';
import { SearchPage } from '@/features/search/SearchPage';
import { SyncStatusPage } from '@/features/settings/SyncStatusPage';
import { AiUsagePage } from '@/features/settings/AiUsagePage';
import { ReviewPage } from '@/features/governance/ReviewPage';
import { MyTasksPage } from '@/features/governance/MyTasksPage';
import { GovernanceDashboardPage } from '@/features/governance/GovernanceDashboardPage';
import { WorkflowsSettingsPage } from '@/features/governance/WorkflowsSettingsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { PortalLayout } from '@/features/portal/PortalLayout';
import { PortalHomePage } from '@/features/portal/PortalHomePage';
import { PortalProcessesPage } from '@/features/portal/PortalProcessesPage';
import { PortalProcessPage } from '@/features/portal/PortalProcessPage';
import { PortalDocsPage } from '@/features/portal/PortalDocsPage';
import { PortalSpacePage } from '@/features/portal/PortalSpacePage';
import { PortalPagePage } from '@/features/portal/PortalPagePage';
import { PortalSearchPage } from '@/features/portal/PortalSearchPage';
import { MyProcessesPage } from '@/features/portal/MyProcessesPage';
import { MyFeedbackPage } from '@/features/portal/MyFeedbackPage';
import { PortalSettingsPage } from '@/features/portal/PortalSettingsPage';
import { PortalPrintProcess } from '@/features/portal/PortalPrintProcess';
import { PortalPrintPage } from '@/features/portal/PortalPrintPage';

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
  const { user, loading, signedOut } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState />;
  if (!user) {
    // After an explicit sign-out the next user starts on the home page.
    const state = signedOut ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Workspace home; Viewers (portal only) land in the Knowledge Portal. */
function Home() {
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
function WorkspaceOnly() {
  const { canAny } = useAuth();
  if (
    !canAny(
      PERMISSIONS.PROCESSES_READ,
      PERMISSIONS.DOCS_READ,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    )
  ) {
    return <Navigate to="/portal" replace />;
  }
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
            path: 'print/pages/:pageId',
            element: (
              <RequirePermission all={[P.DOCS_READ]}>
                <PrintPage />
              </RequirePermission>
            ),
          },
          {
            path: 'portal/print/processes/:processId',
            element: (
              <RequirePermission all={[P.PORTAL_READ]}>
                <PortalPrintProcess />
              </RequirePermission>
            ),
          },
          {
            path: 'portal/print/pages/:pageId',
            element: (
              <RequirePermission all={[P.PORTAL_READ]}>
                <PortalPrintPage />
              </RequirePermission>
            ),
          },
          {
            path: 'portal',
            element: (
              <RequirePermission all={[P.PORTAL_READ]}>
                <PortalLayout />
              </RequirePermission>
            ),
            children: [
              { index: true, element: <PortalHomePage /> },
              { path: 'processes', element: <PortalProcessesPage /> },
              { path: 'processes/:processId', element: <PortalProcessPage /> },
              { path: 'docs', element: <PortalDocsPage /> },
              { path: 'docs/:spaceId', element: <PortalSpacePage /> },
              { path: 'pages/:pageId', element: <PortalPagePage /> },
              { path: 'search', element: <PortalSearchPage /> },
              { path: 'my', element: <MyProcessesPage /> },
              { path: 'feedback', element: <MyFeedbackPage /> },
              { path: 'notifications', element: <NotificationsPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: '*', element: <NotFound /> },
            ],
          },
          {
            element: <WorkspaceOnly />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { index: true, element: <Home /> },
                  {
                    path: 'reviews/:reviewId',
                    element: (
                      <RequirePermission any={[P.PROCESSES_READ, P.DOCS_READ]}>
                        <ReviewPage />
                      </RequirePermission>
                    ),
                  },
                  { path: 'tasks', element: <MyTasksPage /> },
                  { path: 'notifications', element: <NotificationsPage /> },
                  {
                    path: 'governance',
                    element: (
                      <RequirePermission all={[P.GOVERNANCE_DASHBOARD]}>
                        <GovernanceDashboardPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'settings/workflows',
                    element: (
                      <RequirePermission all={[P.GOVERNANCE_MANAGE]}>
                        <WorkflowsSettingsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'settings/portal',
                    element: (
                      <RequirePermission all={[P.PORTAL_MANAGE]}>
                        <PortalSettingsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'library/documents',
                    element: (
                      <RequirePermission all={[P.OBJECTS_READ]}>
                        <ObjectLibraryPage key="DOCUMENT" type="DOCUMENT" />
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
                    path: 'docs',
                    element: (
                      <RequirePermission all={[P.DOCS_READ]}>
                        <SpacesPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'docs/templates',
                    element: (
                      <RequirePermission all={[P.DOCS_MANAGE]}>
                        <TemplatesPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'docs/:spaceId',
                    element: (
                      <RequirePermission all={[P.DOCS_READ]}>
                        <SpaceLayout />
                      </RequirePermission>
                    ),
                    children: [
                      { index: true, element: <SpaceHomePage /> },
                      { path: 'trash', element: <TrashPage /> },
                      { path: 'pages/:pageId', element: <PageViewPage /> },
                      { path: 'pages/:pageId/edit', element: <PageEditorPage /> },
                      { path: 'pages/:pageId/history', element: <PageHistoryPage /> },
                    ],
                  },
                  {
                    path: 'search',
                    element: (
                      <RequirePermission any={[P.DOCS_READ, P.PROCESSES_READ]}>
                        <SearchPage />
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
                    path: 'admin/ai-usage',
                    element: (
                      <RequirePermission all={[P.AI_USAGE_READ]}>
                        <AiUsagePage />
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
                  {
                    path: 'settings/integrations/sync',
                    element: (
                      <RequirePermission all={[P.SETTINGS_MANAGE]}>
                        <SyncStatusPage />
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
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
