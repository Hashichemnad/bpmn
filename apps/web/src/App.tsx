import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { lazyPage } from '@/app/lazyPage';
import { PERMISSIONS } from '@processhub/shared';
import { DefaultLocale, Home, NotFound, RequireAuth, WorkspaceOnly } from '@/app/RouteGuards';
import { RequirePermission } from '@/components/RequirePermission';

// Every screen is its own chunk, loaded when first visited (final session, part A). The workspace
// shell too: the login page and the Knowledge Portal (most users) never load it.
const AppLayout = lazyPage(() => import('@/layout/AppLayout'), 'AppLayout');
const LoginPage = lazyPage(() => import('@/features/auth/LoginPage'), 'LoginPage');
const InvitationPage = lazyPage(() => import('@/features/auth/InvitationPage'), 'InvitationPage');
const ProfilePage = lazyPage(() => import('@/features/profile/ProfilePage'), 'ProfilePage');
const UsersPage = lazyPage(() => import('@/features/admin/UsersPage'), 'UsersPage');
const DepartmentsPage = lazyPage(
  () => import('@/features/admin/DepartmentsPage'),
  'DepartmentsPage',
);
const AuditLogPage = lazyPage(() => import('@/features/admin/AuditLogPage'), 'AuditLogPage');
const ImportCenterPage = lazyPage(
  () => import('@/features/imports/ImportCenterPage'),
  'ImportCenterPage',
);
const ImportBatchPage = lazyPage(
  () => import('@/features/imports/ImportBatchPage'),
  'ImportBatchPage',
);
const AiProposalPage = lazyPage(
  () => import('@/features/imports/AiProposalsPage'),
  'AiProposalPage',
);
const AiProposalsPage = lazyPage(
  () => import('@/features/imports/AiProposalsPage'),
  'AiProposalsPage',
);
const MigrationDashboardPage = lazyPage(
  () => import('@/features/imports/MigrationDashboardPage'),
  'MigrationDashboardPage',
);
const ReviewQueuePage = lazyPage(
  () => import('@/features/imports/ReviewQueuePage'),
  'ReviewQueuePage',
);
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const RepositoryLayout = lazyPage(
  () => import('@/features/processes/RepositoryLayout'),
  'RepositoryLayout',
);
const ProcessListPage = lazyPage(
  () => import('@/features/processes/ProcessListPage'),
  'ProcessListPage',
);
const ProcessDetailPage = lazyPage(
  () => import('@/features/processes/ProcessDetailPage'),
  'ProcessDetailPage',
);
const ModelerWorkspacePage = lazyPage(
  () => import('@/features/modeler/ModelerWorkspacePage'),
  'ModelerWorkspacePage',
);
const ObjectLibraryPage = lazyPage(
  () => import('@/features/objects/ObjectLibraryPage'),
  'ObjectLibraryPage',
);
const DictionaryPage = lazyPage(
  () => import('@/features/objects/DictionaryPage'),
  'DictionaryPage',
);
const ObjectDetailPage = lazyPage(
  () => import('@/features/objects/ObjectDetailPage'),
  'ObjectDetailPage',
);
const SpacesPage = lazyPage(() => import('@/features/docs/SpacesPage'), 'SpacesPage');
const SpaceLayout = lazyPage(() => import('@/features/docs/SpaceLayout'), 'SpaceLayout');
const SpaceHomePage = lazyPage(() => import('@/features/docs/SpaceHomePage'), 'SpaceHomePage');
const PageViewPage = lazyPage(() => import('@/features/docs/PageViewPage'), 'PageViewPage');
const PageEditorPage = lazyPage(() => import('@/features/docs/PageEditorPage'), 'PageEditorPage');
const PageHistoryPage = lazyPage(
  () => import('@/features/docs/PageHistoryPage'),
  'PageHistoryPage',
);
const TrashPage = lazyPage(() => import('@/features/docs/TrashPage'), 'TrashPage');
const TemplatesPage = lazyPage(() => import('@/features/docs/TemplatesPage'), 'TemplatesPage');
const PrintPage = lazyPage(() => import('@/features/docs/PrintPage'), 'PrintPage');
const SearchPage = lazyPage(() => import('@/features/search/SearchPage'), 'SearchPage');
const SyncStatusPage = lazyPage(
  () => import('@/features/settings/SyncStatusPage'),
  'SyncStatusPage',
);
const AiUsagePage = lazyPage(() => import('@/features/settings/AiUsagePage'), 'AiUsagePage');
const ReviewPage = lazyPage(() => import('@/features/governance/ReviewPage'), 'ReviewPage');
const MyTasksPage = lazyPage(() => import('@/features/governance/MyTasksPage'), 'MyTasksPage');
const GovernanceDashboardPage = lazyPage(
  () => import('@/features/governance/GovernanceDashboardPage'),
  'GovernanceDashboardPage',
);
const WorkflowsSettingsPage = lazyPage(
  () => import('@/features/governance/WorkflowsSettingsPage'),
  'WorkflowsSettingsPage',
);
const NotificationsPage = lazyPage(
  () => import('@/features/notifications/NotificationsPage'),
  'NotificationsPage',
);
const PortalLayout = lazyPage(() => import('@/features/portal/PortalLayout'), 'PortalLayout');
const PortalHomePage = lazyPage(() => import('@/features/portal/PortalHomePage'), 'PortalHomePage');
const PortalProcessesPage = lazyPage(
  () => import('@/features/portal/PortalProcessesPage'),
  'PortalProcessesPage',
);
const PortalProcessPage = lazyPage(
  () => import('@/features/portal/PortalProcessPage'),
  'PortalProcessPage',
);
const PortalDocsPage = lazyPage(() => import('@/features/portal/PortalDocsPage'), 'PortalDocsPage');
const PortalSpacePage = lazyPage(
  () => import('@/features/portal/PortalSpacePage'),
  'PortalSpacePage',
);
const PortalPagePage = lazyPage(() => import('@/features/portal/PortalPagePage'), 'PortalPagePage');
const PortalSearchPage = lazyPage(
  () => import('@/features/portal/PortalSearchPage'),
  'PortalSearchPage',
);
const MyProcessesPage = lazyPage(
  () => import('@/features/portal/MyProcessesPage'),
  'MyProcessesPage',
);
const MyFeedbackPage = lazyPage(() => import('@/features/portal/MyFeedbackPage'), 'MyFeedbackPage');
const PortalSettingsPage = lazyPage(
  () => import('@/features/portal/PortalSettingsPage'),
  'PortalSettingsPage',
);
const ConventionsSettingsPage = lazyPage(
  () => import('@/features/settings/ConventionsSettingsPage'),
  'ConventionsSettingsPage',
);
const PortalPrintProcess = lazyPage(
  () => import('@/features/portal/PortalPrintProcess'),
  'PortalPrintProcess',
);
const PortalPrintPage = lazyPage(
  () => import('@/features/portal/PortalPrintPage'),
  'PortalPrintPage',
);
const GrcRegisterPage = lazyPage(() => import('@/features/grc/GrcRegisterPage'), 'GrcRegisterPage');
const GrcDetailPage = lazyPage(() => import('@/features/grc/GrcDetailPage'), 'GrcDetailPage');
const GrcSettingsPage = lazyPage(() => import('@/features/grc/GrcSettingsPage'), 'GrcSettingsPage');
const GrcDashboardPage = lazyPage(
  () => import('@/features/grc/GrcDashboardPage'),
  'GrcDashboardPage',
);
const ControlTestsPage = lazyPage(
  () => import('@/features/assurance/ControlTestsPage'),
  'ControlTestsPage',
);
const ControlTestPage = lazyPage(
  () => import('@/features/assurance/ControlTestPage'),
  'ControlTestPage',
);
const IssuesPage = lazyPage(() => import('@/features/assurance/IssuesPage'), 'IssuesPage');
const IssuePage = lazyPage(() => import('@/features/assurance/IssuePage'), 'IssuePage');
const PortalTasksPage = lazyPage(
  () => import('@/features/assurance/PortalTasksPage'),
  'PortalTasksPage',
);
const AuditPlanPage = lazyPage(() => import('@/features/assurance/AuditPlanPage'), 'AuditPlanPage');
const EngagementPage = lazyPage(
  () => import('@/features/assurance/EngagementPage'),
  'EngagementPage',
);
const FindingPage = lazyPage(() => import('@/features/assurance/FindingPage'), 'FindingPage');
const SurveysPage = lazyPage(() => import('@/features/assurance/SurveysPage'), 'SurveysPage');
const QuestionnaireBuilderPage = lazyPage(
  () => import('@/features/assurance/QuestionnaireBuilderPage'),
  'QuestionnaireBuilderPage',
);
const CampaignPage = lazyPage(() => import('@/features/assurance/CampaignPage'), 'CampaignPage');
const SurveyResponsePage = lazyPage(
  () => import('@/features/assurance/SurveyResponsePage'),
  'SurveyResponsePage',
);
const AssuranceDashboardPage = lazyPage(
  () => import('@/features/assurance/AssuranceDashboardPage'),
  'AssuranceDashboardPage',
);
const ApplicationsPage = lazyPage(
  () => import('@/features/ea/ApplicationsPage'),
  'ApplicationsPage',
);
const ApplicationDetailPage = lazyPage(
  () => import('@/features/ea/ApplicationDetailPage'),
  'ApplicationDetailPage',
);
const InterfacesPage = lazyPage(() => import('@/features/ea/InterfacesPage'), 'InterfacesPage');
const DataObjectsPage = lazyPage(() => import('@/features/ea/DataObjectsPage'), 'DataObjectsPage');
const CapabilitiesPage = lazyPage(
  () => import('@/features/ea/CapabilitiesPage'),
  'CapabilitiesPage',
);
const SystemsLibraryRoute = lazyPage(
  () => import('@/features/ea/SystemsLibraryRoute'),
  'SystemsLibraryRoute',
);
const LandscapePage = lazyPage(() => import('@/features/ea/LandscapePage'), 'LandscapePage');
const TraceabilityPage = lazyPage(
  () => import('@/features/ea/TraceabilityPage'),
  'TraceabilityPage',
);
const KpisPage = lazyPage(() => import('@/features/kpi/KpisPage'), 'KpisPage');
const KpiDetailPage = lazyPage(() => import('@/features/kpi/KpiDetailPage'), 'KpiDetailPage');
const ObjectivesPage = lazyPage(() => import('@/features/kpi/ObjectivesPage'), 'ObjectivesPage');
const KpiDashboardPage = lazyPage(
  () => import('@/features/kpi/KpiDashboardPage'),
  'KpiDashboardPage',
);
const LogsPage = lazyPage(() => import('@/features/mining/LogsPage'), 'LogsPage');
const MiningLogPage = lazyPage(() => import('@/features/mining/MiningLogPage'), 'MiningLogPage');
const ImportMappingPage = lazyPage(
  () => import('@/features/mining/ImportWizard'),
  'ImportMappingPage',
);
const UploadLogPage = lazyPage(() => import('@/features/mining/ImportWizard'), 'UploadLogPage');
const SimulationPage = lazyPage(
  () => import('@/features/mining/SimulationPages'),
  'SimulationPage',
);
const SimulationsPage = lazyPage(
  () => import('@/features/mining/SimulationPages'),
  'SimulationsPage',
);
const TaskPage = lazyPage(() => import('@/features/workflow/TaskPage'), 'TaskPage');
const CasePage = lazyPage(() => import('@/features/workflow/CasePage'), 'CasePage');
const MyRequestsPage = lazyPage(
  () => import('@/features/workflow/MyRequestsPage'),
  'MyRequestsPage',
);
const ServiceCataloguePage = lazyPage(
  () => import('@/features/workflow/CataloguePages'),
  'ServiceCataloguePage',
);
const StartRequestPage = lazyPage(
  () => import('@/features/workflow/CataloguePages'),
  'StartRequestPage',
);
const WorkflowDashboardPage = lazyPage(
  () => import('@/features/workflow/MonitorPages'),
  'WorkflowDashboardPage',
);
const WorkflowMonitorPage = lazyPage(
  () => import('@/features/workflow/MonitorPages'),
  'WorkflowMonitorPage',
);
const WorkflowSettingsPage = lazyPage(
  () => import('@/features/workflow/WorkflowSettingsPage'),
  'WorkflowSettingsPage',
);
const SalesforceSettingsPage = lazyPage(
  () => import('@/features/settings/SalesforceSettingsPage'),
  'SalesforceSettingsPage',
);
const DiagramDetailPage = lazyPage(
  () => import('@/features/diagrams/DiagramDetailPage'),
  'DiagramDetailPage',
);
const DiagramWorkspacePage = lazyPage(
  () => import('@/features/diagrams/DiagramWorkspacePage'),
  'DiagramWorkspacePage',
);
const PrintDiagramPage = lazyPage(
  () => import('@/features/diagrams/PrintDiagramPage'),
  'PrintDiagramPage',
);
const PortalDiagramsPage = lazyPage(
  () => import('@/features/diagrams/PortalDiagramsPage'),
  'PortalDiagramsPage',
);
const PortalDiagramPage = lazyPage(
  () => import('@/features/diagrams/PortalDiagramPage'),
  'PortalDiagramPage',
);

const P = PERMISSIONS;

export const routes: RouteObject[] = [
  {
    element: <DefaultLocale />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/invitation/:token', element: <InvitationPage /> },
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
            path: 'portal/print/diagrams/:id',
            element: (
              <RequirePermission all={[P.PORTAL_READ]}>
                <PrintDiagramPage portal />
              </RequirePermission>
            ),
          },
          {
            path: 'print/diagrams/:id',
            element: (
              <RequirePermission all={[P.PROCESSES_READ]}>
                <PrintDiagramPage />
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
              { path: 'diagrams', element: <PortalDiagramsPage /> },
              { path: 'diagrams/:id', element: <PortalDiagramPage /> },
              { path: 'docs', element: <PortalDocsPage /> },
              { path: 'docs/:spaceId', element: <PortalSpacePage /> },
              { path: 'pages/:pageId', element: <PortalPagePage /> },
              { path: 'search', element: <PortalSearchPage /> },
              { path: 'my', element: <MyProcessesPage /> },
              { path: 'feedback', element: <MyFeedbackPage /> },
              { path: 'notifications', element: <NotificationsPage /> },
              { path: 'tasks', element: <PortalTasksPage /> },
              {
                path: 'services',
                element: (
                  <RequirePermission all={[P.WORKFLOW_START]}>
                    <ServiceCataloguePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'services/:processId',
                element: (
                  <RequirePermission all={[P.WORKFLOW_START]}>
                    <StartRequestPage />
                  </RequirePermission>
                ),
              },
              { path: 'requests', element: <MyRequestsPage portal /> },
              { path: 'workflow/cases/:id', element: <CasePage portal /> },
              { path: 'workflow/tasks/:id', element: <TaskPage portal /> },
              { path: 'issues/:id', element: <IssuePage portal /> },
              { path: 'findings/:id', element: <FindingPage portal /> },
              { path: 'surveys/:id', element: <SurveyResponsePage portal /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: '*', element: <NotFound /> },
            ],
          },
          {
            element: <WorkspaceOnly />,
            children: [
              {
                // Full-screen workspace of the other diagram types (D-120).
                path: 'diagrams/:id/edit',
                element: (
                  <RequirePermission all={[P.PROCESSES_READ]}>
                    <DiagramWorkspacePage />
                  </RequirePermission>
                ),
              },
              {
                // Full-screen modeler workspace: no app sidebar, process tree or page header.
                path: 'processes/:id/model',
                element: (
                  <RequirePermission all={[P.PROCESSES_READ]}>
                    <ModelerWorkspacePage />
                  </RequirePermission>
                ),
              },
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
                  { path: 'workflow/tasks/:id', element: <TaskPage /> },
                  { path: 'workflow/cases/:id', element: <CasePage /> },
                  { path: 'workflow/requests', element: <MyRequestsPage /> },
                  {
                    path: 'workflow/monitor',
                    element: (
                      <RequirePermission any={[P.WORKFLOW_MONITOR, P.WORKFLOW_ADMIN]}>
                        <WorkflowMonitorPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'workflow/dashboard',
                    element: (
                      <RequirePermission any={[P.WORKFLOW_MONITOR, P.WORKFLOW_ADMIN]}>
                        <WorkflowDashboardPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'settings/workflow-execution',
                    element: (
                      <RequirePermission all={[P.WORKFLOW_ADMIN]}>
                        <WorkflowSettingsPage />
                      </RequirePermission>
                    ),
                  },
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
                    path: 'settings/salesforce',
                    element: (
                      <RequirePermission any={[P.SETTINGS_MANAGE, P.KPI_SYNC]}>
                        <SalesforceSettingsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'settings/conventions',
                    element: (
                      <RequirePermission all={[P.CONVENTIONS_MANAGE]}>
                        <ConventionsSettingsPage />
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
                    path: 'grc/dashboard',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcDashboardPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/risks',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcRegisterPage key="RISK" type="RISK" />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/risks/:id',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcDetailPage key="RISK" type="RISK" />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/controls',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcRegisterPage key="CONTROL" type="CONTROL" />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/controls/:id',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcDetailPage key="CONTROL" type="CONTROL" />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/requirements',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcRegisterPage key="REQUIREMENT" type="REQUIREMENT" />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/requirements/:id',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <GrcDetailPage key="REQUIREMENT" type="REQUIREMENT" />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/assurance',
                    element: (
                      <RequirePermission any={[P.GRC_READ, P.AUDIT_MANAGE, P.ISSUES_MANAGE]}>
                        <AssuranceDashboardPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/tests',
                    element: (
                      <RequirePermission all={[P.GRC_READ]}>
                        <ControlTestsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/tests/:id',
                    element: (
                      <RequirePermission any={[P.GRC_READ, P.CONTROLS_TEST, P.CONTROLS_REVIEW]}>
                        <ControlTestPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/issues',
                    element: (
                      <RequirePermission any={[P.GRC_READ, P.ISSUES_MANAGE]}>
                        <IssuesPage />
                      </RequirePermission>
                    ),
                  },
                  // Owners of an issue or an action reach it without the registers (checked on the server).
                  { path: 'grc/issues/:id', element: <IssuePage /> },
                  {
                    path: 'grc/audits',
                    element: (
                      <RequirePermission any={[P.AUDIT_MANAGE, P.GRC_EDIT, P.AUDIT_READ]}>
                        <AuditPlanPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/audits/:id',
                    element: (
                      <RequirePermission any={[P.AUDIT_MANAGE, P.GRC_EDIT, P.AUDIT_READ]}>
                        <EngagementPage />
                      </RequirePermission>
                    ),
                  },
                  // Response owners answer their finding without the audit workspace.
                  { path: 'grc/findings/:id', element: <FindingPage /> },
                  {
                    path: 'grc/surveys',
                    element: (
                      <RequirePermission all={[P.SURVEYS_MANAGE]}>
                        <SurveysPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'grc/surveys/questionnaires/:id',
                    element: (
                      <RequirePermission all={[P.SURVEYS_MANAGE]}>
                        <QuestionnaireBuilderPage />
                      </RequirePermission>
                    ),
                  },
                  // Process feedback requests are also followed by the editors of the process.
                  { path: 'grc/surveys/campaigns/:id', element: <CampaignPage /> },
                  { path: 'surveys/:id', element: <SurveyResponsePage /> },
                  {
                    path: 'settings/grc',
                    element: (
                      <RequirePermission all={[P.GRC_ADMIN]}>
                        <GrcSettingsPage />
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
                    path: 'diagrams',
                    element: (
                      <RequirePermission all={[P.PROCESSES_READ]}>
                        <RepositoryLayout />
                      </RequirePermission>
                    ),
                    children: [{ path: ':id', element: <DiagramDetailPage /> }],
                  },
                  {
                    path: 'ea/applications',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <ApplicationsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'ea/applications/:id',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <ApplicationDetailPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'ea/interfaces',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <InterfacesPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'ea/data',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <DataObjectsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'mining/logs',
                    element: (
                      <RequirePermission all={[P.MINING_READ]}>
                        <LogsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'mining/logs/new',
                    element: (
                      <RequirePermission all={[P.MINING_MANAGE]}>
                        <UploadLogPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'mining/logs/:id/import',
                    element: (
                      <RequirePermission all={[P.MINING_MANAGE]}>
                        <ImportMappingPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'mining/simulations',
                    element: (
                      <RequirePermission all={[P.MINING_READ, P.PROCESSES_READ]}>
                        <SimulationsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'mining/simulations/:id',
                    element: (
                      <RequirePermission all={[P.MINING_READ, P.PROCESSES_READ]}>
                        <SimulationPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'mining/logs/:id/:tab?',
                    element: (
                      <RequirePermission all={[P.MINING_READ]}>
                        <MiningLogPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'kpis',
                    element: (
                      <RequirePermission all={[P.KPI_READ]}>
                        <KpisPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'kpis/dashboard',
                    element: (
                      <RequirePermission all={[P.KPI_READ]}>
                        <KpiDashboardPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'kpis/objectives',
                    element: (
                      <RequirePermission all={[P.KPI_READ]}>
                        <ObjectivesPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'kpis/:id',
                    element: (
                      <RequirePermission all={[P.KPI_READ]}>
                        <KpiDetailPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'ea/landscape',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <LandscapePage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'ea/traceability',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <TraceabilityPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'ea/capabilities',
                    element: (
                      <RequirePermission all={[P.EA_READ]}>
                        <CapabilitiesPage />
                      </RequirePermission>
                    ),
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
                        <SystemsLibraryRoute />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'library/dictionary',
                    element: (
                      <RequirePermission all={[P.OBJECTS_READ]}>
                        <DictionaryPage />
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
                    path: 'admin/imports',
                    element: (
                      <RequirePermission any={[P.IMPORT_MANAGE, P.IMPORT_OWN]}>
                        <ImportCenterPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'admin/imports/dashboard',
                    element: (
                      <RequirePermission any={[P.IMPORT_MANAGE, P.GOVERNANCE_DASHBOARD]}>
                        <MigrationDashboardPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'admin/imports/review',
                    element: (
                      <RequirePermission any={[P.IMPORT_MANAGE, P.GOVERNANCE_DASHBOARD]}>
                        <ReviewQueuePage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'admin/imports/ai',
                    element: (
                      <RequirePermission all={[P.IMPORT_MANAGE]}>
                        <AiProposalsPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'admin/imports/ai/:id',
                    element: (
                      <RequirePermission all={[P.IMPORT_MANAGE]}>
                        <AiProposalPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'admin/imports/:id',
                    element: (
                      <RequirePermission any={[P.IMPORT_MANAGE, P.IMPORT_OWN]}>
                        <ImportBatchPage />
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
