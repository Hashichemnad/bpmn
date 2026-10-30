import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  SAMPLE_RESULTS,
  STEP_RESULTS,
  TEST_CONCLUSIONS,
  suggestConclusion,
  type TestConclusion,
  type TestSample,
} from '@processhub/shared';
import { useControlTest, useControlTestAction } from '@/api/assurance';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useLocale } from '@/app/LocaleProvider';
import { EvidenceList } from './EvidenceList';
import { EventsTimeline } from './EventsTimeline';
import { AssigneeLabel, ConclusionTag, TestStatusTag } from './assurance-tags';

/** Execute, submit and review one control test (samples × steps, conclusion, evidence). */
export function ControlTestPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const q = useControlTest(id);
  const action = useControlTestAction(id ?? '');
  const [samples, setSamples] = useState<TestSample[]>([]);
  const [conclusion, setConclusion] = useState<TestConclusion | null>(null);
  const [comment, setComment] = useState('');
  const [review, setReview] = useState<'APPROVE' | 'RETURN' | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data && !dirty) {
      setSamples(q.data.samples);
      setConclusion(q.data.conclusion);
      setComment(q.data.testerComment);
    }
  }, [q.data, dirty]);

  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const test = q.data;
  const editable = test.can.execute && test.status !== 'PLANNED';
  const steps = test.procedure;
  const stepText = (s: { en: string; ar: string }) =>
    locale === 'ar' ? s.ar || s.en : s.en || s.ar;
  const onError = (e: unknown) => message.error(errorMessage(e));
  const run = (a: Parameters<typeof action.mutate>[0], ok?: string) =>
    action.mutateAsync(a).then(
      (r) => {
        if (ok) message.success(ok);
        return r;
      },
      (e) => {
        onError(e);
        throw e;
      },
    );
  const save = () =>
    run(
      { action: 'results', body: { samples, conclusion, testerComment: comment } },
      t('assurance:tests.saved'),
    ).then(() => setDirty(false));
  const patchSample = (i: number, p: Partial<TestSample>) => {
    setDirty(true);
    setSamples((list) => list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  };
  const suggestion = suggestConclusion(samples);

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.grcGroup') },
          {
            title: t('assurance:tests.title'),
            to: can(PERMISSIONS.GRC_READ) ? '/grc/tests' : undefined,
          },
          { title: `${test.control.code ?? ''} ${test.period}` },
        ]}
        title={
          <Space wrap>
            {test.control.code && <span dir="ltr">{test.control.code}</span>}
            {loc(test.control)}
          </Space>
        }
        subtitle={
          <Space wrap>
            <Tag>{t(`assurance:tests.types.${test.testType}`)}</Tag>
            <span>{test.period}</span>
            <TestStatusTag status={test.status} />
            {test.overdue && <Tag color="red">{t('assurance:overdue')}</Tag>}
          </Space>
        }
        extra={
          <Flex gap={8} wrap="wrap">
            {test.can.execute && test.status === 'PLANNED' && (
              <Button
                type="primary"
                data-testid="test-start"
                onClick={() => void run({ action: 'start' })}
              >
                {t('assurance:tests.start')}
              </Button>
            )}
            {editable && (
              <>
                <Button data-testid="test-save" disabled={!dirty} onClick={() => void save()}>
                  {t('save')}
                </Button>
                <Button
                  type="primary"
                  data-testid="test-submit"
                  onClick={() =>
                    void (dirty ? save() : Promise.resolve()).then(() =>
                      run({ action: 'submit' }, t('assurance:tests.submitted')),
                    )
                  }
                >
                  {t('assurance:tests.submit')}
                </Button>
              </>
            )}
            {test.can.review && (
              <>
                <Button
                  type="primary"
                  data-testid="test-approve"
                  onClick={() => setReview('APPROVE')}
                >
                  {t('assurance:tests.approve')}
                </Button>
                <Button danger onClick={() => setReview('RETURN')}>
                  {t('assurance:tests.return')}
                </Button>
              </>
            )}
            {test.can.close && (
              <Button onClick={() => void run({ action: 'close' })}>
                {t('assurance:tests.close')}
              </Button>
            )}
            {test.can.manage && test.status === 'PLANNED' && (
              <Button
                danger
                onClick={() => void run({ action: 'delete' }).then(() => navigate('/grc/tests'))}
              >
                {t('delete')}
              </Button>
            )}
          </Flex>
        }
      />
      {test.status === 'RETURNED' && test.reviewComment && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('assurance:tests.returnedBy', {
            name: test.reviewedBy ? loc(test.reviewedBy) : '',
          })}
          description={test.reviewComment}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title={t('assurance:tests.procedure')} style={{ marginBlockEnd: 16 }}>
            {steps.length ? (
              <ol style={{ paddingInlineStart: 20, margin: 0 }}>
                {steps.map((s, i) => (
                  <li key={i}>{stepText(s)}</li>
                ))}
              </ol>
            ) : (
              <Typography.Text type="secondary">{t('assurance:tests.noProcedure')}</Typography.Text>
            )}
          </Card>
          <Card title={t('assurance:tests.samples')} style={{ marginBlockEnd: 16 }}>
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              scroll={{ x: true }}
              data-testid="test-samples"
              dataSource={samples}
              columns={[
                {
                  title: t('assurance:tests.sampleRef'),
                  render: (_, s, i) =>
                    editable ? (
                      <Input
                        size="small"
                        value={s.ref}
                        onChange={(e) => patchSample(i, { ref: e.target.value })}
                        style={{ width: 120 }}
                      />
                    ) : (
                      s.ref
                    ),
                },
                ...steps.map((st, k) => ({
                  title: `${k + 1}`,
                  key: `s${k}`,
                  render: (_: unknown, s: TestSample, i: number) =>
                    editable ? (
                      <Select
                        size="small"
                        allowClear
                        style={{ width: 90 }}
                        value={s.steps[k] ?? undefined}
                        title={stepText(st)}
                        onChange={(v) =>
                          patchSample(i, {
                            steps: s.steps.map((x, j) => (j === k ? (v ?? null) : x)),
                          })
                        }
                        options={STEP_RESULTS.map((r) => ({
                          value: r,
                          label: t(`assurance:tests.step.${r}`),
                        }))}
                      />
                    ) : (
                      (s.steps[k] && t(`assurance:tests.step.${s.steps[k]}`)) || '—'
                    ),
                })),
                {
                  title: t('assurance:tests.sampleResult'),
                  render: (_, s, i) =>
                    editable ? (
                      <Select
                        size="small"
                        style={{ width: 130 }}
                        data-testid={`sample-result-${i}`}
                        value={s.result ?? undefined}
                        onChange={(v) => patchSample(i, { result: v })}
                        options={SAMPLE_RESULTS.map((r) => ({
                          value: r,
                          label: t(`assurance:tests.result.${r}`),
                        }))}
                      />
                    ) : s.result ? (
                      t(`assurance:tests.result.${s.result}`)
                    ) : (
                      '—'
                    ),
                },
                {
                  title: t('assurance:tests.note'),
                  render: (_, s, i) =>
                    editable ? (
                      <Input
                        size="small"
                        value={s.note}
                        onChange={(e) => patchSample(i, { note: e.target.value })}
                      />
                    ) : (
                      s.note || '—'
                    ),
                },
              ]}
            />
            {editable && (
              <Button
                size="small"
                style={{ marginBlockStart: 8 }}
                onClick={() => {
                  setDirty(true);
                  setSamples((l) => [
                    ...l,
                    {
                      ref: `#${l.length + 1}`,
                      steps: steps.map(() => null),
                      result: null,
                      note: '',
                    },
                  ]);
                }}
              >
                {t('assurance:tests.addSample')}
              </Button>
            )}
          </Card>
          <Card title={t('assurance:tests.conclusionLabel')} style={{ marginBlockEnd: 16 }}>
            {editable ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  style={{ width: 300 }}
                  data-testid="test-conclusion"
                  value={conclusion ?? undefined}
                  onChange={(v) => {
                    setDirty(true);
                    setConclusion(v);
                  }}
                  options={TEST_CONCLUSIONS.map((c) => ({
                    value: c,
                    label: t(`assurance:tests.conclusion.${c}`),
                  }))}
                />
                {suggestion && suggestion !== conclusion && (
                  <Typography.Text type="secondary">
                    {t('assurance:tests.suggested', {
                      value: t(`assurance:tests.conclusion.${suggestion}`),
                    })}
                  </Typography.Text>
                )}
                <Input.TextArea
                  value={comment}
                  placeholder={t('assurance:tests.testerComment')}
                  autoSize={{ minRows: 2 }}
                  onChange={(e) => {
                    setDirty(true);
                    setComment(e.target.value);
                  }}
                />
              </Space>
            ) : (
              <Space direction="vertical">
                <ConclusionTag value={test.conclusion} />
                {test.testerComment && (
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                    {test.testerComment}
                  </Typography.Paragraph>
                )}
                {test.reviewComment && (
                  <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                    {t('assurance:tests.reviewComment')}: {test.reviewComment}
                  </Typography.Paragraph>
                )}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card style={{ marginBlockEnd: 16 }}>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: 'control',
                  label: t('assurance:tests.control'),
                  children: can(PERMISSIONS.GRC_READ) ? (
                    <Link to={`/grc/controls/${test.control.id}`}>{loc(test.control)}</Link>
                  ) : (
                    loc(test.control)
                  ),
                },
                {
                  key: 'due',
                  label: t('assurance:tests.due'),
                  children: formatDate(test.dueAt, false),
                },
                {
                  key: 'tester',
                  label: t('assurance:tests.tester'),
                  children: test.executedBy ? (
                    loc(test.executedBy) || test.executedBy.email
                  ) : (
                    <AssigneeLabel value={test.tester} />
                  ),
                },
                {
                  key: 'reviewer',
                  label: t('assurance:tests.reviewer'),
                  children: test.reviewedBy ? (
                    loc(test.reviewedBy) || test.reviewedBy.email
                  ) : (
                    <AssigneeLabel value={test.reviewer} />
                  ),
                },
                { key: 'size', label: t('assurance:tests.sampleSize'), children: test.sampleSize },
                {
                  key: 'origin',
                  label: t('assurance:tests.origin'),
                  children: t(`assurance:tests.origins.${test.origin}`),
                },
              ]}
            />
          </Card>
          <Card title={t('assurance:evidence.title')} style={{ marginBlockEnd: 16 }}>
            <EvidenceList
              files={test.files}
              canAdd={test.can.execute}
              uploading={action.isPending}
              onUpload={(file) => action.mutateAsync({ action: 'files', body: file })}
            />
          </Card>
          <EventsTimeline
            events={test.events}
            statusNs="assurance:tests.status"
            commenting={action.isPending}
            onComment={(body) => run({ action: 'comments', body: { body } })}
          />
        </Col>
      </Row>
      {review && (
        <Modal
          open
          title={t(review === 'APPROVE' ? 'assurance:tests.approve' : 'assurance:tests.return')}
          onCancel={() => setReview(null)}
          okButtonProps={{
            disabled: review === 'RETURN' && !reviewComment.trim(),
            danger: review === 'RETURN',
          }}
          confirmLoading={action.isPending}
          onOk={() =>
            void run(
              { action: 'review', body: { decision: review, comment: reviewComment } },
              t(review === 'APPROVE' ? 'assurance:tests.reviewed' : 'assurance:tests.returned'),
            ).then(() => setReview(null))
          }
        >
          {review === 'APPROVE' && (
            <Alert
              type="info"
              showIcon
              style={{ marginBlockEnd: 12 }}
              message={t('assurance:tests.approveHint', {
                value: t(`assurance:tests.conclusion.${test.conclusion}`),
              })}
            />
          )}
          <Input.TextArea
            value={reviewComment}
            data-testid="review-comment"
            autoSize={{ minRows: 3 }}
            placeholder={t(
              review === 'RETURN'
                ? 'assurance:tests.returnReason'
                : 'assurance:tests.reviewComment',
            )}
            onChange={(e) => setReviewComment(e.target.value)}
          />
        </Modal>
      )}
    </>
  );
}
