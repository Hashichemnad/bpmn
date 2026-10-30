import { Link } from 'react-router-dom';
import { Badge, Table, Typography, type TabsProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AssuranceTasksDto, GrcChangeDto } from '@processhub/shared';
import { useAssuranceTasks } from '@/api/assurance';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { grcItemPath } from '@/features/grc/grc-helpers';

type Key = keyof AssuranceTasksDto;

/** Tabs of My tasks for assurance work (Phase 4.2), with their counts. */
export function useAssuranceTaskTabs(): {
  items: NonNullable<TabsProps['items']>;
  counts: Record<string, number>;
} {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const q = useAssuranceTasks();
  const d = q.data;
  if (!d) return { items: [], counts: {} };
  const counts = Object.fromEntries(
    (Object.keys(d) as Key[]).map((k) => [k, (d[k] as unknown[]).length]),
  );
  const label = (key: Key, title: string) => (
    <span>
      {title}{' '}
      <Badge
        count={counts[key]}
        size="small"
        color={counts[key] ? '#1d4ed8' : '#cbd5e1'}
        showZero
      />
    </span>
  );
  const person = (u: GrcChangeDto['submittedBy']) => (u ? loc(u) || u.email : '—');

  const items: NonNullable<TabsProps['items']> = [];
  if (d.grcChanges.length) {
    items.push({
      key: 'grcChanges',
      label: label('grcChanges', t('assurance:changes.tabTitle')),
      children: (
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={d.grcChanges}
          columns={[
            {
              title: t('assurance:changes.item'),
              render: (_, c) => (
                <Link to={grcItemPath(c.object.type, c.object.id)}>
                  {c.object.code && <span dir="ltr">{c.object.code} </span>}
                  {loc(c.object)}
                </Link>
              ),
            },
            {
              title: t('assurance:changes.fieldsChanged'),
              render: (_, c) =>
                c.fields
                  .map((f) => t(`assurance:changes.fields.${f.field}`, { defaultValue: f.field }))
                  .join(', '),
            },
            {
              title: t('assurance:changes.proposedBy'),
              render: (_, c) => (
                <Typography.Text>
                  {person(c.submittedBy)} · {formatDate(c.submittedAt)}
                </Typography.Text>
              ),
            },
          ]}
        />
      ),
    });
  }
  return { items, counts };
}
