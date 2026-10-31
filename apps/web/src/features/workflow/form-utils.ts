import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import type { FormSchema, UserRef } from '@processhub/shared';
import { api } from '@/api/client';

/** Users by id (names for user fields). */
export function useUserNames(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  return useQuery({
    queryKey: ['workflow', 'user-names', key],
    queryFn: () => api<UserRef[]>('/workflow/users', { query: { ids: key } }),
    enabled: !!key,
    staleTime: 5 * 60_000,
  });
}

/** Converts form values for the API (dates as YYYY-MM-DD). */
export function formToData(schema: FormSchema, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (f.type === 'info' || f.readOnly) continue;
    const v = values[f.key];
    out[f.key] = f.type === 'date' && v && dayjs.isDayjs(v) ? v.format('YYYY-MM-DD') : v;
  }
  return out;
}

/** Initial form values (dates as dayjs). */
export function dataToForm(schema: FormSchema, data: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...data };
  for (const f of schema.fields)
    if (f.type === 'date' && typeof data[f.key] === 'string')
      out[f.key] = dayjs(data[f.key] as string);
  return out;
}
