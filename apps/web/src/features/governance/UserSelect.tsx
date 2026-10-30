import { useMemo, useState } from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import type { UserRef } from '@processhub/shared';
import { useUserDirectory } from '@/api/governance';
import { useLocalized } from '@/components/i18n-helpers';

/** Searchable user picker (active users from the directory). */
export function UserSelect({
  value,
  onChange,
  known = [],
  placeholder,
  allowClear,
  size,
  style,
  id,
}: {
  /** Set by Form.Item (labels, tests). */
  id?: string;
  value?: string | null;
  onChange?: (id: string | null) => void;
  /** Users whose names are already known (current value), shown before searching. */
  known?: UserRef[];
  placeholder?: string;
  allowClear?: boolean;
  size?: 'small' | 'middle';
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const users = useUserDirectory(q);
  const options = useMemo(() => {
    const all = new Map<string, UserRef>();
    for (const u of [...known, ...(users.data ?? [])]) all.set(u.id, u);
    return [...all.values()].map((u) => ({
      value: u.id,
      label: `${loc(u) || u.email}${loc(u) ? ` · ${u.email}` : ''}`,
    }));
  }, [known, users.data, loc]);
  return (
    <Select
      id={id}
      showSearch
      allowClear={allowClear}
      size={size}
      style={{ inlineSize: '100%', ...style }}
      value={value ?? undefined}
      placeholder={placeholder ?? t('governance:pickUser')}
      filterOption={false}
      onSearch={setQ}
      onChange={(v: string | undefined) => onChange?.(v ?? null)}
      loading={users.isFetching}
      options={options}
      notFoundContent={t('noResults')}
    />
  );
}
