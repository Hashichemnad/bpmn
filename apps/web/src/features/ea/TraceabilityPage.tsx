import { Link, useSearchParams } from 'react-router-dom';
import { App, Button, Card, Flex, Select, Space, Table, Tag, TreeSelect, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PROCESS_ELEMENT_ID, type TraceRowDto } from '@processhub/shared';
import { useDataObjects, useTrace } from '@/api/ea';
import { apiDownload } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { ApplicationSelect, CapabilitySelect, LifecycleTag } from './ea-components';
import { applicationPath, eaStepHref, useEaLabel } from './ea-helpers';

const KEYS = ['capabilityId', 'processId', 'applicationId', 'dataObjectId'] as const;
const crud = (d: { create: boolean; read: boolean; update: boolean; delete: boolean }) =>
  `${d.create ? 'C' : ''}${d.read ? 'R' : ''}${d.update ? 'U' : ''}${d.delete ? 'D' : ''}`;

/** Traceability: capability → process → step → application → data object, and back. */
export function TraceabilityPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useEaLabel();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const processes = useProcessTreeOptions('');
  const data = useDataObjects({ pageSize: 500 });
  const q: Record<string, string | undefined> = {};
  for (const k of KEYS) q[k] = params.get(k) ?? undefined;
  const trace = useTrace(q);
  const set = (k: string, v: string | null | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const exportExcel = async () => {
    try {
      const f = await apiDownload(
        '/ea/trace/export',
        { query: { ...q, locale } },
        'traceability.xlsx',
      );
      downloadBlob(f.blob, f.fileName);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  const grcTag = (x: TraceRowDto['risks'][number]) => (
    <Tag key={x.id} color={x.type === 'RISK' ? 'volcano' : 'green'} style={{ marginBlockEnd: 2 }}>
      <Link to={`/grc/${x.type === 'RISK' ? 'risks' : 'controls'}/${x.id}`}>
        {x.code || loc(x)}
      </Link>
    </Tag>
  );

  return (
    <>
      <PageHeader
        title={t('ea:trace.title')}
        subtitle={t('ea:trace.subtitle')}
        extra={
          <Button icon={<DownloadOutlined />} onClick={() => void exportExcel()}>
            {t('grc:excel.export')}
          </Button>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <div style={{ width: 240 }}>
            <CapabilitySelect
              value={q.capabilityId}
              onChange={(v) => set('capabilityId', v as string | null)}
            />
          </div>
          <TreeSelect
            allowClear
            showSearch
            treeNodeFilterProp="title"
            placeholder={t('ea:fields.process')}
            value={q.processId}
            onChange={(v) => set('processId', v)}
            treeData={processes.options}
            treeDefaultExpandAll
            style={{ width: 260 }}
          />
          <ApplicationSelect
            value={q.applicationId}
            onChange={(v) => set('applicationId', v as string | null)}
            placeholder={t('ea:fields.application')}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('ea:fields.dataObjects')}
            value={q.dataObjectId}
            onChange={(v) => set('dataObjectId', v)}
            options={(data.data?.items ?? []).map((d) => ({ value: d.id, label: label(d) }))}
            style={{ width: 220 }}
          />
        </Flex>
        {trace.isError ? (
          <ErrorState error={trace.error} onRetry={() => void trace.refetch()} />
        ) : (
          <Table<TraceRowDto>
            rowKey={(r) => `${r.process.id}|${r.bpmnElementId}|${r.application?.id}`}
            size="small"
            loading={trace.isLoading}
            dataSource={trace.data ?? []}
            pagination={{ pageSize: 50 }}
            scroll={{ x: 1100 }}
            data-testid="trace-table"
            locale={{ emptyText: t('ea:trace.empty') }}
            columns={[
              {
                title: t('ea:fields.capabilities'),
                key: 'c',
                width: 160,
                render: (_, r) => r.capabilities.map((c) => <Tag key={c.id}>{label(c)}</Tag>),
              },
              {
                title: t('ea:fields.process'),
                key: 'p',
                width: 200,
                render: (_, r) => (
                  <Link to={`/processes/${r.process.id}`}>
                    {r.process.code} {loc(r.process)}
                  </Link>
                ),
              },
              {
                title: t('ea:fields.step'),
                key: 's',
                width: 180,
                render: (_, r) =>
                  r.bpmnElementId ? (
                    <Link to={eaStepHref({ process: r.process, bpmnElementId: r.bpmnElementId })}>
                      {r.bpmnElementId === PROCESS_ELEMENT_ID
                        ? t('ea:fields.wholeProcess')
                        : (r.element && loc(r.element)) || r.bpmnElementId}
                    </Link>
                  ) : (
                    <Typography.Text type="secondary">
                      {t('ea:trace.noApplication')}
                    </Typography.Text>
                  ),
              },
              {
                title: t('ea:fields.application'),
                key: 'a',
                width: 200,
                render: (_, r) =>
                  r.application ? (
                    <Space size={4} wrap>
                      <Link to={applicationPath(r.application.id)}>{label(r.application)}</Link>
                      <LifecycleTag lifecycle={r.application.lifecycle} />
                    </Space>
                  ) : (
                    '—'
                  ),
              },
              {
                title: t('ea:fields.dataObjects'),
                key: 'd',
                width: 200,
                render: (_, r) =>
                  r.dataObjects.map((d) => (
                    <Tag key={d.id}>
                      {loc(d)} <span dir="ltr">{crud(d)}</span>
                      {d.systemOfRecord ? ' ★' : ''}
                    </Tag>
                  )),
              },
              {
                title: t('ea:trace.risksControls'),
                key: 'g',
                render: (_, r) => [...r.risks.map(grcTag), ...r.controls.map(grcTag)],
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
