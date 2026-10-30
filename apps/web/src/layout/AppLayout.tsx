import { useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Dropdown,
  Flex,
  Layout,
  Menu,
  Segmented,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BookOutlined,
  BranchesOutlined,
  CheckSquareOutlined,
  SafetyCertificateOutlined,
  DashboardOutlined,
  FileOutlined,
  GlobalOutlined,
  ClusterOutlined,
  DesktopOutlined,
  ReadOutlined,
  SearchOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  ThunderboltOutlined,
  HeatMapOutlined,
  AlertOutlined,
  SafetyOutlined,
  BankOutlined,
  ExperimentOutlined,
  FormOutlined,
  FundOutlined,
  IssuesCloseOutlined,
  PartitionOutlined,
  SwapOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type Locale } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { api } from '@/api/client';
import { usePublicSettings } from '@/api/hooks';
import { useLocalized } from '@/components/i18n-helpers';
import { BrandMark } from './BrandMark';
import { DiagramThemeNotice } from '@/features/settings/DiagramThemeNotice';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { assuranceTaskCount, useAssuranceTasks } from '@/api/assurance';
import { useMyTasks } from '@/api/governance';

const { Header, Sider, Content } = Layout;

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const { user, setUser } = useAuth();
  const { t } = useTranslation();
  const change = (next: Locale) => {
    setLocale(next);
    if (user) {
      void api<typeof user>('/auth/me', { method: 'PATCH', body: { locale: next } })
        .then(setUser)
        .catch(() => undefined);
    }
  };
  return (
    <Segmented
      aria-label={t('language')}
      size="small"
      value={locale}
      onChange={(v) => change(v as Locale)}
      options={[
        { label: 'EN', value: 'en' },
        { label: 'عربي', value: 'ar' },
      ]}
    />
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const { user, can, canAny, logout } = useAuth();
  const { dir } = useLocale();
  const loc = useLocalized();
  const navigate = useNavigate();
  const location = useLocation();
  const settings = usePublicSettings();
  const [collapsed, setCollapsed] = useState(false);

  const tasks = useMyTasks();
  const assurance = useAssuranceTasks(!!user);
  const taskCount = tasks.data
    ? tasks.data.reviews.length +
      tasks.data.toPublish.length +
      tasks.data.returned.length +
      tasks.data.dueReviews.length +
      tasks.data.grcReviews.length +
      tasks.data.feedback.length +
      assuranceTaskCount(assurance.data)
    : 0;

  const items = useMemo<MenuProps['items']>(() => {
    const list: MenuProps['items'] = [];
    const governance: NonNullable<MenuProps['items']> = [
      {
        key: '/tasks',
        icon: <CheckSquareOutlined />,
        label: (
          <Link to="/tasks">
            {t('nav.tasks')}
            {taskCount > 0 && <span className="ph-menu-count">{taskCount}</span>}
          </Link>
        ),
      },
    ];
    if (can(PERMISSIONS.GOVERNANCE_DASHBOARD)) {
      governance.push({
        key: '/governance',
        icon: <DashboardOutlined />,
        label: <Link to="/governance">{t('nav.governance')}</Link>,
      });
    }
    list.push({ type: 'group', label: t('nav.governanceGroup'), children: governance });
    if (can(PERMISSIONS.PROCESSES_READ)) {
      list.push({
        type: 'group',
        label: t('nav.repository'),
        children: [
          {
            key: '/',
            icon: <AppstoreOutlined />,
            label: <Link to="/">{t('nav.processHouse')}</Link>,
          },
          {
            key: '/processes',
            icon: <ApartmentOutlined />,
            label: <Link to="/processes">{t('nav.processes')}</Link>,
          },
        ],
      });
    }
    if (can(PERMISSIONS.DOCS_READ)) {
      list.push({
        type: 'group',
        label: t('nav.documentation'),
        children: [
          {
            key: '/docs',
            icon: <ReadOutlined />,
            label: <Link to="/docs">{t('nav.docs')}</Link>,
          },
          {
            key: '/search',
            icon: <SearchOutlined />,
            label: <Link to="/search">{t('nav.search')}</Link>,
          },
        ],
      });
    }
    if (can(PERMISSIONS.GRC_READ)) {
      list.push({
        type: 'group',
        label: t('nav.grcGroup'),
        children: [
          {
            key: '/grc/dashboard',
            icon: <HeatMapOutlined />,
            label: <Link to="/grc/dashboard">{t('nav.grcDashboard')}</Link>,
          },
          {
            key: '/grc/assurance',
            icon: <FundOutlined />,
            label: <Link to="/grc/assurance">{t('assurance:nav.dashboard')}</Link>,
          },
          {
            key: '/grc/risks',
            icon: <AlertOutlined />,
            label: <Link to="/grc/risks">{t('nav.risks')}</Link>,
          },
          {
            key: '/grc/controls',
            icon: <SafetyOutlined />,
            label: <Link to="/grc/controls">{t('nav.controls')}</Link>,
          },
          {
            key: '/grc/requirements',
            icon: <BankOutlined />,
            label: <Link to="/grc/requirements">{t('nav.requirements')}</Link>,
          },
          {
            key: '/grc/tests',
            icon: <ExperimentOutlined />,
            label: <Link to="/grc/tests">{t('assurance:nav.tests')}</Link>,
          },
          {
            key: '/grc/issues',
            icon: <IssuesCloseOutlined />,
            label: <Link to="/grc/issues">{t('assurance:nav.issues')}</Link>,
          },
          ...(canAny(PERMISSIONS.AUDIT_MANAGE, PERMISSIONS.GRC_EDIT, PERMISSIONS.AUDIT_READ)
            ? [
                {
                  key: '/grc/audits',
                  icon: <AuditOutlined />,
                  label: <Link to="/grc/audits">{t('assurance:nav.audits')}</Link>,
                },
              ]
            : []),
          ...(can(PERMISSIONS.SURVEYS_MANAGE)
            ? [
                {
                  key: '/grc/surveys',
                  icon: <FormOutlined />,
                  label: <Link to="/grc/surveys">{t('assurance:nav.surveys')}</Link>,
                },
              ]
            : []),
        ],
      });
    }
    if (can(PERMISSIONS.EA_READ)) {
      list.push({
        type: 'group',
        label: t('ea:nav.group'),
        children: [
          {
            key: '/ea/capabilities',
            icon: <PartitionOutlined />,
            label: <Link to="/ea/capabilities">{t('ea:nav.capabilities')}</Link>,
          },
          {
            key: '/ea/applications',
            icon: <DesktopOutlined />,
            label: <Link to="/ea/applications">{t('ea:nav.applications')}</Link>,
          },
          {
            key: '/ea/interfaces',
            icon: <SwapOutlined />,
            label: <Link to="/ea/interfaces">{t('ea:nav.interfaces')}</Link>,
          },
          {
            key: '/ea/data',
            icon: <DatabaseOutlined />,
            label: <Link to="/ea/data">{t('ea:nav.dataObjects')}</Link>,
          },
        ],
      });
    }
    if (can(PERMISSIONS.OBJECTS_READ)) {
      list.push({
        type: 'group',
        label: t('nav.library'),
        children: [
          {
            key: '/library/roles',
            icon: <TeamOutlined />,
            label: <Link to="/library/roles">{t('nav.roles')}</Link>,
          },
          ...(can(PERMISSIONS.EA_READ)
            ? []
            : [
                {
                  key: '/library/systems',
                  icon: <DesktopOutlined />,
                  label: <Link to="/library/systems">{t('nav.systems')}</Link>,
                },
              ]),
          {
            key: '/library/documents',
            icon: <FileOutlined />,
            label: <Link to="/library/documents">{t('nav.documents')}</Link>,
          },
          {
            key: '/library/dictionary',
            icon: <BookOutlined />,
            label: <Link to="/library/dictionary">{t('nav.dictionary')}</Link>,
          },
        ],
      });
    }
    const admin: NonNullable<MenuProps['items']> = [];
    if (can(PERMISSIONS.USERS_READ) && can(PERMISSIONS.USERS_MANAGE)) {
      admin.push({
        key: '/admin/users',
        icon: <UserOutlined />,
        label: <Link to="/admin/users">{t('nav.users')}</Link>,
      });
    }
    if (can(PERMISSIONS.DEPARTMENTS_MANAGE)) {
      admin.push({
        key: '/admin/departments',
        icon: <ClusterOutlined />,
        label: <Link to="/admin/departments">{t('nav.departments')}</Link>,
      });
    }
    if (can(PERMISSIONS.AUDIT_READ)) {
      admin.push({
        key: '/admin/audit',
        icon: <AuditOutlined />,
        label: <Link to="/admin/audit">{t('nav.audit')}</Link>,
      });
    }
    if (can(PERMISSIONS.AI_USAGE_READ)) {
      admin.push({
        key: '/admin/ai-usage',
        icon: <ThunderboltOutlined />,
        label: <Link to="/admin/ai-usage">{t('nav.aiUsage')}</Link>,
      });
    }
    if (can(PERMISSIONS.GOVERNANCE_MANAGE)) {
      admin.push({
        key: '/settings/workflows',
        icon: <BranchesOutlined />,
        label: <Link to="/settings/workflows">{t('nav.workflows')}</Link>,
      });
    }
    if (can(PERMISSIONS.CONVENTIONS_MANAGE)) {
      admin.push({
        key: '/settings/conventions',
        icon: <SafetyCertificateOutlined />,
        label: <Link to="/settings/conventions">{t('nav.conventions')}</Link>,
      });
    }
    if (can(PERMISSIONS.GRC_ADMIN)) {
      admin.push({
        key: '/settings/grc',
        icon: <AlertOutlined />,
        label: <Link to="/settings/grc">{t('nav.grcSettings')}</Link>,
      });
    }
    if (can(PERMISSIONS.PORTAL_MANAGE)) {
      admin.push({
        key: '/settings/portal',
        icon: <GlobalOutlined />,
        label: <Link to="/settings/portal">{t('nav.portalSettings')}</Link>,
      });
    }
    if (can(PERMISSIONS.SETTINGS_MANAGE)) {
      admin.push({
        key: '/settings',
        icon: <SettingOutlined />,
        label: <Link to="/settings">{t('nav.settings')}</Link>,
      });
    }
    if (admin.length) list.push({ type: 'group', label: t('nav.administration'), children: admin });
    return list;
  }, [can, canAny, t, taskCount]);

  const selected = useMemo(() => {
    const p = location.pathname;
    if (p === '/') return ['/'];
    if (p.startsWith('/processes')) return ['/processes'];
    if (p.startsWith('/docs')) return ['/docs'];
    if (p.startsWith('/search')) return ['/search'];
    if (p.startsWith('/library/objects')) return [];
    if (p.startsWith('/reviews')) return ['/tasks'];
    const match = [
      '/tasks',
      '/governance',
      '/library/roles',
      '/library/systems',
      '/library/documents',
      '/library/dictionary',
      '/grc/dashboard',
      '/grc/assurance',
      '/grc/risks',
      '/grc/controls',
      '/grc/requirements',
      '/grc/tests',
      '/grc/issues',
      '/grc/audits',
      '/grc/surveys',
      '/admin/users',
      '/admin/departments',
      '/admin/audit',
      '/settings/workflows',
      '/settings/conventions',
      '/settings/portal',
      '/settings/grc',
      '/settings',
    ].find((k) => p.startsWith(k));
    return match ? [match] : [];
  }, [location.pathname]);

  const orgName =
    loc({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr }) || 'ProcessHub';
  const userName = loc(user) || user?.email;

  const userMenu: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('nav.profile'),
      onClick: () => navigate('/profile'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('auth.logout'),
      onClick: () => void logout().then(() => navigate('/login')),
    },
  ];

  const CollapseIcon = (collapsed ? dir === 'rtl' : dir !== 'rtl')
    ? MenuFoldOutlined
    : MenuUnfoldOutlined;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={240}
        collapsed={collapsed}
        collapsedWidth={64}
        breakpoint="lg"
        onBreakpoint={setCollapsed}
        trigger={null}
        className="ph-sider"
      >
        <Link to="/" className="ph-brand" aria-label={orgName}>
          <BrandMark settings={settings.data} />
          {!collapsed && <span className="ph-brand-name">{orgName}</span>}
        </Link>
        <Menu theme="dark" mode="inline" items={items} selectedKeys={selected} />
      </Sider>
      <Layout>
        <Header className="ph-header">
          <Flex align="center" gap={12}>
            <Button
              type="text"
              aria-label={t('toggleMenu')}
              icon={<CollapseIcon />}
              onClick={() => setCollapsed((c) => !c)}
            />
            <Typography.Text type="secondary" className="ph-header-title">
              {t('appTagline')}
            </Typography.Text>
          </Flex>
          <Flex align="center" gap={16}>
            {canAny(PERMISSIONS.DOCS_READ, PERMISSIONS.PROCESSES_READ) && <GlobalSearch />}
            {can(PERMISSIONS.PORTAL_READ) && (
              <Tooltip title={t('nav.portalHint')}>
                <Button
                  icon={<GlobalOutlined />}
                  onClick={() => navigate('/portal')}
                  className="ph-portal-switch"
                >
                  {t('nav.portal')}
                </Button>
              </Tooltip>
            )}
            <NotificationBell />
            <Tooltip title={t('language')}>
              <span>
                <LanguageToggle />
              </span>
            </Tooltip>
            <Dropdown
              menu={{ items: userMenu }}
              placement={dir === 'rtl' ? 'bottomLeft' : 'bottomRight'}
              trigger={['click']}
            >
              <Button type="text" className="ph-user-button">
                <Avatar size="small" style={{ background: '#1d4ed8' }} icon={<UserOutlined />} />
                <span className="ph-user-name">{userName}</span>
              </Button>
            </Dropdown>
          </Flex>
        </Header>
        <Content className="ph-content">
          <DiagramThemeNotice />
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
