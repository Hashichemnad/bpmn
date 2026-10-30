import { useMemo, useState } from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import type { GrcObjectType, GrcRef } from '@processhub/shared';
import { useGrcList } from '@/api/grc';
import { useLocalized } from '@/components/i18n-helpers';

/** Searchable picker of risks, controls or requirements (by code or title). */
export function GrcItemSelect({
  type,
  value,
  onChange,
  known = [],
  multiple = true,
  exclude,
  placeholder,
  filter,
}: {
  type: GrcObjectType;
  value?: string[] | string | null;
  onChange?: (v: string[] | string | null) => void;
  /** Items already related (shown with their names before searching). */
  known?: GrcRef[];
  multiple?: boolean;
  exclude?: string;
  placeholder?: string;
  filter?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const list = useGrcList(type, { q: q || undefined, pageSize: 20, sort: 'code', ...filter });
  const options = useMemo(() => {
    const all = new Map<string, GrcRef>();
    for (const r of [...known, ...(list.data?.items ?? [])]) if (r.id !== exclude) all.set(r.id, r);
    return [...all.values()].map((r) => ({
      value: r.id,
      label: `${r.code ? `${r.code} · ` : ''}${loc(r)}`,
    }));
  }, [known, list.data, loc, exclude]);
  return (
    <Select
      mode={multiple ? 'multiple' : undefined}
      showSearch
      allowClear
      value={value ?? undefined}
      onChange={(v: string[] | string | undefined) => onChange?.(v ?? (multiple ? [] : null))}
      filterOption={false}
      onSearch={setQ}
      loading={list.isFetching}
      options={options}
      placeholder={placeholder ?? t('grc:filters.search')}
      notFoundContent={t('noResults')}
      style={{ inlineSize: '100%' }}
    />
  );
}
