import { useState } from 'react';
import {
  App,
  Button,
  DatePicker,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { FilterOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import type { LogAnalysis, MiningFilter } from '@processhub/shared';
import { useDeletePreset, useFilterPresets, useSavePreset } from '@/api/mining';
import { useErrorMessage } from '@/components/i18n-helpers';
import { useAnalysisState } from './analysis-state';
import { useFormatDuration } from './mining-utils';

type FilterType = MiningFilter['type'];
const TYPES: FilterType[] = [
  'period',
  'attribute',
  'variant',
  'throughput',
  'activity',
  'follows',
  'resource',
  'department',
];
const HOUR = 3_600_000;

/** Stacked filters (AND) with saved presets per user (D-133). */
export function FilterBar({
  logId,
  analysis,
}: {
  logId: string;
  analysis: LogAnalysis | undefined;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const fmtD = useFormatDuration();
  const { filters, setFilters } = useAnalysisState();
  const presets = useFilterPresets(logId);
  const savePreset = useSavePreset(logId);
  const deletePreset = useDeletePreset(logId);
  const [adding, setAdding] = useState<FilterType | null>(null);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');

  const describe = (f: MiningFilter): string => {
    const not = 'exclude' in f && f.exclude ? `${t('mining:filters.not')} ` : '';
    switch (f.type) {
      case 'period':
        return `${t(`mining:filters.periodMode.${f.mode}`)}: ${f.from ? dayjs(f.from).format('YYYY-MM-DD') : '…'} – ${f.to ? dayjs(f.to).format('YYYY-MM-DD') : '…'}`;
      case 'attribute':
        return `${not}${f.name} = ${f.values.join(', ')}`;
      case 'variant':
        return `${not}${t('mining:filters.types.variant')} (${f.ids.length})`;
      case 'throughput':
        return `${t('mining:filters.types.throughput')}: ${f.min ? fmtD(f.min) : '0'} – ${f.max ? fmtD(f.max) : '∞'}`;
      case 'activity':
        return `${t(`mining:filters.activityMode.${f.mode}`)} ${f.activities.join(', ')}`;
      case 'follows':
        return `${not}${f.from} ${f.directly ? '→' : '⇢'} ${f.to}`;
      case 'resource':
      case 'department':
        return `${not}${t(`mining:filters.types.${f.type}`)}: ${f.values.join(', ')}`;
      case 'cases':
        return `${t('mining:filters.cases')} (${f.ids.length})`;
    }
  };

  return (
    <Flex gap={8} wrap="wrap" align="center" data-testid="mining-filters">
      <FilterOutlined />
      {filters.length === 0 && (
        <Typography.Text type="secondary">{t('mining:filters.none')}</Typography.Text>
      )}
      {filters.map((f, i) => (
        <Tag
          key={i}
          closable
          onClose={() => setFilters(filters.filter((_, k) => k !== i))}
          color="blue"
        >
          {describe(f)}
        </Tag>
      ))}
      <Dropdown
        menu={{
          items: TYPES.map((ty) => ({ key: ty, label: t(`mining:filters.types.${ty}`) })),
          onClick: ({ key }) => setAdding(key as FilterType),
        }}
      >
        <Button size="small" icon={<PlusOutlined />} data-testid="add-filter">
          {t('mining:filters.add')}
        </Button>
      </Dropdown>
      {filters.length > 0 && (
        <>
          <Button size="small" onClick={() => setFilters([])}>
            {t('mining:filters.clear')}
          </Button>
          <Button size="small" icon={<SaveOutlined />} onClick={() => setSaving(true)}>
            {t('mining:filters.save')}
          </Button>
        </>
      )}
      {(presets.data?.length ?? 0) > 0 && (
        <Select
          size="small"
          style={{ minWidth: 200 }}
          placeholder={t('mining:filters.presets')}
          value={null}
          onChange={(id) => {
            const p = presets.data!.find((x) => x.id === id);
            if (p) setFilters(p.filters);
          }}
          options={presets.data!.map((p) => ({
            value: p.id,
            label: (
              <Flex justify="space-between" gap={8}>
                <span>{p.name}</span>
                <Typography.Link
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePreset.mutate(p.id);
                  }}
                >
                  ×
                </Typography.Link>
              </Flex>
            ),
          }))}
        />
      )}
      {adding && (
        <FilterModal
          type={adding}
          analysis={analysis}
          onClose={() => setAdding(null)}
          onAdd={(f) => {
            setFilters([...filters, f]);
            setAdding(null);
          }}
        />
      )}
      <Modal
        open={saving}
        title={t('mining:filters.save')}
        okButtonProps={{ disabled: !presetName.trim() }}
        onCancel={() => setSaving(false)}
        onOk={() =>
          savePreset
            .mutateAsync({ name: presetName.trim(), filters, global: false })
            .then(() => {
              setSaving(false);
              setPresetName('');
            })
            .catch((e: unknown) => void message.error(errorMessage(e)))
        }
      >
        <Input
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder={t('mining:filters.presetName')}
        />
      </Modal>
    </Flex>
  );
}

function FilterModal({
  type,
  analysis,
  onClose,
  onAdd,
}: {
  type: FilterType;
  analysis: LogAnalysis | undefined;
  onClose: () => void;
  onAdd: (f: MiningFilter) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const opts = (list: string[] | undefined) => (list ?? []).map((v) => ({ value: v, label: v }));
  const activities = opts(analysis?.activitiesList);
  const attrNames = Object.keys(analysis?.attributeValues ?? {});
  const attrName = Form.useWatch('name', form) as string | undefined;
  const build = (v: Record<string, unknown>): MiningFilter => {
    const exclude = !!v.exclude;
    switch (type) {
      case 'period': {
        const r = v.range as [Dayjs | null, Dayjs | null] | undefined;
        return {
          type,
          from: r?.[0]?.startOf('day').toISOString() ?? null,
          to: r?.[1]?.endOf('day').toISOString() ?? null,
          mode: (v.mode as 'started') ?? 'intersecting',
        };
      }
      case 'attribute':
        return { type, name: v.name as string, values: v.values as string[], exclude };
      case 'variant':
        return { type, ids: v.ids as string[], exclude };
      case 'throughput':
        return {
          type,
          min: typeof v.min === 'number' ? v.min * HOUR : null,
          max: typeof v.max === 'number' ? v.max * HOUR : null,
        };
      case 'activity':
        return {
          type,
          activities: v.activities as string[],
          mode: (v.mode as 'contains') ?? 'contains',
        };
      case 'follows':
        return {
          type,
          from: v.from as string,
          to: v.to as string,
          directly: !!v.directly,
          exclude,
        };
      case 'resource':
      case 'department':
        return { type, values: v.values as string[], exclude };
      default:
        return { type: 'cases', ids: [] };
    }
  };
  const req = [{ required: true, message: t('validation.required') }];
  return (
    <Modal
      open
      title={t(`mining:filters.types.${type}`)}
      onCancel={onClose}
      onOk={() =>
        void form.validateFields().then((v) => onAdd(build(v as Record<string, unknown>)))
      }
      okText={t('mining:filters.apply')}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ mode: type === 'period' ? 'intersecting' : 'contains' }}
      >
        {type === 'period' && (
          <>
            <Form.Item name="range" label={t('mining:filters.range')} rules={req}>
              <DatePicker.RangePicker allowEmpty={[true, true]} />
            </Form.Item>
            <Form.Item name="mode" label={t('mining:filters.periodModeLabel')}>
              <Radio.Group
                options={(['intersecting', 'started', 'completed', 'contained'] as const).map(
                  (m) => ({
                    value: m,
                    label: t(`mining:filters.periodMode.${m}`),
                  }),
                )}
              />
            </Form.Item>
          </>
        )}
        {type === 'attribute' && (
          <>
            <Form.Item name="name" label={t('mining:filters.attribute')} rules={req}>
              <Select options={opts(attrNames)} />
            </Form.Item>
            <Form.Item name="values" label={t('mining:filters.values')} rules={req}>
              <Select
                mode="multiple"
                options={opts(attrName ? analysis?.attributeValues[attrName] : [])}
              />
            </Form.Item>
          </>
        )}
        {type === 'variant' && (
          <Form.Item name="ids" label={t('mining:filters.types.variant')} rules={req}>
            <Select
              mode="multiple"
              options={(analysis?.variants.items ?? []).map((v, i) => ({
                value: v.id,
                label: `#${i + 1} (${v.count}) ${v.activities.join(' → ')}`,
              }))}
            />
          </Form.Item>
        )}
        {type === 'throughput' && (
          <Flex gap={16}>
            <Form.Item name="min" label={t('mining:filters.minHours')}>
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="max" label={t('mining:filters.maxHours')}>
              <InputNumber min={0} />
            </Form.Item>
          </Flex>
        )}
        {type === 'activity' && (
          <>
            <Form.Item name="activities" label={t('mining:filters.activities')} rules={req}>
              <Select mode="multiple" options={activities} />
            </Form.Item>
            <Form.Item name="mode">
              <Radio.Group
                options={(['contains', 'notContains'] as const).map((m) => ({
                  value: m,
                  label: t(`mining:filters.activityMode.${m}`),
                }))}
              />
            </Form.Item>
          </>
        )}
        {type === 'follows' && (
          <>
            <Form.Item name="from" label={t('mining:filters.from')} rules={req}>
              <Select showSearch options={activities} />
            </Form.Item>
            <Form.Item name="to" label={t('mining:filters.to')} rules={req}>
              <Select showSearch options={activities} />
            </Form.Item>
            <Form.Item name="directly" label={t('mining:filters.directly')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}
        {(type === 'resource' || type === 'department') && (
          <Form.Item name="values" label={t(`mining:filters.types.${type}`)} rules={req}>
            <Select
              mode="multiple"
              options={opts(
                type === 'resource' ? analysis?.resourcesList : analysis?.departmentsList,
              )}
            />
          </Form.Item>
        )}
        {['attribute', 'variant', 'follows', 'resource', 'department'].includes(type) && (
          <Form.Item name="exclude" label={t('mining:filters.exclude')} valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
