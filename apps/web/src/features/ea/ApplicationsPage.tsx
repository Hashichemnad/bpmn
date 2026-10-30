import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Checkbox, Flex, Input, Select, Space, Table, Tag, TreeSelect } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { APP_LIFECYCLES, APP_TYPES, CRITICALITIES, type ApplicationDto } from '@processhub/shared';
import { useApplications, useEaImport, type EaQuery } from '@/api/ea';
import { PageHeader } from '@/components/PageHeader';
import { ExcelMenu } from '@/components/ExcelMenu';
import { EmptyState, ErrorState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { ApplicationFormModal } from './ApplicationFormModal';
import { CapabilitySelect, CriticalityTag, LifecycleTag } from './ea-components';
import { applicationPath, useEaAccess, useEnumOptions } from './ea-helpers';

const FILTERS = [
  'q',
  'appType',
  'lifecycle',
  'criticality',
  'departmentId',
  'capabilityId',
  'endOfLifeInUse',
  'processId',
] as const;

const useApplicationImport = () => useEaImport('applications');

/** Application catalogue (Phase 4.3, M11): filters in the URL, Excel, new application. */
export function ApplicationsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const access = useEaAccess();
  const navigate = useNavigate();
  const departments = useDepartmentTreeData();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const types = useEnumOptions('appType', APP_TYPES);
  const lifecycles = useEnumOptions('lifecycle', APP_LIFECYCLES);
  const criticalities = useEnumOptions('criticality', CRITICALITIES);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    for (const k of FILTERS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);
  const query: EaQuery = {
    ...filters,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 20),
    sort: params.get('sort') ?? 'nameEn',
    order: params.get('order') ?? 'asc',
  };
  const list = useApplications(query);
  const set = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('ea:applications.title')}
        subtitle={t('ea:applications.subtitle')}
        extra={
          <>
            <ExcelMenu
              basePath="/ea"
              kind="applications"
              title={t('ea:applications.title')}
              canImport={access.canEdit}
              useImport={useApplicationImport}
            />
            {access.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                {t('ea:applications.new')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('ea:filters.search')}
            defaultValue={filters.q}
            onSearch={(q) => set({ q })}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            placeholder={t('ea:fields.type')}
            value={filters.appType}
            onChange={(v) => set({ appType: v })}
            options={types}
            style={{ width: 160 }}
          />
          <Select
            allowClear
            placeholder={t('ea:fields.lifecycle')}
            value={filters.lifecycle}
            onChange={(v) => set({ lifecycle: v })}
            options={lifecycles}
            style={{ width: 170 }}
            data-testid="filter-lifecycle"
          />
          <Select
            allowClear
            placeholder={t('ea:fields.criticality')}
            value={filters.criticality}
            onChange={(v) => set({ criticality: v })}
            options={criticalities}
            style={{ width: 140 }}
          />
          <TreeSelect
            allowClear
            placeholder={t('ea:fields.department')}
            value={filters.departmentId}
            onChange={(v) => set({ departmentId: v })}
            treeData={departments}
            treeDefaultExpandAll
            style={{ width: 200 }}
          />
          <div style={{ width: 220 }}>
            <CapabilitySelect
              value={filters.capabilityId}
              onChange={(v) => set({ capabilityId: (v as string) ?? null })}
            />
          </div>
          <Checkbox
            checked={filters.endOfLifeInUse === 'true'}
            onChange={(e) => set({ endOfLifeInUse: e.target.checked ? 'true' : null })}
          >
            {t('ea:applications.endOfLifeInUse')}
          </Checkbox>
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<ApplicationDto>
            rowKey="id"
            size="middle"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            scroll={{ x: 1000 }}
            locale={{ emptyText: <EmptyState description={t('ea:applications.empty')} /> }}
            onRow={(a) => ({ onDoubleClick: () => navigate(applicationPath(a.id)) })}
            pagination={{
              current: query.page as number,
              pageSize: query.pageSize as number,
              total: list.data?.total ?? 0,
              showSizeChanger: true,
            }}
            onChange={(p, _f, s) => {
              const sorter = Array.isArray(s) ? s[0] : s;
              set({
                page: String(p.current ?? 1),
                pageSize: String(p.pageSize ?? 20),
                sort: sorter?.order ? String(sorter.columnKey) : null,
                order: sorter?.order === 'descend' ? 'desc' : sorter?.order ? 'asc' : null,
              });
            }}
            columns={[
              {
                title: t('ea:fields.name'),
                key: 'nameEn',
                sorter: true,
                render: (_, a) => (
                  <Space direction="vertical" size={0}>
                    <Link to={applicationPath(a.id)}>{loc(a) || '—'}</Link>
                    {a.code && (
                      <span className="ph-muted" dir="ltr" style={{ fontSize: 12 }}>
                        {a.code}
                      </span>
                    )}
                  </Space>
                ),
              },
              {
                title: t('ea:fields.type'),
                key: 'appType',
                width: 130,
                render: (_, a) => t(`ea:appType.${a.appType}`),
              },
              {
                title: t('ea:fields.lifecycle'),
                key: 'lifecycle',
                sorter: true,
                width: 150,
                render: (_, a) => <LifecycleTag lifecycle={a.lifecycle} />,
              },
              {
                title: t('ea:fields.criticality'),
                key: 'criticality',
                sorter: true,
                width: 110,
                render: (_, a) => <CriticalityTag value={a.criticality} />,
              },
              {
                title: t('ea:fields.vendor'),
                key: 'vendor',
                width: 140,
                render: (_, a) => a.vendor || '—',
              },
              {
                title: t('ea:fields.hosting'),
                key: 'hosting',
                width: 140,
                render: (_, a) =>
                  `${t(`ea:hosting.${a.hosting}`)}${a.hostingCountry ? ` · ${a.hostingCountry}` : ''}`,
              },
              {
                title: t('ea:fields.businessOwner'),
                key: 'owner',
                width: 160,
                render: (_, a) =>
                  a.businessOwner ? loc(a.businessOwner) || a.businessOwner.email : '—',
              },
              {
                title: t('ea:fields.steps'),
                key: 'stepCount',
                sorter: true,
                width: 90,
                render: (_, a) => (a.stepCount ? <Tag color="blue">{a.stepCount}</Tag> : '—'),
              },
              {
                title: t('ea:fields.interfaces'),
                key: 'interfaceCount',
                sorter: true,
                width: 100,
                render: (_, a) => a.interfaceCount || '—',
              },
            ]}
          />
        )}
      </Card>
      {creating && (
        <ApplicationFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => navigate(applicationPath(id))}
        />
      )}
    </>
  );
}
