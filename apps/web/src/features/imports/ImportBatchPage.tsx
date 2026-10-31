import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popover,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  RollbackOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  IMPORT_ITEM_FILTERS,
  IMPORT_KIND_INFO,
  PERMISSIONS,
  VISIO_SHAPE_TYPES,
  type MigrationProposalKind,
  type ImportBatchDto,
  type ImportItemFilter,
  type ImportItemRecordDto,
  type ImportOptions,
  type ImportPreviewItem,
} from '@processhub/shared';
import {
  useApplyImport,
  useCancelImport,
  useDecideAllSuggestions,
  useDecideImportItem,
  useDiscardImport,
  useImportBatch,
  useImportItems,
  useImportRecords,
  useRunMigrationAi,
  useImportSettings,
  useUndoCheck,
  useUndoImport,
  useUpdateImportOptions,
} from '@/api/imports';
import { apiDownload } from '@/api/client';
import { useAiStatus } from '@/api/ai';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useFormatNumber } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { ImportOptionFields } from './ImportOptionFields';
import { ImportStatusTag } from './import-helpers';
import { formatBytes, useIssueText } from './import-utils';

/** One import batch: progress, mapping, validation report, dry run, apply, result, undo. */
export function ImportBatchPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const batch = useImportBatch(id);
  if (batch.isLoading) return <LoadingState />;
  if (batch.isError || !batch.data)
    return <ErrorState error={batch.error} onRetry={() => void batch.refetch()} />;
  const b = batch.data;
  const running = ['UPLOADED', 'PARSING', 'APPLYING'].includes(b.status);
  const step =
    b.status === 'UPLOADED' || b.status === 'PARSING'
      ? 1
      : b.status === 'READY'
        ? 2
        : b.status === 'APPLYING'
          ? 3
          : b.appliedAt
            ? 4
            : 1;
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('imports:center.title'), to: '/admin/imports' }, { title: b.number }]}
        title={
          <Space>
            {b.number} · {t(`imports:kind.${b.kind}`)}
            <ImportStatusTag status={b.status} />
          </Space>
        }
        subtitle={b.note || undefined}
        extra={<BatchActions b={b} />}
      />
      <Card style={{ marginBlockEnd: 16 }}>
        <Steps
          size="small"
          current={step}
          status={b.status === 'FAILED' ? 'error' : undefined}
          items={[
            { title: t('imports:steps.upload') },
            { title: t('imports:steps.parse') },
            { title: t('imports:steps.preview') },
            { title: t('imports:steps.apply') },
            { title: t('imports:steps.result') },
          ]}
        />
        {running && <RunningJob b={b} />}
        {b.status === 'FAILED' && !b.issues.length && (
          <Alert
            style={{ marginBlockStart: 16 }}
            type="error"
            showIcon
            message={t('imports:batch.failed')}
            description={b.error}
          />
        )}
        {b.status === 'UNDONE' && (
          <Alert
            style={{ marginBlockStart: 16 }}
            type="info"
            showIcon
            message={t('imports:batch.undone', { count: b.result?.undone ?? 0 })}
          />
        )}
        <BatchIssues b={b} />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          {b.summary && <SummaryCard b={b} />}
          {b.status === 'APPLIED' && <AiActionsCard b={b} />}
          {b.appliedAt ? (
            <RecordsCard b={b} />
          ) : (
            b.summary && <PreviewCard b={b} editable={b.status === 'READY'} />
          )}
        </Col>
        <Col xs={24} xl={8}>
          <FilesCard b={b} />
          {IMPORT_KIND_INFO[b.kind].tabular && b.columns.length > 0 && (
            <MappingCard b={b} editable={!b.appliedAt && !running} />
          )}
          {b.kind === 'VISIO' && b.columns.length > 0 && (
            <VisioMappingCard b={b} editable={!b.appliedAt && !running} />
          )}
          {IMPORT_KIND_INFO[b.kind].options.length > 0 && (
            <OptionsCard b={b} editable={!b.appliedAt && !running} />
          )}
        </Col>
      </Row>
    </>
  );
}

/** AI-assisted migration of the batch's items (proposals for review, never applied directly). */
function AiActionsCard({ b }: { b: ImportBatchDto }) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const status = useAiStatus();
  const manager = can(PERMISSIONS.IMPORT_MANAGE);
  const settings = useImportSettings(manager);
  const run = useRunMigrationAi();
  const group = IMPORT_KIND_INFO[b.kind].group;
  // D-164: a separate setting (DOF approval: the text leaves the UAE), off by default.
  if (
    !manager ||
    !status.data?.available ||
    !settings.data?.allowAiOnImportedDocuments ||
    !['DOCUMENTS', 'DIAGRAMS', 'STRUCTURE'].includes(group)
  )
    return null;
  const start = (k: MigrationProposalKind) =>
    modal.confirm({
      title: t('imports:ai.confirmTitle'),
      content: t('imports:ai.confirmText'),
      okText: t('imports:ai.confirmOk'),
      okButtonProps: { 'data-testid': 'import-ai-confirm' } as never,
      onOk: () =>
        run.mutate(
          { kind: k, batchId: b.id, language: 'en', confirmExternal: true },
          {
            onSuccess: (r) => message.success(t('imports:ai.started', { count: r.items })),
            onError: (e) => message.error(errorMessage(e)),
          },
        ),
    });
  const kinds: MigrationProposalKind[] =
    group === 'DOCUMENTS'
      ? [
          'SOP_TO_BPMN',
          ...(can(PERMISSIONS.GRC_PROPOSE) ? (['EXTRACT_GRC'] as const) : []),
          'TRANSLATE',
        ]
      : ['TRANSLATE'];
  return (
    <Card
      size="small"
      title={
        <Space>
          <RobotOutlined />
          {t('imports:ai.title')}
        </Space>
      }
      extra={<Link to={`/admin/imports/ai?batchId=${b.id}`}>{t('imports:ai.queue')}</Link>}
      style={{ marginBlockEnd: 16 }}
      data-testid="import-ai"
    >
      <Typography.Paragraph type="secondary">{t('imports:ai.help')}</Typography.Paragraph>
      <Space wrap>
        {kinds.map((k) => (
          <Button
            key={k}
            loading={run.isPending && run.variables?.kind === k}
            onClick={() => start(k)}
          >
            {t(`imports:ai.run.${k}`)}
          </Button>
        ))}
      </Space>
    </Card>
  );
}

function RunningJob({ b }: { b: ImportBatchDto }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const cancel = useCancelImport();
  return (
    <Flex align="center" gap={16} style={{ marginBlockStart: 16 }} data-testid="import-running">
      <Progress percent={Math.round(b.progress * 100)} status="active" style={{ flex: 1 }} />
      <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
        {b.status === 'APPLYING' ? t('imports:batch.applying') : t('imports:batch.parsing')}
        {b.message ? ` · ${b.message}` : ''}
      </Typography.Text>
      <Button
        icon={<StopOutlined />}
        loading={cancel.isPending}
        onClick={() =>
          cancel.mutate({ id: b.id }, { onError: (e) => message.error(errorMessage(e)) })
        }
      >
        {t('imports:batch.cancel')}
      </Button>
    </Flex>
  );
}

function BatchIssues({ b }: { b: ImportBatchDto }) {
  const issueText = useIssueText();
  if (!b.issues.length) return null;
  return (
    <Flex vertical gap={8} style={{ marginBlockStart: 16 }}>
      {b.issues.map((i, n) => (
        <Alert
          key={n}
          type={i.level === 'ERROR' ? 'error' : 'warning'}
          showIcon
          message={issueText(i)}
          data-testid="import-batch-issue"
        />
      ))}
    </Flex>
  );
}

function BatchActions({ b }: { b: ImportBatchDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const apply = useApplyImport();
  const discard = useDiscardImport();
  const [undoOpen, setUndoOpen] = useState(false);
  const report = async () => {
    try {
      const f = await apiDownload(
        `/imports/${b.id}/report`,
        { query: { locale } },
        `${b.number}.xlsx`,
      );
      downloadBlob(f.blob, f.fileName);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  const canApply =
    b.status === 'READY' &&
    !!b.summary &&
    !b.summary.blocking &&
    b.summary.create + b.summary.update > 0;
  return (
    <>
      {b.summary && (
        <Button
          icon={<DownloadOutlined />}
          onClick={() => void report()}
          data-testid="import-report"
        >
          {b.appliedAt ? t('imports:batch.resultReport') : t('imports:batch.dryRunReport')}
        </Button>
      )}
      {!b.appliedAt && !['PARSING', 'APPLYING'].includes(b.status) && (
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={() =>
            modal.confirm({
              title: t('imports:batch.discardConfirm'),
              okButtonProps: { danger: true },
              onOk: () =>
                discard.mutateAsync({ id: b.id }).then(
                  () => navigate('/admin/imports'),
                  (e) => message.error(errorMessage(e)),
                ),
            })
          }
        >
          {t('imports:batch.discard')}
        </Button>
      )}
      {b.status === 'READY' && (
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          disabled={!canApply}
          loading={apply.isPending}
          data-testid="import-apply"
          onClick={() =>
            modal.confirm({
              title: t('imports:batch.applyConfirm'),
              content: t('imports:batch.applyConfirmText', {
                create: b.summary?.create ?? 0,
                update: b.summary?.update ?? 0,
              }),
              okButtonProps: { 'data-testid': 'import-apply-ok' } as never,
              onOk: () =>
                apply.mutateAsync({ id: b.id }).catch((e) => message.error(errorMessage(e))),
            })
          }
        >
          {t('imports:batch.apply')}
        </Button>
      )}
      {b.canUndo && (
        <Button
          icon={<RollbackOutlined />}
          onClick={() => setUndoOpen(true)}
          data-testid="import-undo"
        >
          {t('imports:batch.undo')}
        </Button>
      )}
      {undoOpen && <UndoModal b={b} onClose={() => setUndoOpen(false)} />}
    </>
  );
}

function UndoModal({ b, onClose }: { b: ImportBatchDto; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const check = useUndoCheck(b.id, true);
  const undo = useUndoImport();
  const blockers = check.data?.blockers ?? [];
  return (
    <Modal
      open
      title={t('imports:undo.title', { number: b.number })}
      okText={t('imports:undo.ok')}
      okButtonProps={
        { danger: true, disabled: !check.data?.canUndo, 'data-testid': 'import-undo-ok' } as never
      }
      confirmLoading={undo.isPending}
      onCancel={onClose}
      onOk={() =>
        undo.mutate(
          { id: b.id },
          {
            onSuccess: () => {
              message.success(t('imports:undo.done'));
              onClose();
            },
            onError: (e) => message.error(errorMessage(e)),
          },
        )
      }
    >
      {check.isLoading ? (
        <LoadingState />
      ) : blockers.length ? (
        <>
          <Alert type="warning" showIcon message={t('imports:undo.blocked')} />
          <List
            size="small"
            dataSource={blockers}
            renderItem={(x) => (
              <List.Item>
                <Space>
                  <Tag>{t(`imports:entity.${x.entity}`)}</Tag>
                  {x.key} {x.nameEn || x.nameAr}
                  <Typography.Text type="secondary">
                    {t(`imports:undo.reason.${x.reason}`)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </>
      ) : (
        <Typography.Paragraph>
          {t('imports:undo.text', { count: check.data?.items ?? 0 })}
        </Typography.Paragraph>
      )}
    </Modal>
  );
}

function SummaryCard({ b }: { b: ImportBatchDto }) {
  const { t } = useTranslation();
  const s = b.summary!;
  const r = b.result;
  return (
    <Card
      size="small"
      title={b.appliedAt ? t('imports:summary.result') : t('imports:summary.dryRun')}
      style={{ marginBlockEnd: 16 }}
      data-testid="import-summary"
    >
      <Row gutter={16}>
        {r ? (
          <>
            <Col span={6}>
              <Statistic title={t('imports:summary.created')} value={r.created} />
            </Col>
            <Col span={6}>
              <Statistic title={t('imports:summary.updated')} value={r.updated} />
            </Col>
            <Col span={6}>
              <Statistic
                title={t('imports:summary.failed')}
                value={r.failed}
                valueStyle={r.failed ? { color: 'var(--ant-color-error)' } : undefined}
              />
            </Col>
            <Col span={6}>
              <Statistic title={t('imports:summary.undone')} value={r.undone} />
            </Col>
            {r.module && (
              <Col span={24}>
                <Typography.Text type="secondary">
                  {t('imports:summary.module', r.module)}
                </Typography.Text>
              </Col>
            )}
          </>
        ) : (
          <>
            <Col span={4}>
              <Statistic title={t('imports:summary.create')} value={s.create} />
            </Col>
            <Col span={4}>
              <Statistic title={t('imports:summary.update')} value={s.update} />
            </Col>
            <Col span={4}>
              <Statistic title={t('imports:summary.skip')} value={s.skip} />
            </Col>
            <Col span={4}>
              <Statistic
                title={t('imports:summary.errors')}
                value={s.errors}
                valueStyle={s.errors ? { color: 'var(--ant-color-error)' } : undefined}
              />
            </Col>
            <Col span={4}>
              <Statistic
                title={t('imports:summary.warnings')}
                value={s.warnings}
                valueStyle={s.warnings ? { color: 'var(--ant-color-warning)' } : undefined}
              />
            </Col>
            <Col span={4}>
              <Statistic title={t('imports:summary.suggestions')} value={s.suggestions} />
            </Col>
          </>
        )}
      </Row>
      {!r && s.blocking > 0 && (
        <Alert
          style={{ marginBlockStart: 12 }}
          type="error"
          showIcon
          message={t('imports:summary.blocking', { count: s.blocking })}
        />
      )}
    </Card>
  );
}

function PreviewCard({ b, editable }: { b: ImportBatchDto; editable: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const issueText = useIssueText();
  const [filter, setFilter] = useState<ImportItemFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const items = useImportItems(b.id, { filter, q, page, pageSize: 50 });
  const decide = useDecideImportItem();
  const decideAll = useDecideAllSuggestions();
  const onErr = (e: unknown) => message.error(errorMessage(e));
  return (
    <Card
      size="small"
      title={t('imports:preview.title')}
      extra={
        editable &&
        (b.summary?.suggestions ?? 0) > 0 && (
          <Space>
            <Button
              size="small"
              onClick={() => decideAll.mutate({ id: b.id, accepted: true }, { onError: onErr })}
            >
              {t('imports:preview.acceptAll')}
            </Button>
            <Button
              size="small"
              onClick={() => decideAll.mutate({ id: b.id, accepted: false }, { onError: onErr })}
            >
              {t('imports:preview.rejectAll')}
            </Button>
          </Space>
        )
      }
    >
      <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 12 }}>
        <Segmented<ImportItemFilter>
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={IMPORT_ITEM_FILTERS.map((f) => ({ value: f, label: t(`imports:filter.${f}`) }))}
          data-testid="import-filter"
        />
        <Input.Search
          allowClear
          placeholder={t('imports:preview.search')}
          style={{ width: 220 }}
          onSearch={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
      </Flex>
      <Table<ImportPreviewItem>
        rowKey="ref"
        size="small"
        data-testid="import-items"
        loading={items.isLoading}
        dataSource={items.data?.items ?? []}
        scroll={{ x: 1240 }}
        pagination={{
          current: page,
          pageSize: 50,
          total: items.data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: t('imports:preview.include'),
            width: 80,
            render: (_, i) => (
              <Switch
                size="small"
                checked={!i.skip}
                disabled={!editable || i.action === 'SKIP'}
                onChange={(on) =>
                  decide.mutate(
                    { id: b.id, ref: i.ref, decision: { skip: !on } },
                    { onError: onErr },
                  )
                }
              />
            ),
          },
          {
            title: t('imports:preview.action'),
            width: 110,
            render: (_, i) => <ActionTag item={i} />,
          },
          {
            title: t('imports:fields.name'),
            width: 280,
            render: (_, i) => (
              <Flex vertical>
                {i.nameEn && <span>{i.nameEn}</span>}
                {i.nameAr && <span dir="rtl">{i.nameAr}</span>}
                {i.facts && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {Object.entries(i.facts)
                      .map(([k, v]) => `${t(`imports:fact.${k}`)}: ${v}`)
                      .join(' · ')}
                  </Typography.Text>
                )}
              </Flex>
            ),
          },
          {
            title: t('imports:preview.issues'),
            width: 300,
            render: (_, i) => (
              <Flex vertical gap={4}>
                {i.issues.map((x, n) => (
                  <Typography.Text key={n} type={x.level === 'ERROR' ? 'danger' : 'warning'}>
                    {issueText(x)}
                  </Typography.Text>
                ))}
                {i.changes.length > 0 && <ChangesPopover item={i} />}
                {i.suggestions.length > 0 && (
                  <SuggestionsPopover
                    item={i}
                    editable={editable}
                    onToggle={(sid, accepted) =>
                      decide.mutate(
                        { id: b.id, ref: i.ref, decision: { suggestions: { [sid]: accepted } } },
                        { onError: onErr },
                      )
                    }
                  />
                )}
              </Flex>
            ),
          },
          {
            title: t('imports:fields.entity'),
            width: 120,
            render: (_, i) => t(`imports:entity.${i.entity}`),
          },
          { title: t('imports:fields.key'), dataIndex: 'key', width: 160, ellipsis: true },
          { title: t('imports:fields.source'), dataIndex: 'source', width: 160, ellipsis: true },
        ]}
      />
    </Card>
  );
}

function ActionTag({ item }: { item: ImportPreviewItem }) {
  const { t } = useTranslation();
  if (item.skip || item.action === 'SKIP') return <Tag>{t('imports:action.SKIP')}</Tag>;
  if (item.issues.some((i) => i.level === 'ERROR'))
    return <Tag color="error">{t('imports:action.ERROR')}</Tag>;
  return (
    <Tag color={item.action === 'CREATE' ? 'green' : 'blue'}>
      {t(`imports:action.${item.action}`)}
      {item.matchBy ? ` · ${t(`imports:matchBy.${item.matchBy}`)}` : ''}
    </Tag>
  );
}

function ChangesPopover({ item }: { item: ImportPreviewItem }) {
  const { t } = useTranslation();
  return (
    <Popover
      title={t('imports:preview.changes')}
      content={
        <Descriptions size="small" column={1} style={{ maxWidth: 420 }}>
          {item.changes.map((c) => (
            <Descriptions.Item key={c.field} label={t(`imports:field.${c.field}`, c.field)}>
              <Typography.Text delete type="secondary">
                {String(c.from ?? '—')}
              </Typography.Text>{' '}
              → {String(c.to ?? '—')}
            </Descriptions.Item>
          ))}
        </Descriptions>
      }
    >
      <Typography.Link>
        {t('imports:preview.changesCount', { count: item.changes.length })}
      </Typography.Link>
    </Popover>
  );
}

function SuggestionsPopover({
  item,
  editable,
  onToggle,
}: {
  item: ImportPreviewItem;
  editable: boolean;
  onToggle: (id: string, accepted: boolean) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const accepted = item.suggestions.filter((s) => s.accepted).length;
  return (
    <Popover
      trigger="click"
      title={t('imports:preview.suggestions')}
      content={
        <List
          size="small"
          style={{ maxWidth: 480, maxHeight: 360, overflow: 'auto' }}
          dataSource={item.suggestions}
          renderItem={(s) => (
            <List.Item
              actions={
                editable
                  ? [
                      <Checkbox
                        key="a"
                        checked={s.accepted}
                        onChange={(e) => onToggle(s.id, e.target.checked)}
                        data-testid="import-suggestion"
                      >
                        {t('imports:preview.accept')}
                      </Checkbox>,
                    ]
                  : undefined
              }
            >
              <Space wrap>
                <Tag>{t(`imports:suggestion.${s.kind}`)}</Tag>
                <Typography.Text>{s.source}</Typography.Text>→
                <Typography.Text strong>
                  {(locale === 'ar' ? s.targetLabelAr : s.targetLabelEn) ||
                    s.targetLabelEn ||
                    s.targetLabelAr}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      }
    >
      <Typography.Link>
        {accepted ? <CheckOutlined /> : <CloseOutlined />}{' '}
        {t('imports:preview.suggestionCount', { count: item.suggestions.length, accepted })}
      </Typography.Link>
    </Popover>
  );
}

function RecordsCard({ b }: { b: ImportBatchDto }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  // The status is part of the key: the list refreshes while the apply job runs and when it ends.
  const records = useImportRecords(b.id, {
    page,
    pageSize: 50,
    status: b.status,
    done: b.result?.created ?? 0,
  });
  return (
    <Card size="small" title={t('imports:records.title')}>
      <Table<ImportItemRecordDto>
        rowKey="id"
        size="small"
        data-testid="import-records"
        loading={records.isLoading}
        dataSource={records.data?.items ?? []}
        scroll={{ x: 800 }}
        pagination={{
          current: page,
          pageSize: 50,
          total: records.data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: t('imports:fields.outcome'),
            width: 110,
            render: (_, r) => (
              <Tag
                color={
                  r.outcome === 'CREATED'
                    ? 'green'
                    : r.outcome === 'UPDATED'
                      ? 'blue'
                      : r.outcome === 'FAILED'
                        ? 'error'
                        : 'default'
                }
              >
                {t(`imports:outcome.${r.outcome}`)}
              </Tag>
            ),
          },
          {
            title: t('imports:fields.entity'),
            width: 120,
            render: (_, r) => t(`imports:entity.${r.entity}`),
          },
          { title: t('imports:fields.key'), dataIndex: 'key', width: 150, ellipsis: true },
          {
            title: t('imports:fields.name'),
            render: (_, r) => {
              const name = [r.nameEn, r.nameAr].filter(Boolean).join(' · ') || r.key;
              return r.href ? <Link to={r.href}>{name}</Link> : name;
            },
          },
          {
            title: t('imports:records.details'),
            width: 260,
            render: (_, r) =>
              r.error ? (
                <Typography.Text type="danger">{r.error}</Typography.Text>
              ) : r.before ? (
                <Popover
                  content={
                    <pre style={{ maxWidth: 480, maxHeight: 320, overflow: 'auto', margin: 0 }}>
                      {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                    </pre>
                  }
                >
                  <Typography.Link>{t('imports:records.beforeAfter')}</Typography.Link>
                </Popover>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

function FilesCard({ b }: { b: ImportBatchDto }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const formatNumber = useFormatNumber();
  const download = async (fileId: string, name: string) => {
    try {
      const f = await apiDownload(`/imports/${b.id}/files/${fileId}`, {}, name);
      downloadBlob(f.blob, name);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  return (
    <Card size="small" title={t('imports:batch.files')} style={{ marginBlockEnd: 16 }}>
      <List
        size="small"
        dataSource={b.files}
        renderItem={(f) => (
          <List.Item
            actions={[
              <Button
                key="d"
                size="small"
                type="text"
                icon={<DownloadOutlined />}
                aria-label={t('imports:batch.download')}
                onClick={() => void download(f.id, f.fileName)}
              />,
            ]}
          >
            <Typography.Text ellipsis style={{ maxWidth: 260 }}>
              {f.fileName}
            </Typography.Text>
            <Typography.Text type="secondary"> {formatBytes(f.size)}</Typography.Text>
          </List.Item>
        )}
      />
      <Descriptions size="small" column={1} style={{ marginBlockStart: 8 }}>
        <Descriptions.Item label={t('imports:fields.createdAt')}>
          {formatDate(b.createdAt)}
        </Descriptions.Item>
        {b.appliedAt && (
          <Descriptions.Item label={t('imports:fields.appliedAt')}>
            {formatDate(b.appliedAt)}
          </Descriptions.Item>
        )}
        {b.summary && (
          <Descriptions.Item label={t('imports:fields.items')}>
            {formatNumber(b.summary.items)}
          </Descriptions.Item>
        )}
      </Descriptions>
    </Card>
  );
}

/** Column mapping of a tabular file: detected headers → fields; changes rebuild the preview. */
function MappingCard({ b, editable }: { b: ImportBatchDto; editable: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const update = useUpdateImportOptions();
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
    Object.fromEntries(b.columns.filter((c) => c.field).map((c) => [c.field!, c.header])),
  );
  return (
    <Card
      size="small"
      title={t('imports:mapping.title')}
      style={{ marginBlockEnd: 16 }}
      data-testid="import-mapping"
      extra={
        editable && (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { id: b.id, options: { ...b.options, mapping } },
                { onError: (e) => message.error(errorMessage(e)) },
              )
            }
          >
            {t('imports:mapping.rebuild')}
          </Button>
        )
      }
    >
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={b.fields}
        columns={[
          {
            title: t('imports:mapping.field'),
            render: (_, f) => (
              <Space>
                {t(`imports:field.${f.key}`, f.key)}
                {f.required && <Typography.Text type="danger">*</Typography.Text>}
              </Space>
            ),
          },
          {
            title: t('imports:mapping.column'),
            render: (_, f) => (
              <Select
                size="small"
                allowClear
                disabled={!editable}
                style={{ width: 180 }}
                value={mapping[f.key] || undefined}
                onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v ?? '' }))}
                options={b.columns.map((c) => ({
                  value: c.header,
                  label: c.sample ? `${c.header} (${c.sample})` : c.header,
                }))}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}

/** Visio shape mapping: master name → BPMN type (defaults + this batch's overrides). */
function VisioMappingCard({ b, editable }: { b: ImportBatchDto; editable: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const update = useUpdateImportOptions();
  const [mapping, setMapping] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(b.columns.map((c) => [c.header, c.field ?? ''])),
  }));
  return (
    <Card
      size="small"
      title={t('imports:visio.title')}
      style={{ marginBlockEnd: 16 }}
      data-testid="visio-mapping"
      extra={
        editable && (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                {
                  id: b.id,
                  options: {
                    ...b.options,
                    shapeMapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
                  },
                },
                { onError: (e) => message.error(errorMessage(e)) },
              )
            }
          >
            {t('imports:mapping.rebuild')}
          </Button>
        )
      }
    >
      <Table
        size="small"
        rowKey="header"
        pagination={false}
        dataSource={b.columns}
        columns={[
          { title: t('imports:visio.master'), dataIndex: 'header' },
          { title: t('imports:visio.count'), dataIndex: 'sample', width: 70, align: 'end' },
          {
            title: t('imports:visio.type'),
            render: (_, c) => (
              <Select
                size="small"
                allowClear
                disabled={!editable}
                style={{ width: 170 }}
                status={mapping[c.header] ? undefined : 'warning'}
                placeholder={t('imports:visio.unmapped')}
                value={mapping[c.header] || undefined}
                onChange={(v) => setMapping((m) => ({ ...m, [c.header]: v ?? '' }))}
                options={VISIO_SHAPE_TYPES.map((v) => ({
                  value: v,
                  label: t(`imports:visioType.${v}`),
                }))}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}

function OptionsCard({ b, editable }: { b: ImportBatchDto; editable: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const update = useUpdateImportOptions();
  const [form] = Form.useForm<ImportOptions>();
  return (
    <Card size="small" title={t('imports:batch.options')}>
      <Form
        form={form}
        layout="vertical"
        size="small"
        disabled={!editable}
        initialValues={b.options}
        onFinish={(values) =>
          update.mutate(
            {
              id: b.id,
              options: {
                ...b.options,
                ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)),
              },
            },
            { onError: (e) => message.error(errorMessage(e)) },
          )
        }
      >
        <ImportOptionFields info={IMPORT_KIND_INFO[b.kind]} />
        {editable && (
          <Button htmlType="submit" icon={<ReloadOutlined />} loading={update.isPending}>
            {t('imports:batch.rebuild')}
          </Button>
        )}
      </Form>
    </Card>
  );
}
