import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Flex, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { answerProblems, type Answers } from '@processhub/shared';
import {
  useMyResponse,
  useResponseDiagram,
  useSaveAnswers,
  useUploadAnswerFile,
} from '@/api/assurance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ApiError } from '@/api/client';
import { SurveyForm } from './SurveyForm';
import { XmlDiagram } from './XmlDiagram';

/** Answer a questionnaire (workspace and portal); feedback requests show the draft diagram. */
export function SurveyResponsePage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const q = useMyResponse(id);
  const save = useSaveAnswers(id ?? '');
  const upload = useUploadAnswerFile(id ?? '');
  const diagram = useResponseDiagram(id, !!q.data?.campaign.process);
  const [answers, setAnswers] = useState<Answers>({});
  const [problems, setProblems] = useState<{ questionId: string; code: string }[]>([]);
  useEffect(() => {
    if (q.data) setAnswers(q.data.answers);
  }, [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const c = r.campaign;
  const submit = (final: boolean) => {
    if (final) {
      const p = answerProblems(c.definition, answers);
      setProblems(p);
      if (p.length) {
        message.error(t('assurance:surveys.fixProblems'));
        return;
      }
    }
    save.mutate(
      { answers, submit: final },
      {
        onSuccess: () =>
          message.success(t(final ? 'assurance:surveys.submitted' : 'assurance:surveys.saved')),
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'ANSWERS_INVALID')
            setProblems(
              (e.details as { problems?: { questionId: string; code: string }[] })?.problems ?? [],
            );
          message.error(errorMessage(e));
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        crumbs={
          portal
            ? [
                { title: t('assurance:portal.tasks'), to: '/portal/tasks' },
                { title: loc(c, 'title') },
              ]
            : [{ title: t('nav.tasks'), to: '/tasks' }, { title: loc(c, 'title') }]
        }
        title={loc(c, 'title')}
        subtitle={
          c.endAt ? t('assurance:surveys.dueBy', { date: formatDate(c.endAt, false) }) : undefined
        }
      />
      {loc(c, 'description') && (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {loc(c, 'description')}
        </Typography.Paragraph>
      )}
      {r.status === 'SUBMITTED' && (
        <Alert
          type="success"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('assurance:surveys.thanks', { date: formatDate(r.submittedAt) })}
        />
      )}
      {!r.canAnswer && r.status !== 'SUBMITTED' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('assurance:surveys.closed')}
        />
      )}
      {c.process && (
        <Card
          size="small"
          style={{ marginBlockEnd: 16 }}
          title={
            <Space wrap>
              {t('assurance:surveys.diagramOf')}
              <span dir="ltr">{c.process.code}</span>
              {loc(c.process)}
            </Space>
          }
        >
          {diagram.data?.bpmnXml ? (
            <XmlDiagram xml={diagram.data.bpmnXml} />
          ) : (
            <Typography.Text type="secondary">{t('assurance:surveys.noDiagram')}</Typography.Text>
          )}
        </Card>
      )}
      <SurveyForm
        definition={c.definition}
        answers={answers}
        onChange={setAnswers}
        disabled={!r.canAnswer}
        files={r.files}
        onUpload={(file) => upload.mutateAsync(file)}
        problems={problems}
      />
      {r.canAnswer && (
        <Flex gap={8} justify="flex-end">
          <Button loading={save.isPending} onClick={() => submit(false)}>
            {t('assurance:surveys.saveDraft')}
          </Button>
          <Button
            type="primary"
            data-testid="survey-submit"
            loading={save.isPending}
            onClick={() => submit(true)}
          >
            {t('assurance:surveys.submit')}
          </Button>
        </Flex>
      )}
    </>
  );
}
