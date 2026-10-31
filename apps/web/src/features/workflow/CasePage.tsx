import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Input,
  List,
  Modal,
  Row,
  Space,
  Tag,
  Timeline,
  Typography,
  Upload,
} from 'antd';
import {
  FileWordOutlined,
  PaperClipOutlined,
  RedoOutlined,
  StopOutlined,
  UploadOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { commentSegments, type CaseDetailDto, type CaseEventDto } from '@processhub/shared';
import {
  uploadWorkflowFile,
  useAddCaseComment,
  useCase,
  useCaseAction,
  workflowFileUrl,
} from '@/api/workflow';
import { useQueryClient } from '@tanstack/react-query';
import { wfKeys } from '@/api/workflow';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { CaseDiagram } from './CaseDiagram';
import { FormValues } from './WorkflowForm';
import { CaseMentionInput } from './CaseMentionInput';
import { CaseStatusTag, DueTag } from './wf-helpers';
import { casePath, taskPath } from './wf-paths';

/**
 * A request (case, Phase 5.2 step 3): number, status, current steps on the diagram, timeline of every
 * step (who, when, decision, comment), the form data of each step (read-only), attachments and
 * generated documents, comments with mentions; withdraw (requester), cancel / retry (admins).
 */
export function CasePage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const data = useCase(id);
  const action = useCaseAction(id!);
  const addComment = useAddCaseComment(id!);
  const [reason, setReason] = useState<'withdraw' | 'cancel' | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [comment, setComment] = useState('');
  const [commentKey, setCommentKey] = useState(0);
  const c = data.data;
  const fileNames = useMemo(
    () => Object.fromEntries((c?.files ?? []).map((f) => [f.id, f.name])),
    [c?.files],
  );
  if (data.isLoading) return <LoadingState />;
  if (data.isError || !c) return <ErrorState error={data.error} />;

  const doAction = async (a: 'withdraw' | 'cancel' | 'retry', text?: string) => {
    try {
      await action.mutateAsync({ action: a, reason: text });
      message.success(t(`workflow:case.${a}Done`));
      setReason(null);
      setReasonText('');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  const openTasks = c.tasks.filter((x) => x.status === 'OPEN');
  return (
    <>
      <PageHeader
        title={
          <Space wrap>
            <span dir="ltr">{c.number}</span>
            <span>{loc(c, 'title')}</span>
          </Space>
        }
        subtitle={
          <Space wrap>
            <CaseStatusTag status={c.status} outcome={c.outcome} />
            <span>{loc(c, 'processName')}</span>
            <Tag>{t('workflow:case.version', { version: c.versionNumber })}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            {c.canWithdraw && (
              <Button
                icon={<UndoOutlined />}
                onClick={() => setReason('withdraw')}
                data-testid="wf-withdraw"
              >
                {t('workflow:case.withdraw')}
              </Button>
            )}
            {c.canRetry && (
              <Button icon={<RedoOutlined />} onClick={() => void doAction('retry')}>
                {t('workflow:case.retry')}
              </Button>
            )}
            {c.canCancel && (
              <Button danger icon={<StopOutlined />} onClick={() => setReason('cancel')}>
                {t('workflow:case.cancel')}
              </Button>
            )}
          </Space>
        }
      />
      {c.incidents.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('workflow:case.stuck')}
          description={c.incidents.map((i) => (
            <div key={i.tokenId}>
              <strong>{loc(i)}</strong>:{' '}
              {t(`errors:${i.code}`, { defaultValue: i.message || i.code })}
            </div>
          ))}
        />
      )}
      {c.dataPurged && (
        <Alert
          type="info"
          showIcon
          message={t('workflow:case.purged')}
          style={{ marginBlockEnd: 16 }}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title={t('workflow:case.progress')}>
            <CaseDiagram
              xml={c.bpmnXml}
              active={c.activeElementIds}
              completed={c.completedElementIds}
            />
            {openTasks.length > 0 && (
              <List
                size="small"
                style={{ marginBlockStart: 12 }}
                header={<strong>{t('workflow:case.currentSteps')}</strong>}
                dataSource={openTasks}
                renderItem={(tk) => (
                  <List.Item
                    actions={[
                      <Link key="o" to={taskPath(tk.id, portal)}>
                        {t('workflow:tasks.open')}
                      </Link>,
                    ]}
                  >
                    <Space wrap>
                      <span>{loc(tk)}</span>
                      <span>
                        {tk.assignee
                          ? loc(tk.assignee) || tk.assignee.email
                          : t('workflow:tasks.groupTag', { count: tk.candidates.length })}
                      </span>
                      <DueTag due={tk.dueAt} />
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
          <Card title={t('workflow:case.data')} style={{ marginBlockStart: 16 }}>
            <Collapse
              defaultActiveKey={['start']}
              items={[
                {
                  key: 'start',
                  label: t('workflow:case.request'),
                  children:
                    c.startForm && c.startData ? (
                      <FormValues schema={c.startForm} values={c.startData} fileNames={fileNames} />
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    ),
                },
                ...c.tasks
                  .filter((tk) => tk.status === 'COMPLETED')
                  .map((tk) => ({
                    key: tk.id,
                    label: (
                      <Space wrap>
                        <span>{loc(tk)}</span>
                        {tk.decision && (
                          <Tag
                            color={
                              tk.decision === 'APPROVE'
                                ? 'green'
                                : tk.decision === 'REJECT'
                                  ? 'red'
                                  : 'orange'
                            }
                          >
                            {t(`workflow:decision.${tk.decision}`)}
                          </Tag>
                        )}
                        <Typography.Text type="secondary">
                          {tk.completedBy ? loc(tk.completedBy) || tk.completedBy.email : ''} ·{' '}
                          {formatDate(tk.completedAt)}
                        </Typography.Text>
                      </Space>
                    ),
                    children: (
                      <>
                        {tk.comment && (
                          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                            {tk.comment}
                          </Typography.Paragraph>
                        )}
                        {tk.form && tk.data ? (
                          <FormValues schema={tk.form} values={tk.data} fileNames={fileNames} />
                        ) : (
                          !tk.comment && <Typography.Text type="secondary">—</Typography.Text>
                        )}
                      </>
                    ),
                  })),
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title={t('workflow:case.summary')}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={t('workflow:tasks.requester')}>
                {c.initiator ? loc(c.initiator) || c.initiator.email : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('workflow:case.started')}>
                {formatDate(c.startedAt)}
              </Descriptions.Item>
              {c.completedAt && (
                <Descriptions.Item label={t('workflow:case.ended')}>
                  {formatDate(c.completedAt)}
                </Descriptions.Item>
              )}
              {c.parentCase && (
                <Descriptions.Item label={t('workflow:case.parent')}>
                  <Link to={casePath(c.parentCase.id, portal)} dir="ltr">
                    {c.parentCase.number}
                  </Link>
                </Descriptions.Item>
              )}
              {c.childCases.length > 0 && (
                <Descriptions.Item label={t('workflow:case.children')}>
                  <Space wrap>
                    {c.childCases.map((ch) => (
                      <Link key={ch.id} to={casePath(ch.id, portal)} dir="ltr">
                        {ch.number}
                      </Link>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
          <Card
            title={t('workflow:case.files')}
            style={{ marginBlockStart: 16 }}
            data-testid="case-files"
          >
            {c.files.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('workflow:case.noFiles')}
              />
            ) : (
              <List
                size="small"
                dataSource={c.files}
                renderItem={(f) => (
                  <List.Item>
                    <a href={workflowFileUrl(f.id)}>
                      {f.kind === 'GENERATED' ? <FileWordOutlined /> : <PaperClipOutlined />}{' '}
                      {f.name}
                    </a>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {f.kind === 'GENERATED'
                        ? t('workflow:case.generated')
                        : f.createdBy
                          ? loc(f.createdBy) || f.createdBy.email
                          : ''}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            )}
            {c.canUpload && (
              <Upload
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  try {
                    const f = await uploadWorkflowFile(file as File, { caseId: c.id });
                    onSuccess?.(f);
                    void qc.invalidateQueries({ queryKey: wfKeys.case(c.id) });
                  } catch (e) {
                    message.error(errorMessage(e));
                    onError?.(e as Error);
                  }
                }}
              >
                <Button size="small" icon={<UploadOutlined />} style={{ marginBlockStart: 8 }}>
                  {t('workflow:form.addFile')}
                </Button>
              </Upload>
            )}
          </Card>
          <Card title={t('workflow:case.timeline')} style={{ marginBlockStart: 16 }}>
            <Timeline
              className="ph-wf-timeline"
              items={c.events.map((e) => ({
                color: eventColour(e),
                children: <EventLine e={e} c={c} />,
              }))}
            />
          </Card>
          <Card title={t('workflow:case.comments')} style={{ marginBlockStart: 16 }}>
            <List
              size="small"
              locale={{ emptyText: t('workflow:case.noComments') }}
              dataSource={c.comments}
              renderItem={(m) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>
                      {m.author ? loc(m.author) || m.author.email : '—'}{' '}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(m.createdAt)}
                      </Typography.Text>
                    </Typography.Text>
                    <span style={{ whiteSpace: 'pre-wrap' }}>
                      {commentSegments(m.body).map((s, i) =>
                        s.type === 'text' ? (
                          <span key={i}>{s.text}</span>
                        ) : (
                          <Tag key={i} color="blue">
                            @{s.name}
                          </Tag>
                        ),
                      )}
                    </span>
                  </Space>
                </List.Item>
              )}
            />
            {c.canComment && (
              <Space direction="vertical" style={{ width: '100%', marginBlockStart: 8 }}>
                <CaseMentionInput key={commentKey} onChange={setComment} />
                <Button
                  type="primary"
                  disabled={!comment.trim()}
                  loading={addComment.isPending}
                  onClick={() =>
                    addComment.mutate(comment.trim(), {
                      onSuccess: () => {
                        setComment('');
                        setCommentKey((k) => k + 1);
                      },
                      onError: (e) => message.error(errorMessage(e)),
                    })
                  }
                  data-testid="case-comment-send"
                >
                  {t('workflow:case.send')}
                </Button>
              </Space>
            )}
          </Card>
        </Col>
      </Row>
      <Modal
        open={!!reason}
        title={reason ? t(`workflow:case.${reason}`) : ''}
        onCancel={() => setReason(null)}
        okButtonProps={{
          disabled: !reasonText.trim(),
          danger: reason === 'cancel',
          loading: action.isPending,
        }}
        onOk={() => reason && void doAction(reason, reasonText.trim())}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {reason ? t(`workflow:case.${reason}Hint`) : ''}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder={t('workflow:case.reason')}
          data-testid="wf-reason"
        />
      </Modal>
    </>
  );
}

const eventColour = (e: CaseEventDto) =>
  e.type === 'INCIDENT'
    ? 'red'
    : e.type === 'COMPLETED'
      ? 'green'
      : e.type === 'TASK_COMPLETED'
        ? e.data.decision === 'REJECT'
          ? 'red'
          : e.data.decision === 'RETURN'
            ? 'orange'
            : 'blue'
        : 'gray';

function EventLine({ e, c }: { e: CaseEventDto; c: CaseDetailDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const who = e.user ? loc(e.user) || e.user.email : '';
  const step = loc(e);
  const decision =
    typeof e.data.decision === 'string' ? t(`workflow:decision.${e.data.decision}`) : '';
  void c;
  return (
    <div data-testid={`event-${e.type}`}>
      <div>
        {t(`workflow:events.${e.type}`, { step, who, decision })}
        {e.type === 'INCIDENT' && typeof e.data.code === 'string' && (
          <Typography.Text type="danger">
            {' '}
            — {t(`errors:${e.data.code}`, { defaultValue: String(e.data.message ?? e.data.code) })}
          </Typography.Text>
        )}
      </div>
      {typeof e.data.comment === 'string' && e.data.comment && (
        <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
          “{e.data.comment}”
        </Typography.Text>
      )}
      {typeof e.data.reason === 'string' && e.data.reason && (
        <Typography.Text type="secondary">“{e.data.reason}”</Typography.Text>
      )}
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatDate(e.at)}
        </Typography.Text>
      </div>
    </div>
  );
}
