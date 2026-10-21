import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Flex, Input, Space, Table, Tag, Typography, type TableProps } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type ObjectType, type RepoObjectDto } from '@processhub/shared';
import { useObjects } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { ObjectFormModal } from './ObjectFormModal';
import { useConfirmDeleteObject } from './useConfirmDeleteObject';

export function ObjectLibraryPage({ type }: { type: ObjectType }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 20,
    q: undefined as string | undefined,
    sort: 'nameEn',
    order: 'asc' as 'asc' | 'desc',
  });
  const objects = useObjects({ ...query, type });
  const [editing, setEditing] = useState<RepoObjectDto | 'new' | null>(null);
  const confirmDelete = useConfirmDeleteObject();
  const canManage = can(PERMISSIONS.OBJECTS_MANAGE);

  const columns: TableProps<RepoObjectDto>['columns'] = [
    {
      title: t('fields.name'),
      key: 'nameEn',
      sorter: true,
      render: (_, o) => (
        <Space direction="vertical" size={0}>
          <Link to={`/library/objects/${o.id}`}>
            <Typography.Text strong>{loc(o)}</Typography.Text>
          </Link>
          {o.code && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
              {o.code}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t('fields.description'),
      key: 'description',
      ellipsis: true,
      render: (_, o) => (
        <Typography.Text type="secondary">{loc(o, 'description') || '—'}</Typography.Text>
      ),
    },
    {
      title: t('objects:usage'),
      dataIndex: 'usageCount',
      width: 140,
      render: (n: number) =>
        n ? (
          <Tag color="blue">{t('objects:usedInSteps', { count: n })}</Tag>
        ) : (
          <Tag>{t('objects:unused')}</Tag>
        ),
    },
    ...(canManage
      ? [
          {
            title: '',
            key: 'actions',
            width: 100,
            render: (_: unknown, o: RepoObjectDto) => (
              <Space size={0}>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setEditing(o)}
                  aria-label={t('edit')}
                  title={t('edit')}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => confirmDelete(o)}
                  aria-label={t('delete')}
                  title={t('delete')}
                />
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t(`objects:library.${type}.title`)}
        subtitle={t(`objects:library.${type}.subtitle`)}
        extra={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {t(`objects:new.${type}`)}
            </Button>
          )
        }
      />
      <Card>
        <Flex style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('objects:search')}
            style={{ width: 300 }}
            onSearch={(q) => setQuery((s) => ({ ...s, q: q || undefined, page: 1 }))}
          />
        </Flex>
        {objects.isError ? (
          <ErrorState error={objects.error} onRetry={() => void objects.refetch()} />
        ) : (
          <Table<RepoObjectDto>
            rowKey="id"
            columns={columns}
            dataSource={objects.data?.items}
            loading={objects.isFetching}
            scroll={{ x: 700 }}
            locale={{
              emptyText: (
                <EmptyState
                  description={t(`objects:library.${type}.empty`)}
                  action={
                    canManage && (
                      <Button onClick={() => setEditing('new')}>{t(`objects:new.${type}`)}</Button>
                    )
                  }
                />
              ),
            }}
            pagination={{
              current: query.page,
              pageSize: query.pageSize,
              total: objects.data?.total,
              showTotal: (total) => t('totalItems', { count: total }),
            }}
            onChange={(p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              setQuery((q) => ({
                ...q,
                page: p.current ?? 1,
                pageSize: p.pageSize ?? 20,
                sort: s?.order ? String(s.columnKey) : 'nameEn',
                order: s?.order === 'descend' ? 'desc' : 'asc',
              }));
            }}
          />
        )}
      </Card>
      {editing && (
        <ObjectFormModal
          open
          type={type}
          object={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
