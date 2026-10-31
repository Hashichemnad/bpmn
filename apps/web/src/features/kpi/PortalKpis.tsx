import { Card, List, Space, Typography } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PROCESS_ELEMENT_ID, type PortalKpiDto } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';
import { RagTag, Sparkline } from './kpi-components';
import { useFormatPeriod, useFormatValue } from './kpi-helpers';

/** Knowledge Portal: the KPIs of a published process (only when Settings → KPIs allows it). */
export function PortalKpis({
  kpis,
  stepName,
}: {
  kpis: PortalKpiDto[];
  stepName: (elementId: string) => string;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatValue = useFormatValue();
  const formatPeriod = useFormatPeriod();
  return (
    <Card
      size="small"
      title={
        <>
          <LineChartOutlined /> {t('kpi:portal.title')}
        </>
      }
      data-testid="portal-kpis"
    >
      <List
        size="small"
        dataSource={kpis}
        locale={{ emptyText: t('kpi:process.none') }}
        renderItem={(k) => (
          <List.Item extra={<Sparkline points={k.trend} />}>
            <Space direction="vertical" size={0}>
              <Space wrap>
                <Typography.Text strong>{loc(k)}</Typography.Text>
                <RagTag rag={k.latest?.rag} />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {k.latest
                  ? `${formatValue(k.latest.value, k.unit)}${k.latest.target !== null ? ` / ${formatValue(k.latest.target, k.unit)}` : ''} · ${formatPeriod(k.latest.period)}`
                  : t('kpi:rag.none')}
                {' · '}
                {k.bpmnElementId === PROCESS_ELEMENT_ID
                  ? t('kpi:fields.wholeProcess')
                  : stepName(k.bpmnElementId)}
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}
