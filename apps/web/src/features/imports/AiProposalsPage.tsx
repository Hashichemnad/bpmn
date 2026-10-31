import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Flex,
  List,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckOutlined, CloseOutlined, RobotOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  MIGRATION_PROPOSAL_KINDS,
  MIGRATION_PROPOSAL_STATUSES,
  type MigrationProposalDto,
  type MigrationProposalPayload,
} from '@processhub/shared';
import { useDecideProposal, useProposal, useProposals } from '@/api/imports';
import { usePage } from '@/api/docs';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import { RichTextView } from '@/features/docs/RichTextView';
import { ProcessTreeSelect } from './import-helpers';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'processing',
  ACCEPTED: 'success',
  REJECTED: 'default',
  FAILED: 'error',
};

export function ProposalStatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Tag color={STATUS_COLOR[status]}>{t(`imports:ai.status.${status}`)}</Tag>;
}

/** Review queue of AI proposals (M15 step 5): nothing is applied without a person accepting it. */
export function AiProposalsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const [params, setParams] = useSearchParams();
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: 20,
    kind: params.get('kind'),
    status: params.get('status') ?? 'PENDING',
    batchId: params.get('batchId'),
  };
  const list = useProposals(q);
  const set = (k: string, v?: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('imports:center.title'), to: '/admin/imports' },
          { title: t('imports:ai.queue') },
        ]}
        title={t('imports:ai.queue')}
        subtitle={t('imports:ai.queueHelp')}
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Select
            allowClear
            style={{ width: 240 }}
            placeholder={t('imports:fields.kind')}
            value={q.kind ?? undefined}
            onChange={(v) => set('kind', v)}
            options={MIGRATION_PROPOSAL_KINDS.map((k) => ({
              value: k,
              label: t(`imports:ai.kind.${k}`),
            }))}
          />
          <Select
            style={{ width: 180 }}
            value={q.status}
            onChange={(v) => set('status', v)}
            options={MIGRATION_PROPOSAL_STATUSES.map((s) => ({
              value: s,
              label: t(`imports:ai.status.${s}`),
            }))}
          />
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<MigrationProposalDto>
            rowKey="id"
            data-testid="ai-proposals"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            locale={{ emptyText: <EmptyState description={t('imports:ai.empty')} /> }}
            onRow={(p) => ({ onDoubleClick: () => navigate(`/admin/imports/ai/${p.id}`) })}
            pagination={{
              current: q.page,
              pageSize: 20,
              total: list.data?.total ?? 0,
              onChange: (page) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                setParams(next, { replace: true });
              },
            }}
            columns={[
              {
                title: t('imports:fields.kind'),
                width: 200,
                render: (_, p) => t(`imports:ai.kind.${p.kind}`),
              },
              {
                title: t('imports:fields.name'),
                render: (_, p) => (
                  <Link to={`/admin/imports/ai/${p.id}`}>
                    {loc(p, 'title') || t(`imports:entity.${p.sourceType}`)}
                  </Link>
                ),
              },
              {
                title: t('imports:fields.status'),
                width: 130,
                render: (_, p) => <ProposalStatusTag status={p.status} />,
              },
              {
                title: t('imports:fields.outcome'),
                render: (_, p) =>
                  p.error ? (
                    <Typography.Text type="danger">
                      {t(`errors:${p.error}`, p.error)}
                    </Typography.Text>
                  ) : p.resultHref ? (
                    <Link to={p.resultHref}>{t('imports:ai.openResult')}</Link>
                  ) : null,
              },
              {
                title: t('imports:fields.createdAt'),
                width: 180,
                render: (_, p) => formatDate(p.createdAt),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}

/** One proposal, side by side: the source document and what the assistant proposes. */
export function AiProposalPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const proposal = useProposal(id);
  const decide = useDecideProposal();
  const [target, setTarget] = useState<'new' | 'suggested'>('new');
  const [parent, setParent] = useState<string | null>(null);
  const [risks, setRisks] = useState<number[] | null>(null);
  const [controls, setControls] = useState<number[] | null>(null);
  if (proposal.isLoading) return <LoadingState />;
  if (proposal.isError || !proposal.data)
    return <ErrorState error={proposal.error} onRetry={() => void proposal.refetch()} />;
  const p = proposal.data;
  const payload = p.payload;
  const pending = p.status === 'PENDING';
  const act = (accept: boolean) =>
    decide.mutate(
      {
        id: p.id,
        accept,
        body: accept
          ? payload?.kind === 'SOP_TO_BPMN'
            ? {
                processId: target === 'suggested' ? payload.suggestedProcessId : null,
                parentProcessId: parent,
              }
            : payload?.kind === 'EXTRACT_GRC'
              ? {
                  risks: risks ?? payload.risks.map((_, i) => i),
                  controls: controls ?? payload.controls.map((_, i) => i),
                }
              : {}
          : undefined,
      },
      {
        onSuccess: (r) => {
          message.success(t(accept ? 'imports:ai.accepted' : 'imports:ai.rejected'));
          if (accept && r.resultHref) navigate(r.resultHref);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('imports:center.title'), to: '/admin/imports' },
          { title: t('imports:ai.queue'), to: '/admin/imports/ai' },
          { title: loc(p, 'title') || '—' },
        ]}
        title={
          <Space>
            <RobotOutlined />
            {t(`imports:ai.kind.${p.kind}`)}: {loc(p, 'title')}
            <ProposalStatusTag status={p.status} />
          </Space>
        }
        extra={
          pending &&
          payload && (
            <>
              <Button
                icon={<CloseOutlined />}
                onClick={() => act(false)}
                loading={decide.isPending}
              >
                {t('imports:ai.reject')}
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => act(true)}
                loading={decide.isPending}
                data-testid="ai-accept"
              >
                {t('imports:ai.accept')}
              </Button>
            </>
          )
        }
      />
      <Alert type="info" showIcon message={t('imports:ai.notice')} style={{ marginBlockEnd: 16 }} />
      {p.error && (
        <Alert
          type="error"
          showIcon
          message={t(`errors:${p.error}`, p.error)}
          style={{ marginBlockEnd: 16 }}
        />
      )}
      <Row gutter={16}>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title={t('imports:ai.source')}
            extra={p.sourceHref && <Link to={p.sourceHref}>{t('imports:ai.open')}</Link>}
          >
            {p.sourceType === 'PAGE' ? (
              <SourcePage id={p.sourceId} />
            ) : (
              <Typography.Text>{loc(p, 'title')}</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title={t('imports:ai.proposal')}>
            {!payload ? (
              <Empty />
            ) : (
              <ProposalBody
                payload={payload}
                editable={pending}
                target={target}
                setTarget={setTarget}
                parent={parent}
                setParent={setParent}
                risks={risks}
                setRisks={setRisks}
                controls={controls}
                setControls={setControls}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

function SourcePage({ id }: { id: string }) {
  const page = usePage(id);
  const { locale } = useLocale();
  if (page.isLoading) return <LoadingState />;
  if (!page.data) return null;
  const ar = locale === 'ar' ? !!page.data.contentAr || !page.data.contentEn : !page.data.contentEn;
  return (
    <div style={{ maxHeight: 640, overflow: 'auto' }} data-testid="ai-source">
      <RichTextView
        html={ar ? page.data.contentAr : page.data.contentEn}
        dir={ar ? page.data.dirAr : page.data.dirEn}
        lang={ar ? 'ar' : 'en'}
      />
    </div>
  );
}

function ProposalBody(props: {
  payload: MigrationProposalPayload;
  editable: boolean;
  target: 'new' | 'suggested';
  setTarget: (v: 'new' | 'suggested') => void;
  parent: string | null;
  setParent: (v: string | null) => void;
  risks: number[] | null;
  setRisks: (v: number[]) => void;
  controls: number[] | null;
  setControls: (v: number[]) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const p = props.payload;
  const name = (x: { nameEn: string; nameAr: string }) =>
    (locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) || '—';
  if (p.kind === 'SOP_TO_BPMN')
    return (
      <Flex vertical gap={12}>
        <Typography.Text strong>{name(p)}</Typography.Text>
        <div
          style={{ height: 420, border: '1px solid var(--ant-color-border)' }}
          data-testid="ai-diagram"
        >
          <DiagramCanvas xml={p.bpmnXml} />
        </div>
        {p.explanation && (
          <Typography.Paragraph type="secondary">{p.explanation}</Typography.Paragraph>
        )}
        {p.warnings.map((w) => (
          <Typography.Text key={w} type="warning">
            {w}
          </Typography.Text>
        ))}
        {props.editable && (
          <>
            <Radio.Group value={props.target} onChange={(e) => props.setTarget(e.target.value)}>
              <Radio value="new">{t('imports:ai.newProcess')}</Radio>
              {p.suggestedProcessId && (
                <Radio value="suggested">{t('imports:ai.linkedProcess')}</Radio>
              )}
            </Radio.Group>
            {props.target === 'new' && (
              <ProcessTreeSelect
                value={props.parent}
                onChange={props.setParent}
                placeholder={t('imports:option.parentProcessId')}
              />
            )}
          </>
        )}
      </Flex>
    );
  if (p.kind === 'EXTRACT_GRC') {
    const pick = (
      list: number[] | null,
      all: number,
      set: (v: number[]) => void,
      i: number,
      on: boolean,
    ) => {
      const cur = list ?? Array.from({ length: all }, (_, n) => n);
      set(on ? [...cur, i] : cur.filter((x) => x !== i));
    };
    const section = (
      title: string,
      items: {
        nameEn: string;
        nameAr: string;
        quote: string;
        descriptionEn: string;
        descriptionAr: string;
      }[],
      sel: number[] | null,
      set: (v: number[]) => void,
    ) => (
      <List
        size="small"
        header={<Typography.Text strong>{title}</Typography.Text>}
        dataSource={items}
        renderItem={(x, i) => (
          <List.Item>
            <Flex gap={8} align="start">
              <Checkbox
                disabled={!props.editable}
                checked={(sel ?? items.map((_, n) => n)).includes(i)}
                onChange={(e) => pick(sel, items.length, set, i, e.target.checked)}
              />
              <Flex vertical>
                <Typography.Text strong>{name(x)}</Typography.Text>
                <Typography.Text type="secondary">
                  {locale === 'ar'
                    ? x.descriptionAr || x.descriptionEn
                    : x.descriptionEn || x.descriptionAr}
                </Typography.Text>
                {x.quote && <Typography.Text italic>“{x.quote}”</Typography.Text>}
              </Flex>
            </Flex>
          </List.Item>
        )}
      />
    );
    return (
      <Flex vertical gap={12}>
        {section(t('imports:ai.risks'), p.risks, props.risks, props.setRisks)}
        {section(t('imports:ai.controls'), p.controls, props.controls, props.setControls)}
      </Flex>
    );
  }
  return (
    <Table
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={p.fields}
      columns={[
        { title: t('imports:ai.field'), dataIndex: 'key', width: 160 },
        {
          title: t('imports:ai.from'),
          render: (_, f) => (
            <Typography.Paragraph ellipsis={{ rows: 3 }}>
              {f.from.replace(/<[^>]+>/g, ' ')}
            </Typography.Paragraph>
          ),
        },
        {
          title: t('imports:ai.to'),
          render: (_, f) => (
            <Typography.Paragraph ellipsis={{ rows: 3 }} dir={p.target === 'ar' ? 'rtl' : 'ltr'}>
              {f.to.replace(/<[^>]+>/g, ' ')}
            </Typography.Paragraph>
          ),
        },
      ]}
    />
  );
}
