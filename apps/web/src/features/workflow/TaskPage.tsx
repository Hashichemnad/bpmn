import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  RollbackOutlined,
  SaveOutlined,
  SwapOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ApprovalOutcome } from '@processhub/shared';
import { ApiError } from '@/api/client';
import { useTaskAction, useWfTask } from '@/api/workflow';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { CaseDiagram } from './CaseDiagram';
import { WorkflowForm, UserPicker } from './WorkflowForm';
import { dataToForm, formToData } from './form-utils';
import { DueTag } from './wf-helpers';
import { casePath } from './wf-paths';

const DECISION_ICONS: Record<ApprovalOutcome, React.ReactNode> = {
  APPROVE: <CheckOutlined />,
  REJECT: <CloseOutlined />,
  RETURN: <RollbackOutlined />,
};

/**
 * A workflow task (Phase 5.2 step 2): its form, decision (approve / reject / return with a mandatory
 * comment on reject and return), claim of group tasks, delegation, reassignment by admins.
 */
export function TaskPage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const task = useWfTask(id);
  const act = useTaskAction(id!);
  const [form] = Form.useForm();
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState(false);
  const [handOver, setHandOver] = useState<'delegate' | 'reassign' | null>(null);
  const d = task.data;
  useEffect(() => {
    if (d?.form) form.setFieldsValue(dataToForm(d.form, d.values));
  }, [d?.id, d?.version, d?.form, d?.values, form]);
  if (task.isLoading) return <LoadingState />;
  if (task.isError || !d) return <ErrorState error={task.error} />;
  const open = d.status === 'OPEN';

  const run = async (decision: ApprovalOutcome | null) => {
    const needsComment = decision === 'REJECT' || decision === 'RETURN';
    if (needsComment && !comment.trim()) {
      setCommentError(true);
      return;
    }
    let data: Record<string, unknown> = {};
    if (d.form) {
      if (!needsComment) await form.validateFields();
      data = formToData(d.form, form.getFieldsValue(true));
    }
    try {
      await act.mutateAsync({
        action: 'complete',
        body: { data, decision, comment: comment.trim(), version: d.version },
      });
      message.success(t('workflow:task.done'));
      navigate(portal ? '/portal/tasks' : '/tasks?tab=workflow');
    } catch (e) {
      message.error(errorMessage(e));
      if (e instanceof ApiError && e.code === 'FORM_INVALID' && Array.isArray(e.details))
        form.setFields(
          (e.details as { key: string; code: string }[]).map((x) => ({
            name: x.key,
            errors: [t(`workflow:formError.${x.code}`, { defaultValue: x.code })],
          })),
        );
      if (e instanceof ApiError && e.status === 409) void task.refetch();
    }
  };
  const simple = (action: 'claim' | 'unclaim') =>
    act.mutate(
      { action },
      { onError: (e) => message.error(errorMessage(e)), onSuccess: () => void task.refetch() },
    );
  const saveDraft = () =>
    d.form &&
    act.mutate(
      { action: 'draft', data: formToData(d.form, form.getFieldsValue(true)) },
      {
        onSuccess: () => message.success(t('workflow:task.saved')),
        onError: (e) => message.error(errorMessage(e)),
      },
    );

  return (
    <>
      <PageHeader
        title={loc(d)}
        subtitle={
          <Space wrap>
            <Link to={casePath(d.caseId, portal)} dir="ltr">
              {d.caseNumber}
            </Link>
            <span>{loc(d, 'caseTitle')}</span>
            <Tag>{loc(d, 'processName')}</Tag>
          </Space>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} style={{ marginBlockEnd: 16 }}>
              <Descriptions.Item label={t('workflow:tasks.due')}>
                <DueTag due={d.dueAt} />
              </Descriptions.Item>
              <Descriptions.Item label={t('workflow:tasks.requester')}>
                {d.initiator ? loc(d.initiator) || d.initiator.email : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('workflow:task.assignee')}>
                {d.assignee ? (
                  loc(d.assignee) || d.assignee.email
                ) : (
                  <Tag>{t('workflow:tasks.groupTag', { count: d.candidates.length })}</Tag>
                )}
              </Descriptions.Item>
              {d.onBehalfOf && (
                <Descriptions.Item label={t('workflow:task.onBehalfOf')}>
                  {loc(d.onBehalfOf) || d.onBehalfOf.email}
                </Descriptions.Item>
              )}
            </Descriptions>
            {!open && (
              <Alert
                type="info"
                showIcon
                message={t('workflow:task.closed')}
                style={{ marginBlockEnd: 12 }}
              />
            )}
            {d.blockedReason && (
              <Alert
                type="warning"
                showIcon
                message={t(`workflow:task.blocked.${d.blockedReason}`)}
                style={{ marginBlockEnd: 12 }}
              />
            )}
            {d.canClaim && (
              <Alert
                type="info"
                showIcon
                message={t('workflow:task.claimHint')}
                action={
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => simple('claim')}
                    loading={act.isPending}
                    data-testid="wf-claim"
                  >
                    {t('workflow:tasks.claim')}
                  </Button>
                }
                style={{ marginBlockEnd: 12 }}
              />
            )}
            {d.form && d.form.fields.length > 0 ? (
              <WorkflowForm
                schema={d.form}
                form={form}
                context={d.caseData}
                caseId={d.caseId}
                taskId={d.id}
                disabled={!d.canComplete}
              />
            ) : (
              <Typography.Paragraph type="secondary">
                {t('workflow:task.noForm')}
              </Typography.Paragraph>
            )}
            {d.canComplete && (
              <>
                <Form.Item
                  label={t('workflow:task.comment')}
                  validateStatus={commentError ? 'error' : undefined}
                  help={
                    commentError
                      ? t('workflow:task.commentRequired')
                      : d.approval
                        ? t('workflow:task.commentHint')
                        : undefined
                  }
                  style={{ marginBlockStart: 8 }}
                >
                  <Input.TextArea
                    rows={3}
                    maxLength={5000}
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value);
                      setCommentError(false);
                    }}
                    data-testid="wf-comment"
                  />
                </Form.Item>
                <Space wrap>
                  {d.approval ? (
                    d.decisions.map((o) => (
                      <Button
                        key={o}
                        type={o === 'APPROVE' ? 'primary' : 'default'}
                        danger={o === 'REJECT'}
                        icon={DECISION_ICONS[o]}
                        loading={act.isPending}
                        onClick={() => void run(o)}
                        data-testid={`wf-decision-${o}`}
                      >
                        {t(`workflow:decision.${o}`)}
                      </Button>
                    ))
                  ) : (
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      loading={act.isPending}
                      onClick={() => void run(null)}
                      data-testid="wf-complete"
                    >
                      {t('workflow:task.complete')}
                    </Button>
                  )}
                  {d.form && d.form.fields.length > 0 && (
                    <Button icon={<SaveOutlined />} onClick={saveDraft}>
                      {t('workflow:task.saveDraft')}
                    </Button>
                  )}
                </Space>
              </>
            )}
            <Space wrap style={{ marginBlockStart: 16 }}>
              {d.canUnclaim && (
                <Button size="small" onClick={() => simple('unclaim')}>
                  {t('workflow:task.unclaim')}
                </Button>
              )}
              {d.canDelegate && (
                <Button
                  size="small"
                  icon={<UserSwitchOutlined />}
                  onClick={() => setHandOver('delegate')}
                >
                  {t('workflow:task.delegate')}
                </Button>
              )}
              {d.canReassign && (
                <Button
                  size="small"
                  icon={<SwapOutlined />}
                  onClick={() => setHandOver('reassign')}
                >
                  {t('workflow:task.reassign')}
                </Button>
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={t('workflow:task.whereInProcess')}
            extra={<Link to={casePath(d.caseId, portal)}>{t('workflow:task.openRequest')}</Link>}
          >
            <CaseDiagram xml={d.bpmnXml} active={[d.elementId]} focus={d.elementId} />
          </Card>
        </Col>
      </Row>
      {handOver && (
        <HandOverModal
          mode={handOver}
          onClose={() => setHandOver(null)}
          onSubmit={async (userId, note) => {
            try {
              await act.mutateAsync({ action: handOver, userId, comment: note });
              message.success(t(`workflow:task.${handOver}Done`));
              setHandOver(null);
              navigate(portal ? '/portal/tasks' : '/tasks?tab=workflow');
            } catch (e) {
              message.error(errorMessage(e));
            }
          }}
        />
      )}
    </>
  );
}

function HandOverModal({
  mode,
  onClose,
  onSubmit,
}: {
  mode: 'delegate' | 'reassign';
  onClose: () => void;
  onSubmit: (userId: string, comment: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={t(`workflow:task.${mode}`)}
      onCancel={onClose}
      okButtonProps={{ disabled: !userId, loading: busy }}
      onOk={async () => {
        setBusy(true);
        await onSubmit(userId!, comment).finally(() => setBusy(false));
      }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t(`workflow:task.${mode}Hint`)}</Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label={t('workflow:task.person')} required>
          <UserPicker value={userId ?? undefined} onChange={setUserId} />
        </Form.Item>
        <Form.Item label={t('workflow:task.comment')}>
          <Input.TextArea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
