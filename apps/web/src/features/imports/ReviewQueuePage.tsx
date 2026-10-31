import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Input,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  BgColorsOutlined,
  CheckCircleOutlined,
  SendOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  MIGRATION_ITEM_TYPES,
  MIGRATION_PROBLEMS,
  PROCESS_STATUSES,
  type MigrationBulkAction,
  type MigrationBulkResultDto,
  type MigrationItemDto,
} from '@processhub/shared';
import { useMigrationBulk, useMigrationItems } from '@/api/imports';
import { PageHeader } from '@/components/PageHeader';
import { StatusTag } from '@/components/tags';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';

type Key = `${MigrationItemDto['type']}:${string}`;

/**
 * Review queue of imported content (M15 step 6): filter by type, status, problem, department,
 * branch or batch; bulk assign owner, apply the colour theme, validate and submit for review.
 */
export function ReviewQueuePage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const q = {
    scope: params.get('scope') ?? 'IMPORTED',
    page: Number(params.get('page') ?? 1),
    pageSize: 50,
    type: params.get('type'),
    status: params.get('status'),
    problem: params.get('problem'),
    departmentId: params.get('departmentId'),
    branchId: params.get('branchId'),
    batchId: params.get('batchId'),
    q: params.get('q'),
  };
  const list = useMigrationItems(q);
  const bulk = useMigrationBulk();
  const [selected, setSelected] = useState<Key[]>([]);
  const [action, setAction] = useState<MigrationBulkAction | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<MigrationBulkResultDto | null>(null);
  const set = (k: string, v?: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
    setSelected([]);
  };
  const items = selected.map((k) => {
    const [type, id] = k.split(':') as [MigrationItemDto['type'], string];
    return { type, id };
  });
  const runAction = (a: MigrationBulkAction) =>
    bulk.mutate(
      { action: a, items, ownerId: ownerId ?? undefined, note: note || undefined },
      {
        onSuccess: (r) => {
          setAction(null);
          setResult(r);
          message.success(t('imports:review.done', { count: r.done }));
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  const filter = (k: string, values: readonly string[], prefix: string, width = 170) => (
    <Select
      allowClear
      style={{ width }}
      placeholder={t(`imports:review.filter.${k}`)}
      value={(q as unknown as Record<string, string | null>)[k] ?? undefined}
      onChange={(v) => set(k, v)}
      options={values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }))}
    />
  );
  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('imports:center.title'), to: '/admin/imports' },
          { title: t('imports:dashboard.title'), to: '/admin/imports/dashboard' },
          { title: t('imports:review.title') },
        ]}
        title={t('imports:review.title')}
        subtitle={t('imports:review.subtitle')}
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 12 }}>
          {filter('type', MIGRATION_ITEM_TYPES, 'imports:entity')}
          {filter('status', PROCESS_STATUSES, 'processes:status')}
          {filter('problem', MIGRATION_PROBLEMS, 'imports:problem', 200)}
          <Select
            style={{ width: 150 }}
            value={q.scope}
            onChange={(v) => set('scope', v)}
            options={['IMPORTED', 'ALL'].map((v) => ({
              value: v,
              label: t(`imports:dashboard.scope.${v}`),
            }))}
          />
          <Input.Search
            allowClear
            style={{ width: 220 }}
            defaultValue={q.q ?? undefined}
            placeholder={t('imports:preview.search')}
            onSearch={(v) => set('q', v)}
          />
          {(q.departmentId || q.branchId || q.batchId) && (
            <Button
              onClick={() => {
                set('departmentId');
                set('branchId');
                set('batchId');
              }}
            >
              {t('imports:review.clearGroup')}
            </Button>
          )}
        </Flex>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 12 }} data-testid="review-actions">
          <Typography.Text type="secondary">
            {t('imports:review.selected', { count: selected.length })}
          </Typography.Text>
          <Button
            disabled={!selected.length}
            icon={<UserSwitchOutlined />}
            onClick={() => setAction('ASSIGN_OWNER')}
          >
            {t('imports:review.action.ASSIGN_OWNER')}
          </Button>
          <Button
            disabled={!selected.length}
            icon={<BgColorsOutlined />}
            onClick={() => runAction('APPLY_THEME')}
            loading={bulk.isPending && bulk.variables?.action === 'APPLY_THEME'}
          >
            {t('imports:review.action.APPLY_THEME')}
          </Button>
          <Button
            disabled={!selected.length}
            icon={<CheckCircleOutlined />}
            onClick={() => runAction('VALIDATE')}
            loading={bulk.isPending && bulk.variables?.action === 'VALIDATE'}
            data-testid="review-validate"
          >
            {t('imports:review.action.VALIDATE')}
          </Button>
          <Button
            type="primary"
            disabled={!selected.length}
            icon={<SendOutlined />}
            onClick={() => setAction('SUBMIT')}
          >
            {t('imports:review.action.SUBMIT')}
          </Button>
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<MigrationItemDto>
            rowKey={(i) => `${i.type}:${i.id}`}
            size="small"
            data-testid="review-items"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            scroll={{ x: 1000 }}
            locale={{ emptyText: <EmptyState description={t('imports:review.empty')} /> }}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as Key[]),
            }}
            pagination={{
              current: q.page,
              pageSize: 50,
              total: list.data?.total ?? 0,
              showSizeChanger: false,
              onChange: (page) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                setParams(next, { replace: true });
              },
            }}
            columns={[
              {
                title: t('imports:fields.entity'),
                width: 110,
                render: (_, i) => t(`imports:entity.${i.type}`),
              },
              { title: t('imports:fields.key'), dataIndex: 'code', width: 110 },
              {
                title: t('imports:fields.name'),
                render: (_, i) => <Link to={i.href}>{loc(i) || '—'}</Link>,
              },
              {
                title: t('imports:fields.status'),
                width: 120,
                render: (_, i) => <StatusTag status={i.status as never} />,
              },
              {
                title: t('imports:review.owner'),
                width: 160,
                render: (_, i) => (i.owner ? loc(i.owner) : '—'),
              },
              {
                title: t('imports:review.problems'),
                width: 260,
                render: (_, i) => (
                  <Space size={4} wrap>
                    {i.problems.map((p) => (
                      <Tag key={p} color="orange">
                        {t(`imports:problem.${p}`)}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
              {
                title: t('imports:fields.number'),
                width: 100,
                render: (_, i) =>
                  i.batch ? <Link to={`/admin/imports/${i.batch.id}`}>{i.batch.number}</Link> : '—',
              },
              {
                title: t('imports:review.updated'),
                width: 170,
                render: (_, i) => formatDate(i.updatedAt),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        open={action === 'ASSIGN_OWNER'}
        title={t('imports:review.action.ASSIGN_OWNER')}
        okButtonProps={{ disabled: !ownerId }}
        confirmLoading={bulk.isPending}
        onCancel={() => setAction(null)}
        onOk={() => runAction('ASSIGN_OWNER')}
      >
        <UserSelect value={ownerId} onChange={setOwnerId} style={{ width: '100%' }} />
      </Modal>
      <Modal
        open={action === 'SUBMIT'}
        title={t('imports:review.action.SUBMIT')}
        confirmLoading={bulk.isPending}
        onCancel={() => setAction(null)}
        onOk={() => runAction('SUBMIT')}
      >
        <Typography.Paragraph type="secondary">
          {t('imports:review.submitHelp', { count: selected.length })}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('imports:review.note')}
        />
      </Modal>
      <Modal
        open={!!result}
        footer={null}
        onCancel={() => setResult(null)}
        title={result ? t(`imports:review.action.${result.action}`) : ''}
      >
        {result && (
          <Flex vertical gap={8} data-testid="review-result">
            <Alert
              type={result.failed.length ? 'warning' : 'success'}
              showIcon
              message={t('imports:review.result', {
                done: result.done,
                failed: result.failed.length,
                unchanged: result.unchanged,
              })}
            />
            {[...result.failed.map((f) => ({ ...f, problems: [f.code] })), ...result.issues]
              .length > 0 && (
              <List
                size="small"
                dataSource={[
                  ...result.failed.map((f) => ({ ...f, problems: [f.code] })),
                  ...result.issues,
                ]}
                renderItem={(r) => {
                  const item = list.data?.items.find((i) => i.id === r.id);
                  return (
                    <List.Item>
                      <Space wrap>
                        <Typography.Text strong>
                          {item ? loc(item) || item.code : r.id}
                        </Typography.Text>
                        {r.problems.map((p) => (
                          <Tag key={p} color="red">
                            {t(`imports:problem.${p.split(':')[0]}`, {
                              defaultValue: t(`errors:${p}`, p),
                            })}
                            {p.includes(':') ? ` · ${p.split(':')[1]}` : ''}
                          </Tag>
                        ))}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            )}
          </Flex>
        )}
      </Modal>
    </>
  );
}
