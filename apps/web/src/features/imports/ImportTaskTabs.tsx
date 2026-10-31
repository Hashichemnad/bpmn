import { Badge, Table, Tag, type TabsProps } from 'antd';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMyImportedDrafts } from '@/api/imports';
import { useLocalized } from '@/components/i18n-helpers';

/** My tasks: imported drafts the user owns (M15) — to check, complete and submit for review. */
export function useImportTaskTabs(): { items: NonNullable<TabsProps['items']>; count: number } {
  const { t } = useTranslation();
  const loc = useLocalized();
  const drafts = useMyImportedDrafts();
  const list = drafts.data ?? [];
  if (!list.length) return { items: [], count: 0 };
  return {
    count: list.length,
    items: [
      {
        key: 'imported',
        label: (
          <span>
            {t('imports:tasks.tab')} <Badge count={list.length} size="small" color="#7c3aed" />
          </span>
        ),
        children: (
          <Table
            size="small"
            rowKey={(r) => `${r.type}:${r.id}`}
            dataSource={list}
            pagination={false}
            data-testid="imported-tasks"
            columns={[
              {
                title: t('imports:fields.entity'),
                width: 120,
                render: (_, r) => t(`imports:entity.${r.type}`),
              },
              { title: t('imports:fields.key'), dataIndex: 'code', width: 120 },
              {
                title: t('imports:fields.name'),
                render: (_, r) => <Link to={r.href}>{loc(r) || '—'}</Link>,
              },
              {
                title: t('imports:review.problems'),
                render: (_, r) =>
                  r.problems.map((p) => (
                    <Tag key={p} color="orange">
                      {t(`imports:problem.${p}`)}
                    </Tag>
                  )),
              },
              {
                title: t('imports:fields.number'),
                width: 110,
                render: (_, r) => r.batch?.number ?? '—',
              },
            ]}
          />
        ),
      },
    ],
  };
}
