import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  ExportOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type {
  Locale,
  PageContentDto,
  ReviewDecision,
  ReviewDetailDto,
  ReviewStepDto,
} from '@processhub/shared';
import { useDecide, useGovernanceAction, useReview } from '@/api/governance';
import { AiIcon } from '@/features/ai/AiParts';
import { SummaryView } from '@/features/ai/SummaryModal';
import { useAi } from '@/features/ai/useAi';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { workspaceLink } from './links';
import { DiagramCompare } from '@/features/diagrams/DiagramCompare';
import { BpmnCompare } from '@/features/versions/BpmnCompare';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import { DiffStatsTags, PageDiffView } from '@/features/docs/PageDiffView';
import { RichTextView } from '@/features/docs/RichTextView';
import { useDiff } from '@/features/docs/use-diff';
import { CommentsPanel } from '@/features/comments/CommentsPanel';

const STEP_STATUS: Record<ReviewStepDto['state'], 'wait' | 'process' | 'finish' | 'error'> = {
  WAITING: 'wait',
  ACTIVE: 'process',
  APPROVED: 'finish',
  CHANGES_REQUESTED: 'error',
  REJECTED: 'error',
  CANCELLED: 'wait',
};

const TASK_COLORS: Record<string, string> = {
  PENDING: 'processing',
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  REJECTED: 'error',
  SKIPPED: 'default',
};

function itemLink(r: ReviewDetailDto) {
  return workspaceLink(r.item);
}

function PageCompare({
  base,
  next,
  baseTitle,
  nextTitle,
}: {
  base: PageContentDto | null;
  next: PageContentDto;
  baseTitle: string;
  nextTitle: string;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [lang, setLang] = useState<Locale>(locale);
  const [mode, setMode] = useState<'side' | 'inline'>('side');
  const pick = (c: PageContentDto | null) => (c ? (lang === 'ar' ? c.contentAr : c.contentEn) : '');
  const diff = useDiff(pick(base), pick(next));
  const dir = lang === 'ar' ? next.dirAr : next.dirEn;
  return (
    <Space direction="vertical" size={12} style={{ inlineSize: '100%' }}>
      <Flex gap={8} wrap="wrap" justify="space-between">
        <Segmented
          value={lang}
          onChange={(v) => setLang(v as Locale)}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
          ]}
        />
        {base && (
          <Space wrap>
            <DiffStatsTags stats={diff.stats} />
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'side' | 'inline')}
              options={[
                { value: 'side', label: t('docs:diff.sideBySide') },
                { value: 'inline', label: t('docs:diff.inline') },
              ]}
            />
          </Space>
        )}
      </Flex>
      {base ? (
        <PageDiffView
          rows={diff.rows}
          mode={mode}
          dir={dir}
          leftTitle={baseTitle}
          rightTitle={nextTitle}
        />
      ) : (
        <Card size="small">
          <RichTextView html={pick(next)} dir={dir} lang={lang} />
        </Card>
      )}
    </Space>
  );
}

/** A review round: steps, decisions and what changed since the last published version. */
export function ReviewPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const review = useReview(reviewId);
  const { available: aiAvailable } = useAi();
  const decide = useDecide(reviewId ?? '');
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [form] = Form.useForm<{ comment?: string }>();
  const item = review.data?.item;
  const withdraw = useGovernanceAction(item?.entityType ?? 'PROCESS', item?.entityId ?? '');

  if (review.isLoading) return <LoadingState />;
  if (review.isError || !review.data)
    return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;
  const r = review.data;
  const title = `${r.item.code ? `${r.item.code} ` : ''}${loc(r.item, 'title')}`;
  const name = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? loc(u) || u.email : '—';
  const baseTitle = r.compare.baseVersion
    ? t('governance:review.publishedVersion', { version: r.compare.baseVersion })
    : '';
  const nextTitle = t('governance:review.versionUnderReview', { version: r.versionNumber });

  const submitDecision = async () => {
    const v = await form.validateFields();
    try {
      await decide.mutateAsync({ decision: decision!, comment: v.comment?.trim() || undefined });
      message.success(t('governance:review.decided'));
      setDecision(null);
      form.resetFields();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const confirmWithdraw = () =>
    modal.confirm({
      title: t('governance:withdraw.confirm'),
      okText: t('confirm'),
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await withdraw.mutateAsync({ action: 'withdraw' });
          message.success(t('governance:withdraw.done'));
          void review.refetch();
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('governance:tasks.title'), to: '/tasks' },
          { title: t('governance:review.title') },
        ]}
        title={t('governance:review.of', { title })}
        subtitle={
          <Space size={8} wrap style={{ marginBlockStart: 4 }}>
            <Tag
              color={
                r.status === 'IN_PROGRESS'
                  ? 'processing'
                  : r.status === 'APPROVED'
                    ? 'success'
                    : 'default'
              }
            >
              {t(`governance:reviewStatus.${r.status}`)}
            </Tag>
            <Typography.Text type="secondary">
              {t('governance:versionN', { number: r.versionNumber })} ·{' '}
              {t('governance:review.submittedBy', {
                name: name(r.submittedBy),
                date: formatDate(r.submittedAt),
              })}
            </Typography.Text>
            {r.dueAt && r.status === 'IN_PROGRESS' && (
              <Tag color={r.overdue ? 'red' : 'default'}>
                {r.overdue
                  ? t('governance:review.overdueSince', { date: formatDate(r.dueAt, false) })
                  : t('governance:review.due', { date: formatDate(r.dueAt, false) })}
              </Tag>
            )}
          </Space>
        }
        extra={
          <>
            <Link to={itemLink(r)}>
              <Button icon={<ExportOutlined />}>{t('governance:review.openItem')}</Button>
            </Link>
            {r.canWithdraw && (
              <Button icon={<RollbackOutlined />} onClick={confirmWithdraw}>
                {t('governance:actions.withdraw')}
              </Button>
            )}
          </>
        }
      />
      {r.canDecide && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('governance:review.yourTurn', { step: loc(r.currentStepName) })}
          action={
            <Space wrap>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => setDecision('APPROVE')}
              >
                {t('governance:actions.approve')}
              </Button>
              <Button icon={<EditOutlined />} onClick={() => setDecision('REQUEST_CHANGES')}>
                {t('governance:actions.requestChanges')}
              </Button>
              <Button danger icon={<CloseOutlined />} onClick={() => setDecision('REJECT')}>
                {t('governance:actions.reject')}
              </Button>
            </Space>
          }
        />
      )}
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={16}>
          {aiAvailable && (
            <Card
              className="ph-ai-card"
              title={
                <Space>
                  <AiIcon />
                  {t('ai:summary.reviewTitle')}
                </Space>
              }
              style={{ marginBlockEnd: 24 }}
            >
              <SummaryView
                auto={false}
                target={{ type: r.item.entityType, id: r.item.entityId, reviewId: r.id }}
              />
            </Card>
          )}
          <Card
            title={t('governance:review.changes')}
            extra={
              <Typography.Text type="secondary">
                {r.compare.baseVersion
                  ? t('governance:review.comparedTo', { version: r.compare.baseVersion })
                  : t('governance:review.firstPublication')}
              </Typography.Text>
            }
          >
            {r.changeNote && (
              <Typography.Paragraph>
                <Typography.Text type="secondary">
                  {t('governance:review.changeNote')}:{' '}
                </Typography.Text>
                {r.changeNote}
              </Typography.Paragraph>
            )}
            {r.compare.kind === 'PROCESS' ? (
              r.compare.baseXml ? (
                <BpmnCompare
                  oldXml={r.compare.baseXml}
                  newXml={r.compare.newXml}
                  oldTitle={baseTitle}
                  newTitle={nextTitle}
                />
              ) : (
                <DiagramCanvas xml={r.compare.newXml} className="ph-review-canvas" />
              )
            ) : r.compare.kind === 'DIAGRAM' ? (
              <DiagramCompare
                type={r.compare.diagramType}
                baseContent={r.compare.baseContent}
                newContent={r.compare.newContent}
                baseTitle={baseTitle}
                nextTitle={nextTitle}
              />
            ) : (
              <PageCompare
                base={r.compare.base}
                next={r.compare.next}
                baseTitle={baseTitle}
                nextTitle={nextTitle}
              />
            )}
          </Card>
          <Card title={t('governance:comments.title')} style={{ marginBlockStart: 24 }}>
            <CommentsPanel type={r.item.entityType} id={r.item.entityId} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title={t('governance:review.steps')}>
            {r.note && (
              <Alert
                type="info"
                style={{ marginBlockEnd: 16 }}
                message={t('governance:review.note')}
                description={r.note}
              />
            )}
            <Typography.Paragraph type="secondary">{loc(r.workflowName)}</Typography.Paragraph>
            <Steps
              direction="vertical"
              size="small"
              current={r.currentStep}
              items={r.steps.map((s) => ({
                status: STEP_STATUS[s.state],
                title: loc(s) || t('governance:workflows.stepN', { number: s.index + 1 }),
                subTitle: t(`governance:stepState.${s.state}`),
                description: (
                  <Space direction="vertical" size={4} style={{ marginBlockStart: 4 }}>
                    {s.approvedBySubmitter ? (
                      <Typography.Text type="secondary">
                        {t('governance:review.approvedBySubmitter')}
                      </Typography.Text>
                    ) : s.tasks.length ? (
                      s.tasks.map((task) => (
                        <div key={task.id}>
                          <Space size={6} wrap>
                            <Typography.Text>{name(task.assignee)}</Typography.Text>
                            <Tag color={TASK_COLORS[task.status]}>
                              {t(`governance:taskStatus.${task.status}`)}
                            </Tag>
                            {task.decidedAt && (
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {formatDate(task.decidedAt)}
                              </Typography.Text>
                            )}
                          </Space>
                          {task.comment && <div className="ph-comment-body">“{task.comment}”</div>}
                        </div>
                      ))
                    ) : (
                      <Typography.Text type="secondary">
                        {s.rule === 'ALL' ? t('governance:rule.ALL') : t('governance:rule.ANY')}:{' '}
                        {s.assignees.map(name).join(', ')}
                      </Typography.Text>
                    )}
                  </Space>
                ),
              }))}
            />
          </Card>
        </Col>
      </Row>
      <Modal
        open={!!decision}
        title={decision ? t(`governance:decision.${decision}`) : ''}
        okText={decision ? t(`governance:decision.${decision}`) : ''}
        okButtonProps={{ danger: decision === 'REJECT' }}
        cancelText={t('cancel')}
        confirmLoading={decide.isPending}
        onCancel={() => setDecision(null)}
        onOk={() => void submitDecision()}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {decision ? t(`governance:decisionHint.${decision}`) : ''}
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="comment"
            label={t('governance:review.comment')}
            rules={
              decision === 'APPROVE'
                ? []
                : [
                    {
                      required: true,
                      whitespace: true,
                      message: t('governance:review.commentRequired'),
                    },
                  ]
            }
          >
            <Input.TextArea rows={4} maxLength={2000} showCount autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
