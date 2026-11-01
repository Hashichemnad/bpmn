import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Slider,
  Space,
  Table,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import {
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  type IssueAction,
  type IssueActionDto,
} from '@processhub/shared';
import { useIssue, useIssueAction } from '@/api/assurance';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { EvidenceList } from './EvidenceList';
import { EventsTimeline } from './EventsTimeline';
import { IssueFormModal } from './IssueFormModal';
import { IssueStatusTag, SeverityTag } from './assurance-tags';

const COMMENT_ACTIONS: IssueAction[] = ['ACCEPT_RISK', 'REJECT_VERIFICATION', 'REOPEN'];

/** An issue with its action plan, evidence, lifecycle and history (workspace and portal). */
export function IssuePage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const q = useIssue(id);
  const act = useIssueAction(id ?? '');
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState<IssueAction | null>(null);
  const [comment, setComment] = useState('');
  const [actionForm, setActionForm] = useState<IssueActionDto | 'new' | null>(null);
  const [form] = Form.useForm<{
    titleEn?: string;
    titleAr?: string;
    ownerId?: string | null;
    dueAt?: Dayjs | null;
  }>();

  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const issue = q.data;
  const onError = (e: unknown) => message.error(errorMessage(e));
  const grc = can(PERMISSIONS.GRC_READ) && !portal;
  const ref = (
    path: string,
    r: { id: string; code: string | null; nameEn: string; nameAr: string } | null,
  ) =>
    r ? (
      grc ? (
        <Link to={`${path}/${r.id}`}>{[r.code, loc(r)].filter(Boolean).join(' ')}</Link>
      ) : (
        [r.code, loc(r)].filter(Boolean).join(' ')
      )
    ) : (
      '—'
    );

  const doTransition = (action: IssueAction, text = '') =>
    act.mutate(
      { kind: 'transition', body: { action, comment: text } },
      {
        onSuccess: () => {
          message.success(t(`assurance:issues.done.${action}`));
          setStep(null);
          setComment('');
        },
        onError,
      },
    );

  const openActionForm = (a: IssueActionDto | 'new') => {
    setActionForm(a);
    form.resetFields();
    if (a !== 'new')
      form.setFieldsValue({
        titleEn: a.titleEn,
        titleAr: a.titleAr,
        ownerId: a.owner?.id ?? null,
        dueAt: a.dueAt ? dayjs(a.dueAt) : null,
      });
  };
  const saveAction = (v: {
    titleEn?: string;
    titleAr?: string;
    ownerId?: string | null;
    dueAt?: Dayjs | null;
  }) => {
    const body = {
      ...v,
      ownerId: v.ownerId ?? null,
      dueAt: v.dueAt ? v.dueAt.format('YYYY-MM-DD') : null,
    };
    act.mutate(
      actionForm === 'new'
        ? { kind: 'addAction', body }
        : { kind: 'updateAction', actionId: (actionForm as IssueActionDto).id, body },
      { onSuccess: () => setActionForm(null), onError },
    );
  };

  return (
    <>
      <PageHeader
        crumbs={
          portal
            ? [{ title: t('assurance:portal.tasks'), to: '/portal/tasks' }, { title: issue.code }]
            : [
                { title: t('nav.grcGroup') },
                {
                  title: t('assurance:issues.title'),
                  to: can(PERMISSIONS.GRC_READ) ? '/grc/issues' : undefined,
                },
                { title: issue.code },
              ]
        }
        title={
          <Space wrap>
            <span dir="ltr">{issue.code}</span>
            {loc(issue, 'title')}
          </Space>
        }
        subtitle={
          <Space wrap>
            <SeverityTag value={issue.severity} />
            <IssueStatusTag status={issue.status} />
            {issue.overdue && (
              <Typography.Text type="danger">{t('assurance:overdue')}</Typography.Text>
            )}
            {issue.escalatedAt && (
              <Typography.Text type="danger">{t('assurance:issues.escalated')}</Typography.Text>
            )}
          </Space>
        }
        extra={
          <Flex gap={8} wrap="wrap">
            {issue.canEdit && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            {issue.allowed.map((a) => (
              <Button
                key={a}
                data-testid={`issue-${a}`}
                type={a === 'READY' || a === 'VERIFY' ? 'primary' : 'default'}
                danger={a === 'ACCEPT_RISK'}
                loading={act.isPending}
                onClick={() => (COMMENT_ACTIONS.includes(a) ? setStep(a) : doTransition(a))}
              >
                {t(`assurance:issues.action.${a}`)}
              </Button>
            ))}
          </Flex>
        }
      />
      {issue.status === 'ACCEPTED_RISK' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('assurance:issues.acceptedBy', {
            name: issue.acceptedBy ? loc(issue.acceptedBy) || issue.acceptedBy.email : '—',
            date: formatDate(issue.acceptedAt, false),
          })}
          description={issue.acceptanceJustification}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card style={{ marginBlockEnd: 16 }}>
            {loc(issue, 'description') && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {loc(issue, 'description')}
              </Typography.Paragraph>
            )}
            <Descriptions
              size="small"
              column={{ xs: 1, md: 2 }}
              items={[
                {
                  key: 'source',
                  label: t('assurance:issues.source'),
                  children:
                    issue.sourceLink && !portal ? (
                      <Link to={issue.sourceLink}>
                        {t(`assurance:issues.sources.${issue.sourceType}`)}
                      </Link>
                    ) : (
                      t(`assurance:issues.sources.${issue.sourceType}`)
                    ),
                },
                {
                  key: 'owner',
                  label: t('assurance:issues.owner'),
                  children: issue.owner ? loc(issue.owner) || issue.owner.email : '—',
                },
                {
                  key: 'raised',
                  label: t('assurance:issues.raisedBy'),
                  children: `${issue.raisedBy ? loc(issue.raisedBy) || issue.raisedBy.email : '—'} · ${formatDate(issue.createdAt, false)}`,
                },
                {
                  key: 'due',
                  label: t('assurance:issues.due'),
                  children: formatDate(issue.dueAt, false),
                },
                {
                  key: 'age',
                  label: t('assurance:issues.age'),
                  children: t('assurance:issues.days', { count: issue.ageDays }),
                },
                {
                  key: 'process',
                  label: t('assurance:issues.process'),
                  children: issue.process ? (
                    <Space direction="vertical" size={0}>
                      {grc ? (
                        <Link to={`/processes/${issue.process.id}`}>
                          {issue.process.code} {loc(issue.process)}
                        </Link>
                      ) : (
                        `${issue.process.code ?? ''} ${loc(issue.process)}`
                      )}
                      {issue.bpmnElementId && issue.bpmnElementId !== PROCESS_ELEMENT_ID && (
                        <Typography.Text type="secondary">
                          {t('assurance:issues.step')}:{' '}
                          {grc ? (
                            <Link
                              to={`/processes/${issue.process.id}/model?element=${encodeURIComponent(issue.bpmnElementId)}`}
                            >
                              {(issue.elementLabel && loc(issue.elementLabel)) ||
                                issue.bpmnElementId}
                            </Link>
                          ) : (
                            (issue.elementLabel && loc(issue.elementLabel)) || issue.bpmnElementId
                          )}
                        </Typography.Text>
                      )}
                    </Space>
                  ) : (
                    '—'
                  ),
                },
                {
                  key: 'risk',
                  label: t('grc:types.RISK'),
                  children: ref('/grc/risks', issue.risk),
                },
                {
                  key: 'control',
                  label: t('grc:types.CONTROL'),
                  children: ref('/grc/controls', issue.control),
                },
                {
                  key: 'req',
                  label: t('grc:types.REQUIREMENT'),
                  children: ref('/grc/requirements', issue.requirement),
                },
                {
                  key: 'dept',
                  label: t('assurance:issues.department'),
                  children: issue.department ? loc(issue.department) : '—',
                },
                ...(issue.verifiedBy
                  ? [
                      {
                        key: 'ver',
                        label: t('assurance:issues.verifiedBy'),
                        children: `${loc(issue.verifiedBy) || issue.verifiedBy.email} · ${formatDate(issue.verifiedAt, false)}`,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
          <Card
            title={
              <Space>
                {t('assurance:issues.actionPlan')}
                {issue.actionCount > 0 && (
                  <Progress type="circle" size={28} percent={issue.progress} />
                )}
              </Space>
            }
            extra={
              issue.canEdit && (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  data-testid="add-action"
                  onClick={() => openActionForm('new')}
                >
                  {t('assurance:issues.addAction')}
                </Button>
              )
            }
            style={{ marginBlockEnd: 16 }}
          >
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              data-testid="issue-actions"
              dataSource={issue.actions}
              locale={{ emptyText: t('assurance:issues.noActions') }}
              expandable={{
                expandedRowRender: (a) => (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {a.note && (
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                        {a.note}
                      </Typography.Paragraph>
                    )}
                    <EvidenceList
                      testId={`action-evidence-${a.id}`}
                      files={a.files}
                      canAdd={a.canUpdate}
                      onUpload={(file) => act.mutateAsync({ kind: 'file', file, actionId: a.id })}
                    />
                  </Space>
                ),
              }}
              columns={[
                { title: t('assurance:issues.actionTitle'), render: (_, a) => loc(a, 'title') },
                {
                  title: t('assurance:issues.owner'),
                  render: (_, a) => (a.owner ? loc(a.owner) || a.owner.email : '—'),
                },
                {
                  title: t('assurance:issues.due'),
                  render: (_, a) => (
                    <Typography.Text type={a.overdue ? 'danger' : undefined}>
                      {formatDate(a.dueAt, false)}
                    </Typography.Text>
                  ),
                },
                {
                  title: t('assurance:issues.progress'),
                  width: 200,
                  render: (_, a) =>
                    a.canUpdate ? (
                      <Slider
                        data-testid={`action-progress-${a.id}`}
                        min={0}
                        max={100}
                        step={10}
                        defaultValue={a.progress}
                        onChangeComplete={(v) =>
                          act.mutate(
                            { kind: 'updateAction', actionId: a.id, body: { progress: v } },
                            { onError },
                          )
                        }
                      />
                    ) : (
                      <Progress percent={a.progress} size="small" />
                    ),
                },
                {
                  key: 'ops',
                  render: (_, a) =>
                    issue.canEdit && (
                      <Space>
                        <Button
                          size="small"
                          type="text"
                          aria-label={t('edit')}
                          icon={<EditOutlined />}
                          onClick={() => openActionForm(a)}
                        />
                        <Popconfirm
                          title={t('assurance:issues.removeAction')}
                          onConfirm={() =>
                            act.mutate({ kind: 'removeAction', actionId: a.id }, { onError })
                          }
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            aria-label={t('delete')}
                            icon={<DeleteOutlined />}
                          />
                        </Popconfirm>
                      </Space>
                    ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title={t('assurance:evidence.title')} style={{ marginBlockEnd: 16 }}>
            <EvidenceList
              files={issue.files}
              canAdd={issue.canEdit}
              onUpload={(file) => act.mutateAsync({ kind: 'file', file })}
            />
          </Card>
          <EventsTimeline
            events={issue.events}
            statusNs="assurance:issues.status"
            commenting={act.isPending}
            onComment={(body) => act.mutateAsync({ kind: 'comment', body })}
          />
        </Col>
      </Row>
      {editing && <IssueFormModal issue={issue} onClose={() => setEditing(false)} />}
      {step && (
        <Modal
          open
          title={t(`assurance:issues.action.${step}`)}
          onCancel={() => setStep(null)}
          okButtonProps={{ disabled: !comment.trim() }}
          confirmLoading={act.isPending}
          onOk={() => doTransition(step, comment.trim())}
        >
          <Typography.Paragraph type="secondary">
            {t(`assurance:issues.commentHint.${step}`)}
          </Typography.Paragraph>
          <Input.TextArea
            data-testid="issue-comment"
            autoSize={{ minRows: 3 }}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Modal>
      )}
      {actionForm && (
        <Modal
          open
          title={t(
            actionForm === 'new' ? 'assurance:issues.addAction' : 'assurance:issues.editAction',
          )}
          onCancel={() => setActionForm(null)}
          onOk={() => form.submit()}
          confirmLoading={act.isPending}
          destroyOnHidden
        >
          <Form form={form} layout="vertical" onFinish={saveAction} data-testid="action-form">
            <Form.Item name="titleEn" label={t('assurance:issues.titleEn')}>
              <Input dir="ltr" />
            </Form.Item>
            <Form.Item name="titleAr" label={t('assurance:issues.titleAr')}>
              <Input dir="rtl" />
            </Form.Item>
            <Form.Item name="ownerId" label={t('assurance:issues.owner')}>
              <UserSelect
                allowClear
                known={actionForm !== 'new' && actionForm.owner ? [actionForm.owner] : []}
              />
            </Form.Item>
            <Form.Item name="dueAt" label={t('assurance:issues.due')}>
              <DatePicker />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </>
  );
}
