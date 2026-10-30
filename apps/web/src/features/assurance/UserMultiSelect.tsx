import { useMemo, useState } from 'react';
import { Select } from 'antd';
import type { UserRef } from '@processhub/shared';
import { useUserDirectory } from '@/api/governance';
import { useLocalized } from '@/components/i18n-helpers';

/** Searchable picker of several users (audit team, campaign recipients). */
export function UserMultiSelect({
  id,
  value,
  onChange,
  known = [],
}: {
  id?: string;
  value?: string[];
  onChange?: (ids: string[]) => void;
  known?: UserRef[];
}) {
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const users = useUserDirectory(q);
  const [seen, setSeen] = useState<UserRef[]>(known);
  const options = useMemo(() => {
    const all = new Map<string, UserRef>();
    for (const u of [...known, ...seen, ...(users.data ?? [])]) all.set(u.id, u);
    return [...all.values()].map((u) => ({ value: u.id, label: loc(u) || u.email }));
  }, [known, seen, users.data, loc]);
  return (
    <Select
      id={id}
      mode="multiple"
      showSearch
      allowClear
      filterOption={false}
      value={value ?? []}
      onSearch={setQ}
      onChange={(ids: string[]) => {
        setSeen((s) => [...s, ...(users.data ?? []).filter((u) => ids.includes(u.id))]);
        onChange?.(ids);
      }}
      loading={users.isFetching}
      options={options}
      style={{ width: '100%' }}
    />
  );
}
