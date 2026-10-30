import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AiButton } from '@/features/ai/AiParts';
import { PortalAssistantProvider } from '@/features/ai/PortalAssistant';
import { usePortalAssistant } from '@/features/ai/portal-assistant-context';
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Input,
  Layout,
  Menu,
  Typography,
  type MenuProps,
} from 'antd';
import {
  AppstoreOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  PartitionOutlined,
  ReadOutlined,
  SettingOutlined,
  StarOutlined,
  SwapOutlined,
  UserOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { usePublicSettings } from '@/api/hooks';
import { usePortalHome } from '@/api/portal';
import { assuranceTaskCount, useAssuranceTasks } from '@/api/assurance';
import { useLocalized } from '@/components/i18n-helpers';
import { BrandMark } from '@/layout/BrandMark';
import { LanguageToggle } from '@/layout/AppLayout';
import { NotificationBell } from '@/features/notifications/NotificationBell';

const { Header, Content, Footer } = Layout;

/** "✨ Ask" in the portal header (shown only when the assistant is available). */
function PortalAskButton() {
  const { t } = useTranslation();
  const assistant = usePortalAssistant();
  if (!assistant) return null;
  return <AiButton onClick={() => assistant.ask()}>{t('ai:portal.ask')}</AiButton>;
}

/** The Knowledge Portal: a calm reading experience with published content only. */
export function PortalLayout() {
  const { t } = useTranslation();
  const { user, canAny, can, logout } = useAuth();
  const loc = useLocalized();
  const navigate = useNavigate();
  const location = useLocation();
  const assuranceTasks = useAssuranceTasks(!!user);
  const settings = usePublicSettings();
  const home = usePortalHome();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const orgName =
    loc({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr }) || 'ProcessHub';
  const portalName = loc(home.data) || t('portal:name');

  const taskCount = assuranceTaskCount(assuranceTasks.data);
  const nav: MenuProps['items'] = [
    {
      key: '/portal',
      icon: <HomeOutlined />,
      label: <Link to="/portal">{t('portal:nav.home')}</Link>,
    },
    {
      key: '/portal/processes',
      icon: <PartitionOutlined />,
      label: <Link to="/portal/processes">{t('portal:nav.processes')}</Link>,
    },
    {
      key: '/portal/docs',
      icon: <ReadOutlined />,
      label: <Link to="/portal/docs">{t('portal:nav.docs')}</Link>,
    },
    {
      key: '/portal/my',
      icon: <StarOutlined />,
      label: <Link to="/portal/my">{t('portal:nav.my')}</Link>,
    },
    ...(taskCount
      ? [
          {
            key: '/portal/tasks',
            icon: <CheckSquareOutlined />,
            label: (
              <Link to="/portal/tasks">
                {t('assurance:portal.tasks')} <span className="ph-menu-count">{taskCount}</span>
              </Link>
            ),
          },
        ]
      : []),
  ];
  const p = location.pathname;
  const selected =
    p === '/portal'
      ? '/portal'
      : p.startsWith('/portal/processes')
        ? '/portal/processes'
        : p.startsWith('/portal/docs') || p.startsWith('/portal/pages')
          ? '/portal/docs'
          : p.startsWith('/portal/my')
            ? '/portal/my'
            : p.startsWith('/portal/tasks') || p.startsWith('/portal/issues')
              ? '/portal/tasks'
              : '';

  const workspace = canAny(PERMISSIONS.PROCESSES_READ, PERMISSIONS.DOCS_READ);
  const userMenu: MenuProps['items'] = [
    ...(workspace
      ? [
          {
            key: 'workspace',
            icon: <SwapOutlined />,
            label: t('portal:switchToWorkspace'),
            onClick: () => navigate('/'),
          },
        ]
      : []),
    {
      key: 'feedback',
      icon: <MessageOutlined />,
      label: t('portal:nav.feedback'),
      onClick: () => navigate('/portal/feedback'),
    },
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('nav.profile'),
      onClick: () => navigate('/portal/profile'),
    },
    ...(can(PERMISSIONS.PORTAL_MANAGE)
      ? [
          {
            key: 'settings',
            icon: <SettingOutlined />,
            label: t('portal:nav.settings'),
            onClick: () => navigate('/settings/portal'),
          },
        ]
      : []),
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('auth.logout'),
      onClick: () => void logout().then(() => navigate('/login')),
    },
  ];

  const search = (value: string) => {
    const v = value.trim();
    if (v) navigate(`/portal/search?q=${encodeURIComponent(v)}`);
    setQ('');
  };

  return (
    <PortalAssistantProvider>
      <Layout className="ph-portal">
        <Header className="ph-portal-header">
          <Flex align="center" gap={12} style={{ minInlineSize: 0 }}>
            <Button
              type="text"
              className="ph-portal-menu-button"
              icon={<MenuOutlined />}
              aria-label={t('toggleMenu')}
              onClick={() => setMenuOpen(true)}
            />
            <Link to="/portal" className="ph-portal-brand" aria-label={portalName}>
              <BrandMark settings={settings.data} size={30} />
              <span className="ph-portal-brand-text">
                <span className="ph-portal-brand-name">{portalName}</span>
                <span className="ph-portal-brand-org">{orgName}</span>
              </span>
            </Link>
            <Menu
              mode="horizontal"
              items={nav}
              selectedKeys={[selected]}
              className="ph-portal-nav"
              disabledOverflow
            />
          </Flex>
          <Flex align="center" gap={10}>
            <Input.Search
              className="ph-portal-header-search"
              placeholder={t('portal:searchPlaceholder')}
              allowClear
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onSearch={search}
              aria-label={t('portal:nav.search')}
            />
            <PortalAskButton />
            <LanguageToggle />
            <NotificationBell allLink="/portal/notifications" />
            {workspace && (
              <Button
                className="ph-portal-workspace"
                icon={<AppstoreOutlined />}
                onClick={() => navigate('/')}
              >
                {t('portal:workspace')}
              </Button>
            )}
            <Dropdown menu={{ items: userMenu }} trigger={['click']}>
              <Button type="text" className="ph-user-button" aria-label={loc(user) || user?.email}>
                <Avatar size="small" style={{ background: '#0f766e' }} icon={<UserOutlined />} />
                <span className="ph-user-name">{loc(user) || user?.email}</span>
              </Button>
            </Dropdown>
          </Flex>
        </Header>
        <Drawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement="left"
          width={260}
          title={portalName}
        >
          <Input.Search
            placeholder={t('portal:searchPlaceholder')}
            onSearch={(v) => {
              search(v);
              setMenuOpen(false);
            }}
            style={{ marginBlockEnd: 12 }}
          />
          <Menu
            mode="inline"
            items={nav}
            selectedKeys={[selected]}
            onClick={() => setMenuOpen(false)}
          />
        </Drawer>
        <Content className="ph-portal-content">
          <Outlet />
        </Content>
        <Footer className="ph-portal-footer">
          <Typography.Text type="secondary">
            {orgName} · {t('portal:footer')}
          </Typography.Text>
        </Footer>
      </Layout>
    </PortalAssistantProvider>
  );
}
