import { useState } from 'react';
import { Card, DatePicker, Flex, Input, Select, Table, Tag, Typography, type TableProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction, type AuditLogDto } from '@processhub/shared';
import { useAuditLogs } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';

const ACTION_COLORS: Partial<Record<AuditAction, string>> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  LOGIN: 'cyan',
  LOGIN_FAILED: 'orange',
  LOCKOUT: 'volcano',
  LOGOUT: 'default',
  MOVE: 'purple',
  VERSION: 'geekblue',
};

interface Filters {
  page: number;
  pageSize: number;
  action?: AuditAction;
  entityType?: string;
  q?: string;
  from?: string;
  to?: string;
}

export function AuditLogPage() {
  const { t } = useTranslation();
  const formatDate = useFormatDate();
  const loc = useLocalized();
  const [filters, setFilters] = useState<Filters>({ page: 1, pageSize: 25 });
  const logs = useAuditLogs(filters);

  const columns: TableProps<AuditLogDto>['columns'] = [
    { title: t('admin:audit.time'), dataIndex: 'createdAt', width: 190, render: (v: string) => formatDate(v) },
    {
      title: t('admin:audit.user'),
      key: 'user',
      render: (_, r) =>
        r.user ? (
          <Flex vertical>
            <span>{loc(r.user)}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
              {r.user.email}
            </Typography.Text>
          </Flex>
        ) : (
          <Typography.Text type="secondary">{t('admin:audit.system')}</Typography.Text>
        ),
    },
    {
      title: t('admin:audit.action'),
      dataIndex: 'action',
      width: 150,
      render: (a: AuditAction) => <Tag color={ACTION_COLORS[a]}>{t(`admin:audit.actions.${a}`)}</Tag>,
    },
    {
      title: t('admin:audit.entity'),
      dataIndex: 'entityType',
      render: (v: string) => t(`admin:audit.entities.${v}`, { defaultValue: v }),
    },
    {
      title: t('admin:audit.entityId'),
      dataIndex: 'entityId',
      ellipsis: true,
      render: (v: string | null) => (v ? <Typography.Text code copyable={{ text: v }}>{v.slice(0, 8)}</Typography.Text> : '—'),
    },
    { title: t('admin:audit.ip'), dataIndex: 'ip', width: 140, render: (v: string | null) => <span dir="ltr">{v ?? '—'}</span> },
  ];

  const onRange = (range: [Dayjs | null, Dayjs | null] | null) =>
    setFilters((f) => ({
      ...f,
      page: 1,
      from: range?.[0]?.startOf('day').toISOString(),
      to: range?.[1]?.endOf('day').toISOString(),
    }));

  return (
    <>
      <PageHeader title={t('admin:audit.title')} subtitle={t('admin:audit.subtitle')} />
      <Card>
        <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('admin:audit.searchPlaceholder')}
            style={{ width: 260 }}
            onSearch={(q) => setFilters((f) => ({ ...f, q: q || undefined, page: 1 }))}
          />
          <Select
            allowClear
            placeholder={t('admin:audit.action')}
            style={{ width: 180 }}
            options={AUDIT_ACTIONS.map((a) => ({ value: a, label: t(`admin:audit.actions.${a}`) }))}
            onChange={(action) => setFilters((f) => ({ ...f, action, page: 1 }))}
          />
          <Select
            allowClear
            placeholder={t('admin:audit.entity')}
            style={{ width: 180 }}
            options={AUDIT_ENTITY_TYPES.map((e) => ({ value: e, label: t(`admin:audit.entities.${e}`) }))}
            onChange={(entityType) => setFilters((f) => ({ ...f, entityType, page: 1 }))}
          />
          <DatePicker.RangePicker onChange={(r) => onRange(r as [Dayjs | null, Dayjs | null] | null)} />
        </Flex>
        {logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : (
          <Table<AuditLogDto>
            rowKey="id"
            size="middle"
            columns={columns}
            dataSource={logs.data?.items}
            loading={logs.isFetching}
            scroll={{ x: 900 }}
            locale={{ emptyText: t('admin:audit.empty') }}
            expandable={{
              rowExpandable: (r) => r.summary !== null && r.summary !== undefined,
              expandedRowRender: (r) => (
                <pre className="ph-json" dir="ltr">
                  {JSON.stringify(r.summary, null, 2)}
                </pre>
              ),
            }}
            pagination={{
              current: filters.page,
              pageSize: filters.pageSize,
              total: logs.data?.total,
              showSizeChanger: true,
              showTotal: (total) => t('totalItems', { count: total }),
            }}
            onChange={(p) => setFilters((f) => ({ ...f, page: p.current ?? 1, pageSize: p.pageSize ?? 25 }))}
          />
        )}
      </Card>
    </>
  );
}
