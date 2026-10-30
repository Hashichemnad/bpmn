import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Tag,
  TreeSelect,
  Typography,
  type TableProps,
} from 'antd';
import { CloseCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  CONTROL_EFFECTIVENESS,
  CONTROL_TYPES,
  GRC_STATUSES,
  REQUIREMENT_LEVELS,
  type ControlDto,
  type GrcItemDto,
  type GrcObjectType,
  type RequirementDto,
  type RiskDto,
} from '@processhub/shared';
import { useGrcList, type GrcQuery } from '@/api/grc';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import { useLocale } from '@/app/LocaleProvider';
import { GrcFormModal } from './GrcFormModal';
import { GrcExcelMenu } from './GrcExcelMenu';
import { grcItemPath, useCategoryName, useGrcAccess, useGrcConfig } from './grc-helpers';
import { EffectivenessTag, GrcStatusTag, OverdueTag, RatingTag } from './grc-tags';

/** Query parameters a register understands (dashboard tiles link here with some of them set). */
const FILTER_KEYS = [
  'q',
  'status',
  'departmentId',
  'ownerId',
  'processId',
  'overdue',
  'category',
  'rating',
  'inherentRating',
  'cell',
  'matrix',
  'withoutControls',
  'alertWithoutEffectiveControl',
  'controlType',
  'effectiveness',
  'keyControl',
  'keyAttention',
  'level',
  'parentId',
] as const;
const TOGGLES: Record<GrcObjectType, { key: string; label: string }[]> = {
  RISK: [
    { key: 'overdue', label: 'grc:filters.overdue' },
    { key: 'withoutControls', label: 'grc:filters.withoutControls' },
    { key: 'alertWithoutEffectiveControl', label: 'grc:filters.alertNoControl' },
  ],
  CONTROL: [
    { key: 'overdue', label: 'grc:filters.overdue' },
    { key: 'keyControl', label: 'grc:filters.keyOnly' },
    { key: 'keyAttention', label: 'grc:filters.keyAttention' },
  ],
  REQUIREMENT: [{ key: 'withoutControls', label: 'grc:filters.withoutControls' }],
};

/** Risk register, control library and requirements library (one page per type). */
export function GrcRegisterPage({ type }: { type: GrcObjectType }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const formatDate = useFormatDate();
  const access = useGrcAccess();
  const config = useGrcConfig();
  const categoryName = useCategoryName();
  const departments = useDepartmentTreeData();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 20);
  const sort = params.get('sort') ?? (type === 'RISK' ? 'residualScore' : 'code');
  const order = (params.get('order') ?? (type === 'RISK' ? 'desc' : 'asc')) as 'asc' | 'desc';
  const query: GrcQuery = { ...filters, page, pageSize, sort, order };
  const list = useGrcList(type, query);

  const set = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const titleCol: NonNullable<TableProps<GrcItemDto>['columns']>[number] = {
    title: t('grc:fields.title'),
    key: 'code',
    sorter: true,
    width: 300,
    fixed: 'left',
    render: (_, o) => (
      <Space direction="vertical" size={0}>
        <Link to={grcItemPath(type, o.id)}>
          <Typography.Text strong>{loc(o) || '—'}</Typography.Text>
        </Link>
        {o.code && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
            {o.code}
          </Typography.Text>
        )}
      </Space>
    ),
  };
  const statusCol = {
    title: t('grc:fields.status'),
    key: 'status',
    sorter: true,
    width: 120,
    render: (_: unknown, o: GrcItemDto) => (
      <Space size={4} wrap>
        <GrcStatusTag status={o.status} />
        {o.overdue && <OverdueTag />}
      </Space>
    ),
  };
  const ownerCol = {
    title: t('grc:fields.owner'),
    key: 'owner',
    width: 160,
    render: (_: unknown, o: GrcItemDto) => (o.owner ? loc(o.owner) || o.owner.email : '—'),
  };
  const reviewCol = {
    title: t('grc:fields.nextReview'),
    key: 'nextReviewAt',
    sorter: true,
    width: 130,
    render: (_: unknown, o: GrcItemDto) => formatDate(o.nextReviewAt, false),
  };
  const stepsCol = {
    title: t('grc:fields.steps'),
    key: 'stepCount',
    sorter: true,
    width: 110,
    render: (_: unknown, o: GrcItemDto) =>
      o.stepCount ? <Tag color="blue">{o.stepCount}</Tag> : '—',
  };

  const columns: TableProps<GrcItemDto>['columns'] =
    type === 'RISK'
      ? [
          titleCol,
          {
            title: t('grc:fields.category'),
            key: 'category',
            sorter: true,
            width: 130,
            render: (_, o) => categoryName((o as RiskDto).category),
          },
          {
            title: t('grc:fields.inherentRating'),
            key: 'inherentScore',
            sorter: true,
            width: 140,
            render: (_, o) => (
              <RatingTag
                score={(o as RiskDto).rating.inherentScore}
                band={(o as RiskDto).rating.inherentBand}
              />
            ),
          },
          {
            title: t('grc:fields.residualRating'),
            key: 'residualScore',
            sorter: true,
            width: 140,
            render: (_, o) => (
              <RatingTag
                score={(o as RiskDto).rating.residualScore}
                band={(o as RiskDto).rating.residualBand}
              />
            ),
          },
          {
            title: t('grc:fields.controls'),
            key: 'controls',
            width: 140,
            render: (_, o) => {
              const r = o as RiskDto;
              if (!r.controls.length)
                return <Tag color="red">{t('grc:filters.withoutControls')}</Tag>;
              return (
                <Tag color={r.effectivelyControlled ? 'green' : 'orange'}>
                  {r.controls.length} ·{' '}
                  {t(
                    r.effectivelyControlled
                      ? 'grc:detail.effectivelyControlled'
                      : 'grc:detail.notControlled',
                  )}
                </Tag>
              );
            },
          },
          ownerCol,
          statusCol,
          reviewCol,
          stepsCol,
        ]
      : type === 'CONTROL'
        ? [
            titleCol,
            {
              title: t('grc:fields.controlType'),
              key: 'controlType',
              sorter: true,
              width: 120,
              render: (_, o) => t(`grc:controlType.${(o as ControlDto).controlType}`),
            },
            {
              title: t('grc:fields.nature'),
              key: 'nature',
              width: 150,
              render: (_, o) => t(`grc:nature.${(o as ControlDto).nature}`),
            },
            {
              title: t('grc:fields.frequency'),
              key: 'frequency',
              width: 120,
              render: (_, o) => t(`grc:frequency.${(o as ControlDto).frequency}`),
            },
            {
              title: t('grc:fields.keyControl'),
              key: 'keyControl',
              sorter: true,
              width: 100,
              render: (_, o) =>
                (o as ControlDto).keyControl ? (
                  <Tag color="purple">{t('grc:fields.keyControl')}</Tag>
                ) : (
                  '—'
                ),
            },
            {
              title: t('grc:fields.effectiveness'),
              key: 'effectiveness',
              sorter: true,
              width: 150,
              render: (_, o) => <EffectivenessTag value={(o as ControlDto).effectiveness} />,
            },
            {
              title: t('grc:fields.risks'),
              key: 'risks',
              width: 80,
              render: (_, o) => (o as ControlDto).risks.length || '—',
            },
            ownerCol,
            statusCol,
            reviewCol,
            stepsCol,
          ]
        : [
            titleCol,
            {
              title: t('grc:fields.level'),
              key: 'level',
              sorter: true,
              width: 140,
              render: (_, o) => t(`grc:level.${(o as RequirementDto).level}`),
            },
            {
              title: t('grc:fields.parent'),
              key: 'parent',
              width: 180,
              render: (_, o) => {
                const p = (o as RequirementDto).parent;
                return p ? (
                  <Link to={grcItemPath('REQUIREMENT', p.id)}>{p.code || loc(p)}</Link>
                ) : (
                  '—'
                );
              },
            },
            {
              title: t('grc:fields.sourceRef'),
              key: 'sourceRef',
              sorter: true,
              ellipsis: true,
              render: (_, o) => (o as RequirementDto).sourceRef || '—',
            },
            {
              title: t('grc:fields.controls'),
              key: 'controls',
              width: 110,
              render: (_, o) => {
                const n = (o as RequirementDto).controls.length;
                return n ? n : <Tag color="red">{t('grc:filters.withoutControls')}</Tag>;
              },
            },
            ownerCol,
            statusCol,
            {
              title: t('grc:fields.effectiveDate'),
              key: 'effectiveDate',
              sorter: true,
              width: 130,
              render: (_, o) => formatDate((o as RequirementDto).effectiveDate, false),
            },
          ];

  const hasFilters = Object.keys(filters).length > 0;
  const enumOptions = (list: readonly string[], ns: string) =>
    list.map((v) => ({ value: v, label: t(`grc:${ns}.${v}`) }));

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t(`grc:register.${type}.title`) }]}
        title={t(`grc:register.${type}.title`)}
        subtitle={t(`grc:register.${type}.subtitle`)}
        extra={
          <Space wrap>
            <GrcExcelMenu type={type} />
            {(type === 'REQUIREMENT' ? access.canEdit : access.canPropose) && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                {t(`grc:register.${type}.${access.canEdit ? 'new' : 'propose'}`)}
              </Button>
            )}
          </Space>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 12 }}>
          <Input.Search
            allowClear
            defaultValue={filters.q}
            placeholder={t('grc:filters.search')}
            style={{ inlineSize: 240 }}
            onSearch={(q) => set({ q })}
          />
          <Select
            allowClear
            style={{ inlineSize: 140 }}
            placeholder={t('grc:fields.status')}
            value={filters.status}
            onChange={(v) => set({ status: v })}
            options={enumOptions(GRC_STATUSES, 'status')}
          />
          {type === 'RISK' && (
            <>
              <Select
                allowClear
                style={{ inlineSize: 160 }}
                placeholder={t('grc:fields.category')}
                value={filters.category}
                onChange={(v) => set({ category: v })}
                options={config.categories.map((c) => ({
                  value: c.key,
                  label: locale === 'ar' ? c.nameAr : c.nameEn,
                }))}
              />
              <Select
                allowClear
                style={{ inlineSize: 170 }}
                placeholder={t('grc:fields.residualRating')}
                value={filters.rating}
                onChange={(v) => set({ rating: v })}
                options={config.bands.map((b) => ({
                  value: b.key,
                  label: locale === 'ar' ? b.nameAr : b.nameEn,
                }))}
              />
            </>
          )}
          {type === 'CONTROL' && (
            <>
              <Select
                allowClear
                style={{ inlineSize: 140 }}
                placeholder={t('grc:fields.controlType')}
                value={filters.controlType}
                onChange={(v) => set({ controlType: v })}
                options={enumOptions(CONTROL_TYPES, 'controlType')}
              />
              <Select
                allowClear
                style={{ inlineSize: 170 }}
                placeholder={t('grc:fields.effectiveness')}
                value={filters.effectiveness}
                onChange={(v) => set({ effectiveness: v })}
                options={enumOptions(CONTROL_EFFECTIVENESS, 'effectiveness')}
              />
            </>
          )}
          {type === 'REQUIREMENT' && (
            <Select
              allowClear
              style={{ inlineSize: 160 }}
              placeholder={t('grc:fields.level')}
              value={filters.level}
              onChange={(v) => set({ level: v })}
              options={enumOptions(REQUIREMENT_LEVELS, 'level')}
            />
          )}
          <TreeSelect
            allowClear
            style={{ inlineSize: 200 }}
            placeholder={t('grc:fields.department')}
            treeData={departments}
            value={filters.departmentId}
            onChange={(v: string | undefined) => set({ departmentId: v })}
            treeDefaultExpandAll
          />
          <UserSelect
            allowClear
            style={{ inlineSize: 200 }}
            placeholder={t('grc:fields.owner')}
            value={filters.ownerId}
            onChange={(v) => set({ ownerId: v })}
          />
        </Flex>
        <Flex gap={16} wrap="wrap" align="center" style={{ marginBlockEnd: 12 }}>
          {TOGGLES[type].map((tg) => (
            <Checkbox
              key={tg.key}
              checked={filters[tg.key] === 'true'}
              onChange={(e) => set({ [tg.key]: e.target.checked ? 'true' : null })}
            >
              {t(tg.label)}
            </Checkbox>
          ))}
          {filters.cell && (
            <Tag closable color="blue" onClose={() => set({ cell: null, matrix: null })}>
              {t('grc:filters.cell', {
                likelihood: filters.cell.split(',')[0],
                impact: filters.cell.split(',')[1],
                matrix: t(`grc:matrix.${filters.matrix === 'inherent' ? 'inherent' : 'residual'}`),
              })}
            </Tag>
          )}
          {filters.processId && (
            <Tag closable color="blue" onClose={() => set({ processId: null })}>
              {t('grc:filters.process')}
            </Tag>
          )}
          {hasFilters && (
            <Button
              type="link"
              icon={<CloseCircleOutlined />}
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              {t('grc:filters.clear')}
            </Button>
          )}
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<GrcItemDto>
            rowKey="id"
            columns={columns}
            dataSource={list.data?.items}
            loading={list.isFetching}
            scroll={{ x: 1450 }}
            data-testid={`grc-register-${type}`}
            locale={{ emptyText: <EmptyState description={t(`grc:register.${type}.empty`)} /> }}
            pagination={{
              current: page,
              pageSize,
              total: list.data?.total,
              showTotal: (total) => t('totalItems', { count: total }),
            }}
            onChange={(p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              set({
                page: String(p.current ?? 1),
                pageSize: String(p.pageSize ?? 20),
                sort: s?.order ? String(s.columnKey) : null,
                order: s?.order === 'descend' ? 'desc' : s?.order ? 'asc' : null,
              });
            }}
          />
        )}
      </Card>
      {creating && <GrcFormModal type={type} open onClose={() => setCreating(false)} />}
    </>
  );
}
