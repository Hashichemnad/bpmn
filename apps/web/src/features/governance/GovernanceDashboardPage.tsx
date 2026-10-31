import { Link } from 'react-router-dom';
import { Card, Col, Empty, Row, Statistic, Table, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  InboxOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  type ContentStatus,
  type GovernedItemDto,
} from '@processhub/shared';
import { useGovernanceDashboard } from '@/api/governance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { ReviewStateTag, StatusTag } from '@/components/tags';
import { useFormatDate, useFormatNumber, useLocalized } from '@/components/i18n-helpers';
import { portalLink } from './links';
import { ItemTitle } from './ItemTitle';

const STATUS_ICONS: Record<ContentStatus, React.ReactNode> = {
  DRAFT: <EditOutlined />,
  IN_REVIEW: <ClockCircleOutlined />,
  APPROVED: <CheckCircleOutlined />,
  PUBLISHED: <SafetyCertificateOutlined />,
  ARCHIVED: <InboxOutlined />,
};

/** Governance overview for administrators and process owners. */
export function GovernanceDashboardPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const formatNumber = useFormatNumber();
  const dash = useGovernanceDashboard();
  if (dash.isLoading) return <LoadingState />;
  if (dash.isError || !dash.data)
    return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data;
  const name = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? loc(u) || u.email : '—';
  const dueColumns = [
    {
      title: t('governance:tasks.item'),
      key: 'item',
      render: (_: unknown, r: GovernedItemDto) => <ItemTitle item={r} />,
    },
    {
      title: t('fields.owner'),
      key: 'owner',
      width: 180,
      render: (_: unknown, r: GovernedItemDto) => name(r.owner),
    },
    {
      title: t('governance:panel.nextReview'),
      key: 'next',
      width: 220,
      render: (_: unknown, r: GovernedItemDto) => (
        <>
          {formatDate(r.nextReviewAt, false)} <ReviewStateTag state={r.reviewState} />
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('governance:dashboard.title')}
        subtitle={t('governance:dashboard.subtitle')}
      />
      <Row gutter={[16, 16]}>
        {CONTENT_TYPES.map((type) => (
          <Col xs={24} xl={12} key={type}>
            <Card title={t(`governance:dashboard.counts.${type}`)} size="small">
              <Row gutter={[8, 8]}>
                {CONTENT_STATUSES.map((s) => (
                  <Col xs={12} sm={8} md={4} xl={8} xxl={4} key={s} style={{ minInlineSize: 110 }}>
                    <Statistic
                      className="ph-stat-card"
                      title={<StatusTag status={s} />}
                      value={formatNumber(d.counts[type][s])}
                      prefix={STATUS_ICONS[s]}
                    />
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginBlockStart: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={t('governance:dashboard.inReview')}
              value={d.inReview.length}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={t('governance:dashboard.overdue')}
              value={d.overdueReviews.length}
              valueStyle={{ color: d.overdueReviews.length ? '#b91c1c' : undefined }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={t('governance:dashboard.openFeedback')}
              value={d.openFeedback}
              prefix={<MessageOutlined />}
            />
          </Card>
        </Col>
      </Row>
      <Card title={t('governance:dashboard.inReviewTitle')} style={{ marginBlockStart: 16 }}>
        <Table
          rowKey="id"
          size="middle"
          pagination={d.inReview.length > 10 ? { pageSize: 10 } : false}
          dataSource={d.inReview}
          scroll={{ x: 800 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('governance:dashboard.noneInReview')}
              />
            ),
          }}
          columns={[
            {
              title: t('governance:tasks.item'),
              key: 'item',
              render: (_, r) => <ItemTitle item={r.item} to={`/reviews/${r.id}`} />,
            },
            {
              title: t('governance:tasks.step'),
              key: 'step',
              render: (_, r) =>
                `${loc(r.currentStepName)} (${t('governance:tasks.stepOf', { step: r.currentStep + 1, count: r.stepCount })})`,
            },
            {
              title: t('governance:tasks.submitted'),
              key: 'by',
              width: 200,
              render: (_, r) => `${name(r.submittedBy)} · ${formatDate(r.submittedAt, false)}`,
            },
            {
              title: t('governance:dashboard.days'),
              key: 'days',
              width: 120,
              sorter: (a, b) => a.days - b.days,
              render: (_, r) => (
                <Tag color={r.overdue ? 'red' : r.days > 3 ? 'gold' : 'default'}>
                  {t('governance:dashboard.daysN', { count: r.days })}
                </Tag>
              ),
            },
          ]}
        />
      </Card>
      <Row gutter={[16, 16]} style={{ marginBlockStart: 16 }}>
        <Col xs={24} xl={12}>
          <Card title={t('governance:dashboard.overdueTitle')}>
            <Table
              rowKey="entityId"
              size="small"
              pagination={false}
              dataSource={d.overdueReviews}
              columns={dueColumns}
              scroll={{ x: 560 }}
              locale={{ emptyText: t('governance:dashboard.noneOverdue') }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={t('governance:dashboard.dueSoonTitle')}>
            <Table
              rowKey="entityId"
              size="small"
              pagination={false}
              dataSource={d.dueSoon}
              columns={dueColumns}
              scroll={{ x: 560 }}
              locale={{ emptyText: t('governance:dashboard.noneDue') }}
            />
          </Card>
        </Col>
      </Row>
      <Card title={t('governance:dashboard.recentTitle')} style={{ marginBlockStart: 16 }}>
        <Table
          rowKey={(r) => `${r.entityType}:${r.entityId}`}
          size="small"
          pagination={false}
          dataSource={d.recentlyPublished}
          scroll={{ x: 700 }}
          locale={{ emptyText: t('governance:dashboard.noneRecent') }}
          columns={[
            {
              title: t('governance:tasks.item'),
              key: 'item',
              render: (_, r) => <ItemTitle item={r} />,
            },
            {
              title: t('governance:tasks.version'),
              key: 'v',
              width: 180,
              render: (_, r) => (
                <Typography.Text>
                  {t('governance:versionN', { number: r.versionNumber })}
                  {r.versionLabel ? ` · ${r.versionLabel}` : ''}
                </Typography.Text>
              ),
            },
            {
              title: t('governance:dashboard.publishedAt'),
              key: 'at',
              width: 160,
              render: (_, r) => formatDate(r.publishedAt, false),
            },
            {
              key: 'portal',
              width: 120,
              render: (_, r) => (
                <Link to={portalLink(r)}>
                  {t('governance:dashboard.viewInPortal')}
                </Link>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
