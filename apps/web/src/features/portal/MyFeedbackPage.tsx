import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, Empty, List, Pagination, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useFeedbackList } from '@/api/governance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { portalLink } from '@/features/governance/links';

const STATUS_COLORS = { OPEN: 'blue', IN_PROGRESS: 'gold', DONE: 'green' } as const;

/** Feedback the user sent from the portal, with status and the owner's reply. */
export function MyFeedbackPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const [page, setPage] = useState(1);
  const list = useFeedbackList({ scope: 'mine', page, pageSize: 20 });
  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('portal:nav.home'), to: '/portal' },
          { title: t('portal:nav.feedback') },
        ]}
        title={t('portal:feedback.myTitle')}
        subtitle={t('portal:feedback.mySubtitle')}
      />
      <Card>
        {list.isLoading ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} />
        ) : list.data?.items.length ? (
          <>
            <List
              itemLayout="vertical"
              dataSource={list.data.items}
              renderItem={(f) => (
                <List.Item key={f.id}>
                  <Space size={6} wrap>
                    <Tag color={STATUS_COLORS[f.status]}>
                      {t(`governance:feedback.status.${f.status}`)}
                    </Tag>
                    <Tag>{t(`governance:feedback.kind.${f.kind}`)}</Tag>
                    <Link to={portalLink(f.item)}>
                      {f.item.code ? `${f.item.code} ` : ''}
                      {loc(f.item, 'title')}
                    </Link>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(f.createdAt)}
                    </Typography.Text>
                  </Space>
                  <Typography.Paragraph style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>
                    {f.message}
                  </Typography.Paragraph>
                  {f.reply && (
                    <Alert
                      type="success"
                      message={t('portal:feedback.replyFrom', {
                        name: loc(f.repliedBy) || f.repliedBy?.email || '—',
                        date: formatDate(f.repliedAt, false),
                      })}
                      description={<span style={{ whiteSpace: 'pre-wrap' }}>{f.reply}</span>}
                    />
                  )}
                </List.Item>
              )}
            />
            <Pagination
              current={page}
              pageSize={20}
              total={list.data.total}
              onChange={setPage}
              hideOnSinglePage
            />
          </>
        ) : (
          <Empty description={t('portal:feedback.none')} />
        )}
      </Card>
    </>
  );
}
