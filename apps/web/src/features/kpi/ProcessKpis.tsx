import { Link } from 'react-router-dom';
import { App, Card, Descriptions, Empty, Flex, Select, Space, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_ELEMENT_ID,
  type CalculatedProcessKpis,
  type ProcessKpisDto,
} from '@processhub/shared';
import { api } from '@/api/client';
import { kpiKeys, useKpis } from '@/api/kpi';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { RagTag } from './kpi-components';
import { kpiPath, useFormatValue } from './kpi-helpers';

type Item = ProcessKpisDto['items'][number];

/** One KPI with its latest status and value. */
function KpiLine({ k, onRemove }: { k: Item; onRemove?: () => void }) {
  const loc = useLocalized();
  const formatValue = useFormatValue();
  return (
    <Flex justify="space-between" align="center" gap={8} data-testid="process-kpi">
      <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
        <Link to={kpiPath(k.id)}>{[k.code, loc(k)].filter(Boolean).join(' · ')}</Link>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {k.latest ? formatValue(k.latest.value, k.unit) : '—'}
          {k.latest?.target !== null &&
            k.latest?.target !== undefined &&
            ` / ${formatValue(k.latest.target, k.unit)}`}
        </Typography.Text>
      </Space>
      <Space size={4}>
        <RagTag rag={k.rag} />
        {onRemove && (
          <Typography.Link type="danger" onClick={onRemove}>
            ×
          </Typography.Link>
        )}
      </Space>
    </Flex>
  );
}

/** Process KPIs calculated from the step attributes (main path). */
export function CalculatedKpis({ calc }: { calc: CalculatedProcessKpis | null }) {
  const { t } = useTranslation();
  const formatValue = useFormatValue();
  if (!calc) return null;
  const hours = (m: number | null) =>
    m === null ? t('kpi:calculated.none') : formatValue(Math.round((m / 60) * 10) / 10, 'h');
  return (
    <Descriptions
      size="small"
      column={1}
      bordered
      data-testid="calculated-kpis"
      title={
        <Space direction="vertical" size={0}>
          <span>{t('kpi:calculated.title')}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {t('kpi:calculated.hint')}
          </Typography.Text>
        </Space>
      }
    >
      <Descriptions.Item label={t('kpi:calculated.duration')}>
        {hours(calc.durationMinutes)}
      </Descriptions.Item>
      <Descriptions.Item label={t('kpi:calculated.waiting')}>
        {hours(calc.waitingMinutes)}
      </Descriptions.Item>
      <Descriptions.Item label={t('kpi:calculated.cost')}>
        {calc.costPerExecution === null
          ? t('kpi:calculated.none')
          : formatValue(calc.costPerExecution)}
      </Descriptions.Item>
      <Descriptions.Item label={t('kpi:calculated.handovers')}>
        {formatValue(calc.handovers)}
      </Descriptions.Item>
      <Descriptions.Item label={t('kpi:calculated.automation')}>
        {calc.automationRate === null
          ? t('kpi:calculated.none')
          : formatValue(calc.automationRate, '%')}
      </Descriptions.Item>
    </Descriptions>
  );
}

/** Process page: the KPIs of the process and its steps, and the calculated process KPIs. */
export function ProcessKpisCard({ data }: { data: ProcessKpisDto | undefined }) {
  const { t } = useTranslation();
  if (!data) return null;
  return (
    <Card title={t('kpi:process.title')} data-testid="process-kpis">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {data.items.length ? (
          data.items.map((k) => <KpiLine key={`${k.id}|${k.bpmnElementId}`} k={k} />)
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('kpi:process.none')} />
        )}
        <CalculatedKpis calc={data.calculated} />
      </Space>
    </Card>
  );
}

/**
 * Modeler side panel "KPIs": KPIs of the selected step (or of the whole process) with their
 * latest status; editors of the model link and unlink KPIs (relation MEASURES).
 */
export function KpiStepPanel({
  processId,
  data,
  elementId,
  elementName,
  canLink,
}: {
  processId: string;
  data: ProcessKpisDto | undefined;
  elementId: string | null;
  elementName: string;
  canLink: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const target = elementId ?? PROCESS_ELEMENT_ID;
  const items = (data?.items ?? []).filter((k) => k.bpmnElementId === target);
  const all = useKpis({ pageSize: 500, status: 'ACTIVE', sort: 'code' }, canLink);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: kpiKeys.process(processId) });
    void qc.invalidateQueries({ queryKey: ['processes', processId] });
    void qc.invalidateQueries({ queryKey: kpiKeys.all });
  };
  const link = useMutation({
    mutationFn: (kpiId: string) =>
      api(`/processes/${processId}/links`, {
        method: 'POST',
        body: { bpmnElementId: target, repoObjectId: kpiId, relation: 'MEASURES' },
      }),
    onSuccess: refresh,
    onError: (err) => message.error(errorMessage(err)),
  });
  const unlink = useMutation({
    mutationFn: (linkId: string) =>
      api(`/processes/${processId}/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => message.error(errorMessage(err)),
  });

  return (
    <Space
      direction="vertical"
      size={12}
      style={{ width: '100%', padding: '0 4px' }}
      data-testid="kpi-step-panel"
    >
      <Typography.Text strong>
        {elementId ? t('kpi:process.ofStep', { name: elementName }) : t('kpi:process.ofProcess')}
      </Typography.Text>
      {items.length ? (
        items.map((k) => (
          <KpiLine
            key={k.id}
            k={k}
            onRemove={canLink && k.linkId ? () => unlink.mutate(k.linkId) : undefined}
          />
        ))
      ) : (
        <Typography.Text type="secondary">{t('kpi:process.none')}</Typography.Text>
      )}
      {canLink && (
        <Select
          showSearch
          value={null}
          placeholder={t('kpi:process.link')}
          optionFilterProp="label"
          loading={all.isLoading || link.isPending}
          onChange={(id: string | null) => id && link.mutate(id)}
          options={(all.data?.items ?? [])
            .filter((k) => !items.some((i) => i.id === k.id))
            .map((k) => ({ value: k.id, label: [k.code, loc(k)].filter(Boolean).join(' · ') }))}
          style={{ width: '100%' }}
        />
      )}
      {!elementId && <CalculatedKpis calc={data?.calculated ?? null} />}
      {!!data?.items.length && (
        <Flex wrap="wrap" gap={4}>
          {['RED', 'AMBER', 'GREEN'].map((r) => {
            const n = data.items.filter((k) => k.rag === r).length;
            return n ? (
              <Tag key={r} color={r === 'RED' ? 'red' : r === 'AMBER' ? 'orange' : 'green'}>
                {t(`kpi:rag.${r}`)}: {n}
              </Tag>
            ) : null;
          })}
        </Flex>
      )}
    </Space>
  );
}
