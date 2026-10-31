import { useState } from 'react';
import { SuspenseOutlet } from '@/app/SuspenseOutlet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { App, Button, Dropdown, Flex, Layout, Space, Tag, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  MoreOutlined,
  PlusOutlined,
  RestOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useDeleteSpace, useSpace } from '@/api/docs';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { PageTree } from './PageTree';
import { SpaceIcon } from './SpaceIcon';
import { SpaceFormModal } from './SpaceFormModal';
import { SpacePermissionsDrawer } from './SpacePermissionsDrawer';
import { CreatePageModal } from './CreatePageModal';
import { SpaceContext } from './space-context';

/** A space: page tree on the inline-start side, the selected page beside it. */
export function SpaceLayout() {
  const { spaceId, pageId } = useParams<{ spaceId: string; pageId?: string }>();
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { modal, message } = App.useApp();
  const space = useSpace(spaceId);
  const remove = useDeleteSpace();
  const [dialog, setDialog] = useState<'edit' | 'permissions' | { parentId: string | null } | null>(
    null,
  );

  if (space.isLoading) return <LoadingState />;
  if (space.isError || !space.data)
    return <ErrorState error={space.error} onRetry={() => void space.refetch()} />;
  const s = space.data;

  const confirmDelete = () =>
    modal.confirm({
      title: t('docs:spaces.deleteTitle', { name: loc(s) }),
      content: t('docs:spaces.deleteText'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await remove.mutateAsync(s.id);
          message.success(t('deleted'));
          navigate('/docs');
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const menu = [
    ...(s.canEdit
      ? [
          {
            key: 'trash',
            icon: <RestOutlined />,
            label: t('docs:trash.title'),
            onClick: () => navigate(`/docs/${s.id}/trash`),
          },
        ]
      : []),
    ...(s.canManage
      ? [
          {
            key: 'edit',
            icon: <EditOutlined />,
            label: t('docs:spaces.edit'),
            onClick: () => setDialog('edit'),
          },
          {
            key: 'perm',
            icon: <TeamOutlined />,
            label: t('docs:permissions.menu'),
            onClick: () => setDialog('permissions'),
          },
        ]
      : []),
    ...(can(PERMISSIONS.DOCS_MANAGE)
      ? [
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            danger: true,
            label: t('docs:spaces.delete'),
            onClick: confirmDelete,
          },
        ]
      : []),
  ];

  return (
    <SpaceContext.Provider
      value={{ space: s, newPage: (parentId = null) => setDialog({ parentId }) }}
    >
      <Layout hasSider className="ph-repo">
        <Layout.Sider
          width={300}
          theme="light"
          className="ph-repo-sider"
          breakpoint="md"
          collapsedWidth={0}
        >
          <div className="ph-space-head">
            <Flex align="center" gap={10}>
              <SpaceIcon icon={s.icon} size={22} />
              <div style={{ minInlineSize: 0, flex: 1 }}>
                <Link to={`/docs/${s.id}`}>
                  <Typography.Text strong ellipsis>
                    {loc(s)}
                  </Typography.Text>
                </Link>
                <div>
                  <Tag className="ph-space-key">{s.key}</Tag>
                  {s.viewRestricted && (
                    <Tooltip title={t('docs:permissions.restrictedView')}>
                      <LockOutlined className="ph-muted" />
                    </Tooltip>
                  )}
                </div>
              </div>
              {menu.length > 0 && (
                <Dropdown menu={{ items: menu }} trigger={['click']}>
                  <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('more')} />
                </Dropdown>
              )}
            </Flex>
            {s.canEdit && (
              <Button
                block
                icon={<PlusOutlined />}
                style={{ marginTop: 12 }}
                onClick={() => setDialog({ parentId: null })}
              >
                {t('docs:pages.new')}
              </Button>
            )}
          </div>
          <PageTree spaceId={s.id} selectedId={pageId} canEdit={s.canEdit} />
        </Layout.Sider>
        <Layout.Content className="ph-repo-content">
          <Space direction="vertical" style={{ inlineSize: '100%' }}>
            <SuspenseOutlet />
          </Space>
        </Layout.Content>
      </Layout>
      {dialog === 'edit' && <SpaceFormModal space={s} onClose={() => setDialog(null)} />}
      {dialog === 'permissions' && (
        <SpacePermissionsDrawer space={s} onClose={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && (
        <CreatePageModal
          spaceId={s.id}
          parentId={dialog.parentId}
          onClose={() => setDialog(null)}
        />
      )}
    </SpaceContext.Provider>
  );
}
