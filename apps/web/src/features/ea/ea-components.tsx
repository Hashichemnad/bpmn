import { Select, Tag, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  AppLifecycle,
  ApplicationRef,
  Criticality,
  DataClassification,
} from '@processhub/shared';
import { useAllApplications } from '@/api/ea';
import {
  CLASSIFICATION_COLORS,
  CRITICALITY_COLORS,
  LIFECYCLE_COLORS,
  useCapabilityTreeData,
  useEaLabel,
} from './ea-helpers';

export function LifecycleTag({ lifecycle }: { lifecycle: AppLifecycle }) {
  const { t } = useTranslation();
  return (
    <Tag color={LIFECYCLE_COLORS[lifecycle]} data-testid={`lifecycle-${lifecycle}`}>
      {t(`ea:lifecycle.${lifecycle}`)}
    </Tag>
  );
}

export function CriticalityTag({ value }: { value: Criticality }) {
  const { t } = useTranslation();
  return <Tag color={CRITICALITY_COLORS[value]}>{t(`ea:criticality.${value}`)}</Tag>;
}

export function ClassificationTag({ value }: { value: DataClassification }) {
  const { t } = useTranslation();
  return <Tag color={CLASSIFICATION_COLORS[value]}>{t(`ea:classification.${value}`)}</Tag>;
}

/** Searchable application picker (single or multiple). */
export function ApplicationSelect({
  value,
  onChange,
  multiple,
  exclude,
  id,
  placeholder,
  allowClear = true,
  style,
}: {
  id?: string;
  value?: string | string[] | null;
  onChange?: (v: string | string[] | null) => void;
  multiple?: boolean;
  exclude?: string;
  placeholder?: string;
  allowClear?: boolean;
  style?: React.CSSProperties;
}) {
  const apps = useAllApplications();
  const label = useEaLabel();
  const options = (apps.data?.items ?? [])
    .filter((a) => a.id !== exclude)
    .map((a: ApplicationRef) => ({ value: a.id, label: label(a) }));
  return (
    <Select
      id={id}
      mode={multiple ? 'multiple' : undefined}
      value={value ?? (multiple ? [] : undefined)}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      loading={apps.isLoading}
      showSearch
      optionFilterProp="label"
      allowClear={allowClear}
      placeholder={placeholder}
      style={style}
    />
  );
}

export function CapabilitySelect({
  value,
  onChange,
  multiple,
  id,
  ...opts
}: {
  id?: string;
  value?: string | string[] | null;
  onChange?: (v: string | string[] | null) => void;
  multiple?: boolean;
  exclude?: string;
  maxLevel?: number;
}) {
  const data = useCapabilityTreeData(opts);
  return (
    <TreeSelect
      id={id}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      treeData={data}
      multiple={multiple}
      treeDefaultExpandAll
      showSearch
      treeNodeFilterProp="title"
      allowClear
      style={{ width: '100%' }}
    />
  );
}
