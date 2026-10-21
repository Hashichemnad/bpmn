import { App, Button, Card, Popconfirm, Space, Table, Typography } from 'antd';
import { DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { usePurgePage, useRestorePage, useTrash } from '@/api/docs';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useSpaceContext } from './space-context';

export function TrashPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const { space } = useSpaceContext();
  const trash = useTrash(space.id);
  const restore = useRestorePage(space.id);
  const purge = usePurgePage(space.id);
  const canPurge = can(PERMISSIONS.DOCS_MANAGE);

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.docs'), to: '/docs' },
          { title: loc(space), to: `/docs/${space.id}` },
          { title: t('docs:trash.title') },
        ]}
        title={t('docs:trash.title')}
        subtitle={t('docs:trash.subtitle')}
      />
      <Card>
        {trash.isError ? (
          <ErrorState error={trash.error} onRetry={() => void trash.refetch()} />
        ) : (
          <Table
            rowKey="id"
            loading={trash.isLoading}
            dataSource={trash.data ?? []}
            pagination={false}
            locale={{ emptyText: <EmptyState description={t('docs:trash.empty')} /> }}
            columns={[
              {
                title: t('docs:pages.title'),
                key: 'title',
                render: (_, r) => (
                  <>
                    <Typography.Text>{loc(r, 'title') || t('docs:untitled')}</Typography.Text>
                    {r.descendantCount > 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {' '}
                        · {t('docs:trash.withSubPages', { count: r.descendantCount })}
                      </Typography.Text>
                    )}
                  </>
                ),
              },
              {
                title: t('docs:trash.deletedAt'),
                key: 'deletedAt',
                render: (_, r) => (
                  <>
                    {formatDate(r.deletedAt)}
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {loc(r.deletedBy) || r.deletedBy?.email || '—'}
                    </Typography.Text>
                  </>
                ),
              },
              {
                key: 'actions',
                align: 'end',
                render: (_, r) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<UndoOutlined />}
                      loading={restore.isPending && restore.variables === r.id}
                      onClick={() =>
                        restore.mutate(r.id, {
                          onSuccess: () => message.success(t('docs:trash.restored')),
                          onError: (err) => message.error(errorMessage(err)),
                        })
                      }
                    >
                      {t('docs:trash.restore')}
                    </Button>
                    {canPurge && (
                      <Popconfirm
                        title={t('docs:trash.purgeTitle')}
                        description={t('docs:trash.purgeText')}
                        okText={t('docs:trash.purge')}
                        okButtonProps={{ danger: true }}
                        cancelText={t('cancel')}
                        onConfirm={() =>
                          purge.mutateAsync(r.id).then(
                            () => message.success(t('deleted')),
                            (err) => message.error(errorMessage(err)),
                          )
                        }
                      >
                        <Button size="small" danger icon={<DeleteOutlined />}>
                          {t('docs:trash.purge')}
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
