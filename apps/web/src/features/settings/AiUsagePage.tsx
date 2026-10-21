import { useState } from 'react';
import {
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { AiUsageReportDto, AiUsageTotalsDto } from '@processhub/shared';
import { useAiUsage } from '@/api/ai';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useFormatNumber, useLocalized } from '@/components/i18n-helpers';
import { useLocale } from '@/app/LocaleProvider';

/** AI usage for administrators: requests and tokens per user, feature, model and month (UTC). */
export function AiUsagePage() {
  const { t } = useTranslation();
  const num = useFormatNumber();
  const { locale } = useLocale();
  const loc = useLocalized();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const usage = useAiUsage(month);

  if (usage.isLoading) return <LoadingState />;
  if (usage.isError || !usage.data)
    return <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />;
  const r = usage.data;

  const totalsColumns = [
    { title: t('ai:usage.requests'), dataIndex: 'requests', align: 'end' as const, render: num },
    {
      title: t('ai:usage.inputTokens'),
      dataIndex: 'inputTokens',
      align: 'end' as const,
      render: num,
    },
    {
      title: t('ai:usage.outputTokens'),
      dataIndex: 'outputTokens',
      align: 'end' as const,
      render: num,
    },
    {
      title: t('ai:usage.errors'),
      dataIndex: 'errors',
      align: 'end' as const,
      render: (v: number) => (v ? <Tag color="orange">{num(v)}</Tag> : num(v)),
    },
  ];
  const max = Math.max(1, ...r.byMonth.map((m) => m.requests));
  const monthLabel = (m: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(`${m}-01T00:00:00Z`));

  return (
    <>
      <PageHeader
        title={t('ai:usage.title')}
        subtitle={t('ai:usage.subtitle')}
        extra={
          <DatePicker
            picker="month"
            allowClear
            value={month ? dayjs(`${month}-01`) : null}
            onChange={(d) => setMonth(d ? d.format('YYYY-MM') : undefined)}
            aria-label={t('ai:usage.month')}
          />
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t('ai:usage.requestsIn', { month: monthLabel(r.month) })}
              value={r.totals.requests}
              formatter={(v) => num(Number(v))}
              suffix={r.orgMonthlyLimit ? `/ ${num(r.orgMonthlyLimit)}` : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t('ai:usage.inputTokens')}
              value={r.totals.inputTokens}
              formatter={(v) => num(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t('ai:usage.outputTokens')}
              value={r.totals.outputTokens}
              formatter={(v) => num(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t('ai:usage.errors')}
              value={r.totals.errors}
              formatter={(v) => num(Number(v))}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card title={t('ai:usage.trend')}>
            <div className="ph-ai-trend" role="img" aria-label={t('ai:usage.trend')}>
              {r.byMonth.map((m) => (
                <Tooltip
                  key={m.month}
                  title={`${monthLabel(m.month)}: ${t('ai:usage.requestCount', { value: num(m.requests) })}`}
                >
                  <button
                    type="button"
                    className="ph-ai-trend-col"
                    onClick={() => setMonth(m.month)}
                  >
                    <span className="ph-ai-trend-bar-wrap">
                      <span
                        className={`ph-ai-trend-bar${m.month === r.month ? ' is-current' : ''}`}
                        style={{ blockSize: `${(m.requests / max) * 100}%` }}
                      />
                    </span>
                    <span className="ph-ai-trend-label">{monthLabel(m.month)}</span>
                  </button>
                </Tooltip>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('ai:usage.byUser')}>
            <Table<AiUsageReportDto['byUser'][number]>
              size="small"
              rowKey={(u) => u.user?.id ?? 'deleted'}
              dataSource={r.byUser}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              locale={{ emptyText: <Empty description={t('ai:usage.empty')} /> }}
              columns={[
                {
                  title: t('ai:usage.user'),
                  render: (_: unknown, u) =>
                    u.user ? (
                      loc(u.user) || u.user.email
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    ),
                },
                ...totalsColumns,
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('ai:usage.byFeature')}>
            <Table<AiUsageReportDto['byFeature'][number]>
              size="small"
              rowKey="feature"
              dataSource={r.byFeature}
              pagination={false}
              locale={{ emptyText: <Empty description={t('ai:usage.empty')} /> }}
              columns={[
                {
                  title: t('ai:usage.feature'),
                  dataIndex: 'feature',
                  render: (f: string) => t(`ai:features.${f}`),
                },
                ...totalsColumns,
              ]}
            />
          </Card>
          <Card title={t('ai:usage.byModel')} style={{ marginTop: 16 }}>
            <Table<AiUsageTotalsDto & { model: string }>
              size="small"
              rowKey="model"
              dataSource={r.byModel}
              pagination={false}
              locale={{ emptyText: <Empty description={t('ai:usage.empty')} /> }}
              columns={[
                {
                  title: t('ai:usage.model'),
                  dataIndex: 'model',
                  render: (m: string) => <code dir="ltr">{m}</code>,
                },
                ...totalsColumns,
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
