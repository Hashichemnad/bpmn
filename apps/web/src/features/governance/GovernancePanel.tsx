import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  InboxOutlined,
  RollbackOutlined,
  SendOutlined,
  SettingOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { ContentType, GovernanceInfoDto, ItemGovernanceInput } from '@processhub/shared';
import {
  useGovernance,
  useGovernanceAction,
  useItemPublications,
  useItemReviews,
  useUpdateItemGovernance,
  useWorkflows,
} from '@/api/governance';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { OfficialBadge, ReviewStateTag, StatusTag } from '@/components/tags';
import { ErrorState, LoadingState } from '@/components/states';
import { WorkflowSummary } from './WorkflowSummary';
import { WorkflowStepsEditor } from './WorkflowStepsEditor';
import { knownUsers, workflowToForm, type WorkflowFormValues } from './workflow-form';
import { UserSelect } from './UserSelect';

/**
 * Lifecycle of a process or page: status, published (official) version, owner, next review
 * date, the approval workflow and the actions the user may take. Every action is checked again
 * on the server.
 */
export function GovernancePanel({ type, id }: { type: ContentType; id: string }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const info = useGovernance(type, id);
  const act = useGovernanceAction(type, id);
  const [dialog, setDialog] = useState<
    'submit' | 'publish' | 'archive' | 'configure' | 'history' | null
  >(null);
  const [form] = Form.useForm();

  if (info.isLoading)
    return (
      <Card>
        <LoadingState />
      </Card>
    );
  if (info.isError || !info.data)
    return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  const g = info.data;
  const name = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? loc(u) || u.email : '—';

  const run = async (a: Parameters<typeof act.mutateAsync>[0], done: string) => {
    try {
      await act.mutateAsync(a);
      message.success(done);
      setDialog(null);
      form.resetFields();
      return true;
    } catch (err) {
      message.error(errorMessage(err));
      return false;
    }
  };

  const confirm = (content: string, a: Parameters<typeof act.mutateAsync>[0], done: string) =>
    modal.confirm({
      title: content,
      okText: t('confirm'),
      cancelText: t('cancel'),
      onOk: () => run(a, done),
    });

  const review = g.activeReview;
  const pub = g.publication;
  const workflow = g.workflow.workflow;

  return (
    <Card
      title={t('governance:panel.title')}
      extra={
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<HistoryOutlined />}
            onClick={() => setDialog('history')}
          >
            {t('governance:panel.history')}
          </Button>
          {g.can.configure && (
            <Button
              size="small"
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setDialog('configure')}
              aria-label={t('governance:actions.configure')}
            />
          )}
        </Space>
      }
    >
      <div className="ph-gov-section">
        <Flex gap={6} wrap="wrap" align="center">
          <StatusTag
            status={g.status}
            changesRequested={g.changesRequested}
            rejected={g.rejected}
          />
          {pub && <OfficialBadge />}
          <ReviewStateTag state={g.reviewState} />
        </Flex>
        {review && (
          <Alert
            style={{ marginBlockStart: 10 }}
            type="info"
            showIcon
            icon={<ClockCircleOutlined />}
            message={t('governance:panel.inReview', {
              date: formatDate(review.submittedAt, false),
              step: review.currentStep + 1,
              count: review.stepCount,
              name: loc(review.currentStepName) || '—',
            })}
            description={
              <Link to={`/reviews/${review.id}`}>{t('governance:panel.openReview')}</Link>
            }
          />
        )}
        {(g.changesRequested || g.rejected) && g.lastReview && (
          <Alert
            style={{ marginBlockStart: 10 }}
            type={g.rejected ? 'error' : 'warning'}
            showIcon
            message={t(
              g.rejected ? 'governance:panel.wasRejected' : 'governance:panel.wasReturned',
            )}
            description={
              <Link to={`/reviews/${g.lastReview.id}`}>{t('governance:panel.seeDecision')}</Link>
            }
          />
        )}
        {g.hasUnversionedChanges && g.status === 'DRAFT' && (
          <Alert
            style={{ marginBlockStart: 10 }}
            type="warning"
            showIcon
            message={t('governance:panel.unversioned')}
          />
        )}
      </div>

      <div className="ph-gov-section">
        <span className="ph-gov-label">{t('governance:panel.published')}</span>
        {pub ? (
          <>
            <Typography.Text strong>
              {t('governance:versionN', { number: pub.versionNumber })}
              {pub.versionLabel ? ` · ${pub.versionLabel}` : ''}
            </Typography.Text>
            <div className="ph-muted" style={{ fontSize: 12 }}>
              {t('governance:panel.publishedOn', {
                date: formatDate(pub.publishedAt, false),
                name: name(pub.publishedBy),
              })}
              {pub.approvedBy.length > 0 &&
                ` · ${t('governance:panel.approvedBy', { names: pub.approvedBy.map(name).join(', ') })}`}
            </div>
            {g.status !== 'PUBLISHED' && g.status !== 'ARCHIVED' && (
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', marginBlockStart: 4 }}
              >
                {t('governance:panel.liveWhileDraft', { version: pub.versionNumber })}
              </Typography.Text>
            )}
          </>
        ) : (
          <Typography.Text type="secondary">{t('governance:panel.notPublished')}</Typography.Text>
        )}
      </div>

      <div className="ph-gov-section">
        <Descriptions column={1} size="small">
          <Descriptions.Item label={t('fields.owner')}>{name(g.owner)}</Descriptions.Item>
          <Descriptions.Item label={t('governance:panel.workingVersion')}>
            {g.latestVersion
              ? `${t('governance:versionN', { number: g.latestVersion })}${g.latestVersionLabel ? ` · ${g.latestVersionLabel}` : ''}`
              : t('governance:panel.noVersion')}
          </Descriptions.Item>
          <Descriptions.Item label={t('governance:panel.nextReview')}>
            {g.nextReviewAt ? formatDate(g.nextReviewAt, false) : '—'}
          </Descriptions.Item>
        </Descriptions>
      </div>

      <div className="ph-gov-section">
        <span className="ph-gov-label">
          {t('governance:panel.workflow')} · {t(`governance:workflowSource.${g.workflow.source}`)}
        </span>
        {workflow ? (
          <>
            {workflow.isTemplate && <Typography.Text>{loc(workflow)}</Typography.Text>}
            <WorkflowSummary workflow={workflow} />
          </>
        ) : (
          <Alert type="warning" showIcon message={t('governance:panel.noWorkflow')} />
        )}
      </div>

      <div className="ph-gov-section">
        <Flex gap={8} wrap="wrap">
          {g.can.submit && (
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={g.hasUnversionedChanges || !workflow}
              onClick={() => setDialog('submit')}
            >
              {t('governance:actions.submit')}
            </Button>
          )}
          {g.can.publish && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => setDialog('publish')}
            >
              {t('governance:actions.publish')}
            </Button>
          )}
          {g.can.withdraw && (
            <Button
              icon={<RollbackOutlined />}
              onClick={() =>
                confirm(
                  t('governance:withdraw.confirm'),
                  { action: 'withdraw' },
                  t('governance:withdraw.done'),
                )
              }
            >
              {t('governance:actions.withdraw')}
            </Button>
          )}
          {g.can.confirmReview && (
            <Button
              icon={<CheckCircleOutlined />}
              onClick={() =>
                confirm(
                  t('governance:confirmReview.confirm'),
                  { action: 'confirm-review' },
                  t('governance:confirmReview.done'),
                )
              }
            >
              {t('governance:actions.confirmReview')}
            </Button>
          )}
          {g.can.archive && (
            <Button danger icon={<InboxOutlined />} onClick={() => setDialog('archive')}>
              {t('governance:actions.archive')}
            </Button>
          )}
          {g.can.restore && (
            <Button
              icon={<UndoOutlined />}
              onClick={() =>
                confirm(
                  t('governance:restore.confirm'),
                  { action: 'restore' },
                  t('governance:restore.done'),
                )
              }
            >
              {t('governance:actions.restore')}
            </Button>
          )}
        </Flex>
      </div>

      <Modal
        open={dialog === 'submit'}
        title={t('governance:submit.title')}
        okText={t('governance:actions.submit')}
        cancelText={t('cancel')}
        confirmLoading={act.isPending}
        onCancel={() => setDialog(null)}
        onOk={() =>
          void form.validateFields().then((v: { note?: string; dueAt?: Dayjs }) =>
            run(
              {
                action: 'submit',
                body: { note: v.note || undefined, dueAt: v.dueAt?.endOf('day').toDate() },
              },
              t('governance:submit.done'),
            ),
          )
        }
        destroyOnHidden
      >
        <Typography.Paragraph>
          {t('governance:submit.text', { version: g.latestVersion ?? '—' })}
        </Typography.Paragraph>
        {workflow && <WorkflowSummary workflow={workflow} />}
        <Form form={form} layout="vertical" style={{ marginBlockStart: 16 }}>
          <Form.Item name="note" label={t('governance:submit.note')}>
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
          <Form.Item
            name="dueAt"
            label={t('governance:submit.dueAt')}
            extra={t('governance:submit.dueHint')}
          >
            <DatePicker disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={dialog === 'publish'}
        title={t('governance:publish.title', { version: g.latestVersion })}
        okText={t('governance:actions.publish')}
        cancelText={t('cancel')}
        confirmLoading={act.isPending}
        onCancel={() => setDialog(null)}
        onOk={() =>
          void form
            .validateFields()
            .then((v: { versionLabel?: string }) =>
              run(
                { action: 'publish', body: { versionLabel: v.versionLabel || undefined } },
                t('governance:publish.done'),
              ),
            )
        }
        destroyOnHidden
      >
        <Typography.Paragraph>{t('governance:publish.text')}</Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="versionLabel"
            label={t('governance:publish.label')}
            extra={t('governance:publish.labelHint')}
          >
            <Input maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={dialog === 'archive'}
        title={t('governance:archive.title')}
        okText={t('governance:actions.archive')}
        okButtonProps={{ danger: true }}
        cancelText={t('cancel')}
        confirmLoading={act.isPending}
        onCancel={() => setDialog(null)}
        onOk={() =>
          void form
            .validateFields()
            .then((v: { reason?: string }) =>
              run(
                { action: 'archive', body: { reason: v.reason || undefined } },
                t('governance:archive.done'),
              ),
            )
        }
        destroyOnHidden
      >
        <Typography.Paragraph>{t('governance:archive.text')}</Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={t('governance:archive.reason')}>
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>

      {dialog === 'configure' && (
        <ConfigureDrawer type={type} id={id} info={g} onClose={() => setDialog(null)} />
      )}
      {dialog === 'history' && (
        <HistoryDrawer type={type} id={id} onClose={() => setDialog(null)} />
      )}
    </Card>
  );
}

type Mode = 'inherit' | 'template' | 'custom';

function ConfigureDrawer({
  type,
  id,
  info,
  onClose,
}: {
  type: ContentType;
  id: string;
  info: GovernanceInfoDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const workflows = useWorkflows();
  const save = useUpdateItemGovernance(type, id);
  const [form] = Form.useForm();
  const current = info.workflow;
  const own = current.source === 'ITEM' ? current.workflow : null;
  const initialMode: Mode = !own ? 'inherit' : own.isTemplate ? 'template' : 'custom';
  const mode = Form.useWatch('mode', form) as Mode | undefined;

  const submit = async () => {
    const v = (await form.validateFields()) as WorkflowFormValues & {
      mode: Mode;
      workflowId?: string;
      nextReviewAt?: Dayjs | null;
      ownerId?: string | null;
    };
    const body: ItemGovernanceInput = {
      nextReviewAt: v.nextReviewAt ? v.nextReviewAt.endOf('day').toDate() : null,
      ...(type === 'PAGE' ? { ownerId: v.ownerId ?? null } : {}),
    };
    if (v.mode === 'inherit') body.workflowId = null;
    if (v.mode === 'template') body.workflowId = v.workflowId;
    if (v.mode === 'custom') {
      body.customWorkflow = {
        nameEn: 'Custom workflow',
        nameAr: 'مسار اعتماد مخصص',
        steps: v.steps,
        autoPublish: v.autoPublish ?? false,
      };
    }
    try {
      await save.mutateAsync(body);
      message.success(t('saved'));
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      width={640}
      title={t('governance:configure.title')}
      onClose={onClose}
      extra={
        <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
          {t('save')}
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          mode: initialMode,
          workflowId: own?.isTemplate ? own.id : undefined,
          ...workflowToForm(own && !own.isTemplate ? own : null),
          nextReviewAt: info.nextReviewAt ? dayjs(info.nextReviewAt) : null,
          ownerId: info.owner?.id ?? null,
        }}
      >
        <Form.Item name="mode" label={t('governance:configure.workflow')}>
          <Radio.Group
            optionType="button"
            options={[
              { value: 'inherit', label: t('governance:configure.inherit') },
              { value: 'template', label: t('governance:configure.template') },
              { value: 'custom', label: t('governance:configure.custom') },
            ]}
          />
        </Form.Item>
        {mode === 'template' && (
          <Form.Item
            name="workflowId"
            rules={[{ required: true, message: t('validation.required') }]}
          >
            <Select
              loading={workflows.isLoading}
              options={(workflows.data ?? []).map((w) => ({ value: w.id, label: loc(w) }))}
            />
          </Form.Item>
        )}
        {mode === 'custom' && (
          <>
            <WorkflowStepsEditor known={knownUsers(own)} />
            <Form.Item name="autoPublish" style={{ marginBlockStart: 12 }}>
              <Radio.Group
                options={[
                  { value: false, label: t('governance:workflows.manualPublish') },
                  { value: true, label: t('governance:workflows.autoPublish') },
                ]}
              />
            </Form.Item>
          </>
        )}
        {mode === 'inherit' && (
          <Typography.Paragraph type="secondary">
            {t('governance:configure.inheritHint')}
          </Typography.Paragraph>
        )}
        <Form.Item
          name="nextReviewAt"
          label={t('governance:panel.nextReview')}
          extra={t('governance:configure.nextReviewHint')}
        >
          <DatePicker allowClear />
        </Form.Item>
        {type === 'PAGE' && (
          <Form.Item name="ownerId" label={t('fields.owner')}>
            <UserSelect allowClear known={info.owner ? [info.owner] : []} />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}

function HistoryDrawer({
  type,
  id,
  onClose,
}: {
  type: ContentType;
  id: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const reviews = useItemReviews(type, id);
  const pubs = useItemPublications(type, id);
  return (
    <Drawer open width={520} title={t('governance:panel.history')} onClose={onClose}>
      <Typography.Title level={5}>{t('governance:panel.publications')}</Typography.Title>
      {pubs.isLoading ? (
        <LoadingState />
      ) : pubs.data?.length ? (
        <Timeline
          items={pubs.data.map((p) => ({
            color: p.current ? 'green' : 'gray',
            children: (
              <>
                <Typography.Text strong>
                  {t('governance:versionN', { number: p.versionNumber })}
                  {p.versionLabel ? ` · ${p.versionLabel}` : ''}
                </Typography.Text>{' '}
                {p.current && <Tag color="green">{t('governance:panel.current')}</Tag>}
                <div className="ph-muted" style={{ fontSize: 12 }}>
                  {t('governance:panel.publishedOn', {
                    date: formatDate(p.publishedAt, false),
                    name: loc(p.publishedBy) || p.publishedBy?.email || '—',
                  })}
                  {p.endedAt &&
                    ` · ${t('governance:panel.endedOn', { date: formatDate(p.endedAt, false) })}`}
                </div>
              </>
            ),
          }))}
        />
      ) : (
        <Typography.Text type="secondary">{t('governance:panel.notPublished')}</Typography.Text>
      )}
      <Typography.Title level={5} style={{ marginBlockStart: 16 }}>
        {t('governance:panel.reviews')}
      </Typography.Title>
      {reviews.isLoading ? (
        <LoadingState />
      ) : reviews.data?.length ? (
        <Timeline
          items={reviews.data.map((r) => ({
            color:
              r.status === 'APPROVED'
                ? 'green'
                : r.status === 'IN_PROGRESS'
                  ? 'blue'
                  : r.status === 'WITHDRAWN'
                    ? 'gray'
                    : 'red',
            children: (
              <>
                <Link to={`/reviews/${r.id}`}>
                  {t('governance:versionN', { number: r.versionNumber })} ·{' '}
                  {t(`governance:reviewStatus.${r.status}`)}
                </Link>
                <div className="ph-muted" style={{ fontSize: 12 }}>
                  {t('governance:review.submittedBy', {
                    name: loc(r.submittedBy) || r.submittedBy?.email || '—',
                    date: formatDate(r.submittedAt, false),
                  })}
                </div>
              </>
            ),
          }))}
        />
      ) : (
        <Typography.Text type="secondary">{t('governance:panel.noReviews')}</Typography.Text>
      )}
    </Drawer>
  );
}
