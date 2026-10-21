import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ExportOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { GitSyncStatus } from '@processhub/shared';
import { useGitRetry, useGitStatus, useGitSyncNow } from '@/api/docs';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';

const STATUS_COLOR: Record<GitSyncStatus, string> = {
  SUCCESS: 'green',
  FAILED: 'red',
  PENDING: 'gold',
};

export function SyncStatusPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const status = useGitStatus(true);
  const syncNow = useGitSyncNow();
  const retry = useGitRetry();

  if (status.isLoading) return <LoadingState />;
  if (status.isError || !status.data)
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;

  const run = (scope: 'all' | 'processes' | 'pages') =>
    syncNow.mutate(
      { scope },
      {
        onSuccess: (r) => message.success(t('admin:git.queued', { count: r.queued })),
        onError: (err) => message.error(errorMessage(err)),
      },
    );

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.settings'), to: '/settings' },
          { title: t('admin:git.statusTitle') },
        ]}
        title={t('admin:git.statusTitle')}
        subtitle={t('admin:git.statusSubtitle')}
        extra={
          <Dropdown.Button
            type="primary"
            icon={<SyncOutlined />}
            disabled={!s.enabled}
            loading={syncNow.isPending || s.running}
            onClick={() => run('all')}
            menu={{
              items: [
                {
                  key: 'processes',
                  label: t('admin:git.syncOnlyProcesses'),
                  onClick: () => run('processes'),
                },
                { key: 'pages', label: t('admin:git.syncOnlyPages'), onClick: () => run('pages') },
              ],
            }}
          >
            {t('admin:git.syncNow')}
          </Dropdown.Button>
        }
      />
      {!s.enabled && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('admin:git.disabledInfo')}
          action={
            <Link to="/settings">
              <Button size="small">{t('nav.settings')}</Button>
            </Link>
          }
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={t('admin:git.lastSync')}
              value={s.lastSyncAt ? formatDate(s.lastSyncAt) : '—'}
              valueStyle={{ fontSize: 16 }}
            />
          </Card>
        </Col>
        {(['SUCCESS', 'FAILED', 'PENDING'] as const).map((k) => (
          <Col xs={12} md={6} key={k}>
            <Card size="small">
              <Statistic
                title={t(`admin:git.status.${k}`)}
                value={s.counts[k]}
                valueStyle={{ color: k === 'FAILED' && s.counts[k] ? '#b91c1c' : undefined }}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Card
        title={t('admin:git.items')}
        extra={
          s.running && (
            <Tag icon={<SyncOutlined spin />} color="processing">
              {t('admin:git.running')}
            </Tag>
          )
        }
      >
        <Table
          rowKey="id"
          dataSource={s.items}
          pagination={s.items.length > 20 ? { pageSize: 20 } : false}
          locale={{ emptyText: <EmptyState description={t('admin:git.noItems')} /> }}
          columns={[
            {
              title: t('admin:git.item'),
              key: 'title',
              render: (_, r) => (
                <>
                  <Tag>{t(`admin:git.entity.${r.entityType}`)}</Tag>
                  {r.title ? (
                    <Link
                      to={
                        r.entityType === 'PROCESS'
                          ? `/processes/${r.entityId}`
                          : `/docs/${r.title.spaceId}/pages/${r.entityId}`
                      }
                    >
                      {r.title.code && (
                        <span className="ph-tree-code" dir="ltr">
                          {r.title.code}{' '}
                        </span>
                      )}
                      {loc(r.title)}
                    </Link>
                  ) : (
                    <Typography.Text type="secondary">{t('admin:git.deletedItem')}</Typography.Text>
                  )}
                  {r.version !== null && (
                    <Typography.Text type="secondary"> · v{r.version}</Typography.Text>
                  )}
                </>
              ),
            },
            {
              title: t('fields.status'),
              key: 'status',
              width: 300,
              render: (_, r) => (
                <>
                  <Tag color={STATUS_COLOR[r.status]}>{t(`admin:git.status.${r.status}`)}</Tag>
                  {r.status === 'FAILED' && r.errorCode && (
                    <div>
                      <Typography.Text type="danger">{t(`errors:${r.errorCode}`)}</Typography.Text>
                      {r.errorMessage && (
                        <Tooltip title={r.errorMessage}>
                          <Typography.Text
                            type="secondary"
                            ellipsis
                            style={{ display: 'block', maxInlineSize: 280, fontSize: 12 }}
                            dir="ltr"
                          >
                            {r.errorMessage}
                          </Typography.Text>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </>
              ),
            },
            {
              title: t('admin:git.lastAttempt'),
              key: 'when',
              width: 190,
              render: (_, r) => (
                <>
                  {formatDate(r.lastAttemptAt)}
                  {r.lastSuccessAt && r.status !== 'SUCCESS' && (
                    <div className="ph-muted" style={{ fontSize: 12 }}>
                      {t('admin:git.lastSuccess', { time: formatDate(r.lastSuccessAt) })}
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'actions',
              align: 'end',
              width: 170,
              render: (_, r) => (
                <Space>
                  {r.commitUrl && (
                    <a href={r.commitUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="small" type="link" icon={<ExportOutlined />}>
                        <span dir="ltr">{r.commitSha?.slice(0, 7)}</span>
                      </Button>
                    </a>
                  )}
                  {r.status === 'FAILED' && (
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      disabled={!s.enabled}
                      loading={retry.isPending && retry.variables === r.id}
                      onClick={() =>
                        retry.mutate(r.id, { onError: (err) => message.error(errorMessage(err)) })
                      }
                    >
                      {t('retry')}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
