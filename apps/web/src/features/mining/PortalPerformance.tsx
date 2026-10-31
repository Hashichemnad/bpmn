import { Card, Col, Flex, Row, Statistic, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PortalPerformanceDto } from '@processhub/shared';
import { api } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { useFormatDate, useFormatNumber } from '@/components/i18n-helpers';
import { useFormatDuration, usePercent } from './mining-utils';

/**
 * "Performance" section of a published process in the Knowledge Portal (D-142): shown only when the
 * setting is on and a log is linked; aggregated values only.
 */
export function PortalPerformance({ processId }: { processId: string }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const fmtD = useFormatDuration();
  const fmtN = useFormatNumber();
  const fmtDate = useFormatDate();
  const pct = usePercent();
  const q = useQuery({
    queryKey: ['portal', 'performance', processId],
    queryFn: () => api<PortalPerformanceDto>(`/mining/portal/processes/${processId}/performance`),
    retry: false,
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <Card title={t('mining:portal.title')} data-testid="portal-performance">
      <Typography.Paragraph type="secondary">
        {t('mining:portal.basis', {
          cases: fmtN(d.cases),
          from: fmtDate(d.periodStart, false),
          to: fmtDate(d.periodEnd, false),
        })}
      </Typography.Paragraph>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Statistic title={t('mining:stats.mean')} value={fmtD(d.throughput?.mean)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('mining:stats.median')} value={fmtD(d.throughput?.median)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('mining:stats.p90')} value={fmtD(d.throughput?.p90)} />
        </Col>
        {d.conformance && (
          <Col xs={12} md={6}>
            <Statistic
              title={t('mining:portal.conformance')}
              value={pct(d.conformance.conformingShare)}
            />
          </Col>
        )}
      </Row>
      <Flex vertical style={{ marginBlockStart: 12 }}>
        <Typography.Text strong>{t(`mining:stats.trend.${d.granularity}`)}</Typography.Text>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart
            data={d.trend.map((p) => ({
              ...p,
              hours: p.meanMs === null ? null : Math.round(p.meanMs / 360_000) / 10,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" reversed={locale === 'ar'} fontSize={11} />
            <YAxis yAxisId="c" orientation={locale === 'ar' ? 'right' : 'left'} fontSize={11} />
            <YAxis yAxisId="h" orientation={locale === 'ar' ? 'left' : 'right'} fontSize={11} />
            <Tooltip />
            <Bar
              yAxisId="c"
              dataKey="completed"
              name={t('mining:portal.completed')}
              fill="#93C5FD"
            />
            <Line
              yAxisId="h"
              dataKey="hours"
              name={t('mining:stats.meanHours')}
              stroke="#DC2626"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Flex>
    </Card>
  );
}
