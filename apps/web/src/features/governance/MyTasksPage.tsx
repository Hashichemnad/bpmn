import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  FeedbackDto,
  GovernedItemDto,
  GrcReviewTaskDto,
  ReviewSummaryDto,
} from '@processhub/shared';
import { useMyTasks } from '@/api/governance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { ReviewStateTag, StatusTag } from '@/components/tags';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { NotificationItem } from '@/features/notifications/NotificationBell';
import { useOpenNotification } from '@/features/notifications/use-open-notification';
import { ItemTitle } from './ItemTitle';
import { FeedbackManageModal } from './FeedbackManageModal';

type TabKey =
  'reviews' | 'toPublish' | 'returned' | 'dueReviews' | 'grcReviews' | 'mentions' | 'feedback';

/** Everything waiting for the current user. */
export function MyTasksPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tasks = useMyTasks();
  const openNotification = useOpenNotification();
  const [feedback, setFeedback] = useState<FeedbackDto | null>(null);
  const name = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? loc(u) || u.email : '—';

  if (tasks.isLoading) return <LoadingState />;
  if (tasks.isError || !tasks.data)
    return <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />;
  const d = tasks.data;
  const counts: Record<TabKey, number> = {
    reviews: d.reviews.length,
    toPublish: d.toPublish.length,
    returned: d.returned.length,
    dueReviews: d.dueReviews.length,
    grcReviews: d.grcReviews.length,
    mentions: d.mentions.length,
    feedback: d.feedback.length,
  };
  const first = (Object.keys(counts) as TabKey[]).find((k) => counts[k] > 0) ?? 'reviews';
  const tab = (params.get('tab') as TabKey) || first;
  const empty = (key: TabKey) => (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(`governance:tasks.empty.${key}`)} />
  );

  const reviewColumns = (returned: boolean) => [
    {
      title: t('governance:tasks.item'),
      key: 'item',
      render: (_: unknown, r: ReviewSummaryDto) => <ItemTitle item={r.item} />,
    },
    {
      title: t('governance:tasks.version'),
      key: 'version',
      width: 90,
      render: (_: unknown, r: ReviewSummaryDto) =>
        t('governance:versionN', { number: r.versionNumber }),
    },
    returned
      ? {
          title: t('fields.status'),
          key: 'status',
          width: 170,
          render: (_: unknown, r: ReviewSummaryDto) => (
            <Tag color={r.status === 'REJECTED' ? 'error' : 'orange'}>
              {t(`governance:reviewStatus.${r.status}`)}
            </Tag>
          ),
        }
      : {
          title: t('governance:tasks.step'),
          key: 'step',
          render: (_: unknown, r: ReviewSummaryDto) =>
            `${loc(r.currentStepName)} (${t('governance:tasks.stepOf', { step: r.currentStep + 1, count: r.stepCount })})`,
        },
    {
      title: returned ? t('governance:tasks.decidedAt') : t('governance:tasks.submitted'),
      key: 'date',
      width: 210,
      render: (_: unknown, r: ReviewSummaryDto) =>
        returned
          ? formatDate(r.completedAt)
          : `${name(r.submittedBy)} · ${formatDate(r.submittedAt, false)}`,
    },
    ...(returned
      ? []
      : [
          {
            title: t('governance:tasks.due'),
            key: 'due',
            width: 130,
            render: (_: unknown, r: ReviewSummaryDto) =>
              r.dueAt ? (
                <Tag color={r.overdue ? 'red' : 'default'}>{formatDate(r.dueAt, false)}</Tag>
              ) : (
                '—'
              ),
          },
        ]),
    {
      key: 'open',
      width: 110,
      render: (_: unknown, r: ReviewSummaryDto) => (
        <Button
          type={returned ? 'default' : 'primary'}
          size="small"
          onClick={() => navigate(`/reviews/${r.id}`)}
        >
          {returned ? t('governance:tasks.seeDecision') : t('governance:tasks.review')}
        </Button>
      ),
    },
  ];

  const itemColumns = (kind: 'toPublish' | 'dueReviews') => [
    {
      title: t('governance:tasks.item'),
      key: 'item',
      render: (_: unknown, r: GovernedItemDto) => <ItemTitle item={r} />,
    },
    {
      title: t('fields.status'),
      key: 'status',
      width: 140,
      render: (_: unknown, r: GovernedItemDto) => <StatusTag status={r.status} />,
    },
    kind === 'dueReviews'
      ? {
          title: t('governance:panel.nextReview'),
          key: 'next',
          width: 220,
          render: (_: unknown, r: GovernedItemDto) => (
            <>
              {formatDate(r.nextReviewAt, false)} <ReviewStateTag state={r.reviewState} />
            </>
          ),
        }
      : {
          title: t('fields.owner'),
          key: 'owner',
          width: 200,
          render: (_: unknown, r: GovernedItemDto) => name(r.owner),
        },
    {
      key: 'open',
      width: 110,
      render: (_: unknown, r: GovernedItemDto) => (
        <Link
          to={
            r.entityType === 'PROCESS'
              ? `/processes/${r.entityId}`
              : `/docs/${r.spaceId}/pages/${r.entityId}`
          }
        >
          <Button size="small" type={kind === 'toPublish' ? 'primary' : 'default'}>
            {kind === 'toPublish' ? t('governance:actions.publish') : t('governance:tasks.open')}
          </Button>
        </Link>
      ),
    },
  ];

  const label = (key: TabKey) => (
    <span>
      {t(`governance:tasks.tabs.${key}`)}{' '}
      <Badge
        count={counts[key]}
        size="small"
        color={counts[key] ? '#1d4ed8' : '#cbd5e1'}
        showZero
      />
    </span>
  );

  return (
    <>
      <PageHeader title={t('governance:tasks.title')} subtitle={t('governance:tasks.subtitle')} />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams({ tab: k })}
          items={[
            {
              key: 'reviews',
              label: label('reviews'),
              children: d.reviews.length ? (
                <Table
                  rowKey="id"
                  size="middle"
                  pagination={false}
                  dataSource={d.reviews}
                  columns={reviewColumns(false)}
                  scroll={{ x: 800 }}
                />
              ) : (
                empty('reviews')
              ),
            },
            {
              key: 'toPublish',
              label: label('toPublish'),
              children: d.toPublish.length ? (
                <Table
                  rowKey="entityId"
                  pagination={false}
                  dataSource={d.toPublish}
                  columns={itemColumns('toPublish')}
                  scroll={{ x: 700 }}
                />
              ) : (
                empty('toPublish')
              ),
            },
            {
              key: 'returned',
              label: label('returned'),
              children: d.returned.length ? (
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={d.returned}
                  columns={reviewColumns(true)}
                  scroll={{ x: 800 }}
                />
              ) : (
                empty('returned')
              ),
            },
            {
              key: 'dueReviews',
              label: label('dueReviews'),
              children: d.dueReviews.length ? (
                <Table
                  rowKey="entityId"
                  pagination={false}
                  dataSource={d.dueReviews}
                  columns={itemColumns('dueReviews')}
                  scroll={{ x: 700 }}
                />
              ) : (
                empty('dueReviews')
              ),
            },
            {
              key: 'grcReviews',
              label: label('grcReviews'),
              children: d.grcReviews.length ? (
                <Table<GrcReviewTaskDto>
                  rowKey="id"
                  pagination={false}
                  dataSource={d.grcReviews}
                  scroll={{ x: 600 }}
                  columns={[
                    {
                      title: t('governance:tasks.item'),
                      key: 'item',
                      render: (_, r) => (
                        <Link to={r.link}>
                          {r.code && (
                            <>
                              <bdi>{r.code}</bdi>
                              {' · '}
                            </>
                          )}
                          {loc(r)}
                        </Link>
                      ),
                    },
                    {
                      title: t('grc:fields.title'),
                      key: 'type',
                      width: 140,
                      render: (_, r) => t(`grc:types.${r.type}`),
                    },
                    {
                      title: t('governance:tasks.due'),
                      key: 'due',
                      width: 200,
                      render: (_, r) => (
                        <Space size={4}>
                          {formatDate(r.nextReviewAt, false)}
                          {r.overdue && <Tag color="red">{t('grc:detail.overdue')}</Tag>}
                        </Space>
                      ),
                    },
                  ]}
                />
              ) : (
                empty('grcReviews')
              ),
            },
            {
              key: 'mentions',
              label: label('mentions'),
              children: d.mentions.length
                ? d.mentions.map((n) => (
                    <NotificationItem key={n.id} n={n} onOpen={openNotification} />
                  ))
                : empty('mentions'),
            },
            {
              key: 'feedback',
              label: label('feedback'),
              children: d.feedback.length ? (
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={d.feedback}
                  scroll={{ x: 800 }}
                  columns={[
                    {
                      title: t('governance:tasks.item'),
                      key: 'item',
                      render: (_, r) => <ItemTitle item={r.item} />,
                    },
                    {
                      title: t('governance:feedback.message'),
                      key: 'message',
                      render: (_, r) => (
                        <>
                          <Tag color={r.kind === 'OUTDATED' ? 'orange' : 'blue'}>
                            {t(`governance:feedback.kind.${r.kind}`)}
                          </Tag>
                          <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                            {r.message}
                          </Typography.Paragraph>
                        </>
                      ),
                    },
                    {
                      title: t('governance:feedback.from'),
                      key: 'from',
                      width: 180,
                      render: (_, r) => `${name(r.createdBy)} · ${formatDate(r.createdAt, false)}`,
                    },
                    {
                      title: t('fields.status'),
                      key: 'status',
                      width: 130,
                      render: (_, r) => <Tag>{t(`governance:feedback.status.${r.status}`)}</Tag>,
                    },
                    {
                      key: 'manage',
                      width: 110,
                      render: (_, r) => (
                        <Button size="small" type="primary" onClick={() => setFeedback(r)}>
                          {t('governance:feedback.answer')}
                        </Button>
                      ),
                    },
                  ]}
                />
              ) : (
                empty('feedback')
              ),
            },
          ]}
        />
      </Card>
      {feedback && <FeedbackManageModal feedback={feedback} onClose={() => setFeedback(null)} />}
    </>
  );
}
