import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Flex, Input, Segmented, Table, type TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  PROCESS_CATEGORIES,
  type ProcessCategory,
  type ProcessSummaryDto,
} from '@processhub/shared';
import { useProcessTree } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { CategoryTag, StatusTag } from '@/components/tags';
import { ErrorState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { ProcessFormModal } from './ProcessFormModal';

export function ProcessListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const tree = useProcessTree();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ProcessCategory | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tree.data ?? [])
      .filter((p) => category === 'ALL' || p.category === category)
      .filter(
        (p) =>
          !needle || [p.code, p.nameEn, p.nameAr].some((v) => v.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [tree.data, q, category]);

  const columns: TableProps<ProcessSummaryDto>['columns'] = [
    {
      title: t('fields.code'),
      dataIndex: 'code',
      width: 120,
      render: (v: string, p) => (
        <Link to={`/processes/${p.id}`} dir="ltr">
          {v}
        </Link>
      ),
    },
    {
      title: t('fields.name'),
      key: 'name',
      render: (_, p) => <Link to={`/processes/${p.id}`}>{loc(p)}</Link>,
    },
    {
      title: t('fields.category'),
      dataIndex: 'category',
      width: 150,
      render: (c) => <CategoryTag category={c} />,
    },
    { title: t('processes:level'), dataIndex: 'level', width: 90 },
    {
      title: t('fields.status'),
      dataIndex: 'status',
      width: 130,
      render: (s) => <StatusTag status={s} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('processes:list.title')}
        subtitle={t('processes:list.subtitle')}
        extra={
          can(PERMISSIONS.PROCESSES_CREATE) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('processes:new')}
            </Button>
          )
        }
      />
      <Card>
        <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('processes:tree.search')}
            style={{ width: 280 }}
            onChange={(e) => setQ(e.target.value)}
          />
          <Segmented
            value={category}
            onChange={(v) => setCategory(v as ProcessCategory | 'ALL')}
            options={[
              { value: 'ALL', label: t('all') },
              ...PROCESS_CATEGORIES.map((c) => ({ value: c, label: t(`processes:category.${c}`) })),
            ]}
          />
        </Flex>
        {tree.isError ? (
          <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
        ) : (
          <Table<ProcessSummaryDto>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            loading={tree.isLoading}
            pagination={{ pageSize: 25, showTotal: (total) => t('totalItems', { count: total }) }}
            locale={{ emptyText: t('processes:list.empty') }}
          />
        )}
      </Card>
      {creating && <ProcessFormModal open mode="create" onClose={() => setCreating(false)} />}
    </>
  );
}
