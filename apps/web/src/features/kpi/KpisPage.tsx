import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { CloudOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { KPI_RAG, KPI_STATUSES, type KpiDto, type KpiSettings } from '@processhub/shared';
import {
  useKpiImport,
  useKpiSettings,
  useKpis,
  useSaveKpiSettings,
  type KpiQuery,
} from '@/api/kpi';
import { PageHeader } from '@/components/PageHeader';
import { ExcelMenu } from '@/components/ExcelMenu';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { KpiFormModal } from './KpiFormModal';
import { RagTag, Sparkline } from './kpi-components';
import {
  kpiPath,
  useFormatPeriod,
  useFormatValue,
  useKpiAccess,
  useObjectiveTreeData,
} from './kpi-helpers';

const FILTERS = [
  'q',
  'status',
  'rag',
  'departmentId',
  'objectiveId',
  'ownerId',
  'processId',
  'due',
] as const;
const useKpisImport = () => useKpiImport('kpis');
const useMeasurementsImport = () => useKpiImport('measurements');

/** KPI catalogue: latest status, trend, filters in the URL, Excel, settings. */
export function KpisPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const access = useKpiAccess();
  const navigate = useNavigate();
  const formatValue = useFormatValue();
  const formatPeriod = useFormatPeriod();
  const departments = useDepartmentTreeData();
  const objectives = useObjectiveTreeData();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    for (const k of FILTERS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);
  const query: KpiQuery = {
    ...filters,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 20),
    sort: params.get('sort') ?? 'code',
    order: params.get('order') ?? 'asc',
  };
  const list = useKpis(query);
  const set = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('kpi:register.title')}
        subtitle={t('kpi:register.subtitle')}
        extra={
          <>
            {access.canEdit && (
              <Button icon={<SettingOutlined />} onClick={() => setSettings(true)}>
                {t('kpi:register.settings')}
              </Button>
            )}
            <ExcelMenu
              basePath="/kpis"
              kind="kpis"
              title={t('kpi:register.title')}
              canImport={access.canEdit}
              useImport={useKpisImport}
            />
            <ExcelMenu
              basePath="/kpis"
              kind="measurements"
              title={t('kpi:detail.measurements')}
              label={t('kpi:detail.measurementsExcel')}
              canImport={access.canMeasureAny}
              useImport={useMeasurementsImport}
            />
            {access.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                {t('kpi:register.new')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('kpi:filters.search')}
            defaultValue={filters.q}
            onSearch={(q) => set({ q })}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder={t('kpi:fields.status')}
            value={filters.rag}
            onChange={(v) => set({ rag: v })}
            options={KPI_RAG.map((r) => ({ value: r, label: t(`kpi:rag.${r}`) }))}
            style={{ width: 150 }}
          />
          <Select
            allowClear
            placeholder={t('kpi:fields.status')}
            value={filters.status}
            onChange={(v) => set({ status: v })}
            options={KPI_STATUSES.map((s) => ({ value: s, label: t(`kpi:status.${s}`) }))}
            style={{ width: 130 }}
          />
          <TreeSelect
            allowClear
            placeholder={t('kpi:fields.objectives')}
            value={filters.objectiveId}
            onChange={(v) => set({ objectiveId: v })}
            treeData={objectives}
            treeDefaultExpandAll
            style={{ width: 220 }}
          />
          <TreeSelect
            allowClear
            placeholder={t('kpi:fields.department')}
            value={filters.departmentId}
            onChange={(v) => set({ departmentId: v })}
            treeData={departments}
            treeDefaultExpandAll
            style={{ width: 200 }}
          />
          <Checkbox
            checked={filters.due === 'true'}
            onChange={(e) => set({ due: e.target.checked ? 'true' : null })}
          >
            {t('kpi:register.dueOnly')}
          </Checkbox>
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<KpiDto>
            rowKey="id"
            size="middle"
            data-testid="kpi-register"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            scroll={{ x: 1000 }}
            locale={{ emptyText: <EmptyState description={t('kpi:register.empty')} /> }}
            onRow={(k) => ({ onDoubleClick: () => navigate(kpiPath(k.id)) })}
            pagination={{
              current: query.page as number,
              pageSize: query.pageSize as number,
              total: list.data?.total ?? 0,
              showSizeChanger: true,
            }}
            onChange={(p, _f, s) => {
              const sorter = Array.isArray(s) ? s[0] : s;
              set({
                page: String(p.current ?? 1),
                pageSize: String(p.pageSize ?? 20),
                sort: sorter?.order ? String(sorter.columnKey) : null,
                order: sorter?.order === 'descend' ? 'desc' : sorter?.order ? 'asc' : null,
              });
            }}
            columns={[
              {
                title: t('kpi:fields.name'),
                key: 'code',
                sorter: true,
                render: (_, k) => (
                  <Space direction="vertical" size={0}>
                    <Link to={kpiPath(k.id)}>{loc(k) || '—'}</Link>
                    <Space size={4}>
                      {k.code && (
                        <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
                          {k.code}
                        </Typography.Text>
                      )}
                      {k.salesforceId && (
                        <Tag icon={<CloudOutlined />} color="blue" style={{ fontSize: 11 }}>
                          Salesforce
                        </Tag>
                      )}
                    </Space>
                  </Space>
                ),
              },
              {
                title: t('kpi:fields.latest'),
                key: 'rag',
                sorter: true,
                width: 220,
                render: (_, k) =>
                  k.latest ? (
                    <Space direction="vertical" size={0}>
                      <Space size={4}>
                        <RagTag rag={k.latest.rag} />
                        <Typography.Text strong>
                          {formatValue(k.latest.value, k.unit)}
                        </Typography.Text>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatPeriod(k.latest.period)}
                        {k.latest.target !== null &&
                          ` · ${t('kpi:fields.target')} ${formatValue(k.latest.target, k.unit)}`}
                      </Typography.Text>
                    </Space>
                  ) : (
                    <RagTag rag={null} />
                  ),
              },
              {
                title: t('kpi:fields.trend'),
                key: 'trend',
                width: 120,
                render: (_, k) => <Sparkline points={k.trend} />,
              },
              {
                title: t('kpi:fields.frequency'),
                key: 'frequency',
                width: 110,
                render: (_, k) => t(`kpi:frequency.${k.frequency}`),
              },
              {
                title: t('kpi:fields.owner'),
                key: 'owner',
                width: 160,
                render: (_, k) => (k.owner ? loc(k.owner) || k.owner.email : '—'),
              },
              {
                title: t('kpi:fields.dataSource'),
                key: 'dataSource',
                width: 150,
                render: (_, k) => (
                  <Space size={4} wrap>
                    {t(`kpi:dataSource.${k.dataSource}`)}
                    {k.due && (
                      <Tag color="gold">
                        {t('kpi:detail.due', { period: formatPeriod(k.duePeriod) })}
                      </Tag>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      {creating && (
        <KpiFormModal onClose={() => setCreating(false)} onSaved={(id) => navigate(kpiPath(id))} />
      )}
      {settings && <KpiSettingsModal onClose={() => setSettings(false)} />}
    </>
  );
}

function KpiSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useKpiSettings();
  const save = useSaveKpiSettings();
  const [form] = Form.useForm<KpiSettings>();
  if (!settings.data) return null;
  return (
    <Modal
      open
      title={t('kpi:settings.title')}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={settings.data}
        onFinish={(v) =>
          save.mutate(v, {
            onSuccess: () => {
              message.success(t('saved'));
              onClose();
            },
            onError: (err) => message.error(errorMessage(err)),
          })
        }
      >
        <Form.Item
          name="showInPortal"
          label={t('kpi:settings.showInPortal')}
          extra={t('kpi:settings.showInPortalHint')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Form.Item name="reminders" label={t('kpi:settings.reminders')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
