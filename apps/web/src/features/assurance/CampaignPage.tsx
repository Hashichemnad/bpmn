import { useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Progress,
  Space,
  Statistic,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type Question } from '@processhub/shared';
import {
  useCampaign,
  useCampaignAction,
  useCampaignProposals,
  useCampaignResults,
} from '@/api/assurance';
import { apiDownload } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { downloadBlob } from '@/features/modeler/export';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { CampaignStatusTag } from './assurance-tags';

/** A campaign: launch / close, response tracking, results, Excel export, RCSA proposals. */
export function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const q = useCampaign(id);
  const results = useCampaignResults(id);
  const proposals = useCampaignProposals(
    id,
    q.data?.purpose === 'RCSA' || (q.data?.pendingProposals ?? 0) > 0,
  );
  const act = useCampaignAction();
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const onError = (e: unknown) => message.error(errorMessage(e));
  const questions = c.definition.sections.flatMap((s) => s.questions);
  const exportXlsx = async (locale: 'en' | 'ar') => {
    try {
      const file = await apiDownload(
        `/surveys/campaigns/${c.id}/export`,
        { query: { locale } },
        `survey-${locale}.xlsx`,
      );
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      onError(e);
    }
  };
  const optionLabel = (q: Question, key: string) => {
    const o = q.options.find((x) => x.id === key);
    if (o) return loc({ nameEn: o.en, nameAr: o.ar });
    if (q.type === 'YES_NO_NA') return t(`assurance:surveys.yesNo.${key}`);
    return key;
  };
  const total = c.responses.length;

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.grcGroup') },
          {
            title: t('assurance:surveys.title'),
            to: can(PERMISSIONS.SURVEYS_MANAGE) ? '/grc/surveys' : undefined,
          },
          { title: loc(c, 'title') },
        ]}
        title={loc(c, 'title')}
        subtitle={
          <Space wrap>
            <CampaignStatusTag status={c.status} />
            {t(`assurance:surveys.purposes.${c.purpose}`)}
          </Space>
        }
        extra={
          <Space wrap>
            {c.status === 'DRAFT' && (
              <Button
                type="primary"
                data-testid="campaign-launch"
                loading={act.isPending}
                onClick={() => act.mutate({ kind: 'launch', id: c.id }, { onError })}
              >
                {t('assurance:surveys.launch')}
              </Button>
            )}
            {c.status === 'OPEN' && (
              <Button onClick={() => act.mutate({ kind: 'close', id: c.id }, { onError })}>
                {t('assurance:surveys.close')}
              </Button>
            )}
            <Button icon={<DownloadOutlined />} onClick={() => void exportXlsx('en')}>
              Excel (EN)
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void exportXlsx('ar')}>
              Excel (AR)
            </Button>
          </Space>
        }
      />
      <Card style={{ marginBlockEnd: 16 }}>
        <Space size={48} wrap>
          <Statistic
            title={t('assurance:surveys.responseRate')}
            value={c.responseRate}
            suffix="%"
          />
          <Statistic title={t('assurance:surveys.progress.SENT')} value={c.counts.SENT} />
          <Statistic title={t('assurance:surveys.progress.OPENED')} value={c.counts.OPENED} />
          <Statistic title={t('assurance:surveys.progress.SUBMITTED')} value={c.counts.SUBMITTED} />
          {results.data?.averageScorePercent !== null &&
            results.data?.averageScorePercent !== undefined && (
              <Statistic
                title={t('assurance:surveys.averageScore')}
                value={results.data.averageScorePercent}
                suffix="%"
              />
            )}
        </Space>
        <Descriptions
          size="small"
          style={{ marginBlockStart: 16 }}
          column={{ xs: 1, md: 2 }}
          items={[
            {
              key: 'period',
              label: t('assurance:surveys.period'),
              children: `${formatDate(c.startAt, false)} – ${formatDate(c.endAt, false)}`,
            },
            {
              key: 'aud',
              label: t('assurance:surveys.audience'),
              children:
                [
                  ...c.audienceLabels.users.map((u) => loc(u) || u.email),
                  ...c.audience.roleKeys.map((r) => t(`admin:roles.${r}`)),
                  ...c.audienceLabels.departments.map((d) => loc(d)),
                ].join(', ') || '—',
            },
            ...(c.process
              ? [
                  {
                    key: 'p',
                    label: t('assurance:surveys.forProcess'),
                    children: `${c.process.code ?? ''} ${loc(c.process)}`,
                  },
                ]
              : []),
            ...(c.department
              ? [
                  {
                    key: 'd',
                    label: t('assurance:surveys.forDepartment'),
                    children: loc(c.department),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <Card>
        <Tabs
          items={[
            {
              key: 'results',
              label: t('assurance:surveys.results'),
              children:
                !results.data || !c.counts.SUBMITTED ? (
                  <Empty description={t('assurance:surveys.noAnswers')} />
                ) : (
                  <Space
                    direction="vertical"
                    style={{ width: '100%' }}
                    data-testid="survey-results"
                  >
                    {questions.map((qq) => {
                      const r = results.data!.questions.find((x) => x.questionId === qq.id);
                      if (!r) return null;
                      return (
                        <Card
                          key={qq.id}
                          size="small"
                          title={loc({ nameEn: qq.textEn, nameAr: qq.textAr })}
                          extra={`${t('assurance:surveys.answers')}: ${r.answered}`}
                        >
                          {r.average !== null && (
                            <Typography.Paragraph>
                              {t('assurance:surveys.average')}: {r.average}
                            </Typography.Paragraph>
                          )}
                          {Object.entries(r.counts).map(([k, n]) => (
                            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ minWidth: 160 }}>{optionLabel(qq, k)}</span>
                              <Progress
                                percent={r.answered ? Math.round((n / r.answered) * 100) : 0}
                                format={() => n}
                                style={{ flex: 1 }}
                              />
                            </div>
                          ))}
                          {r.texts.map((x, i) => (
                            <Typography.Paragraph
                              key={i}
                              style={{ whiteSpace: 'pre-wrap', marginBlock: 4 }}
                            >
                              “{x}”
                            </Typography.Paragraph>
                          ))}
                          {r.files > 0 && (
                            <Typography.Text type="secondary">
                              {t('assurance:surveys.filesCount', { count: r.files })}
                            </Typography.Text>
                          )}
                        </Card>
                      );
                    })}
                  </Space>
                ),
            },
            {
              key: 'responses',
              label: `${t('assurance:surveys.responses')} (${total})`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={c.responses}
                  pagination={{ pageSize: 25 }}
                  data-testid="campaign-responses"
                  columns={[
                    {
                      title: t('assurance:surveys.respondent'),
                      render: (_, r) => loc(r.user) || r.user.email,
                    },
                    {
                      title: t('assurance:issues.statusLabel'),
                      render: (_, r) => t(`assurance:surveys.progress.${r.status}`),
                    },
                    {
                      title: t('assurance:surveys.submittedAt'),
                      render: (_, r) => formatDate(r.submittedAt),
                    },
                    {
                      title: t('assurance:surveys.score'),
                      render: (_, r) =>
                        r.maxScore ? `${Math.round(((r.score ?? 0) / r.maxScore) * 100)}%` : '—',
                    },
                  ]}
                />
              ),
            },
            ...(proposals.data?.length
              ? [
                  {
                    key: 'proposals',
                    label: `${t('assurance:surveys.proposals')} (${c.pendingProposals})`,
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        dataSource={proposals.data}
                        pagination={false}
                        data-testid="campaign-proposals"
                        columns={[
                          {
                            title: t('assurance:changes.item'),
                            render: (_, p) => (
                              <>
                                {p.object.code && <span dir="ltr">{p.object.code} </span>}
                                {loc(p.object)}
                              </>
                            ),
                          },
                          {
                            title: t('assurance:changes.field'),
                            render: (_, p) => t(`assurance:surveys.fields.${p.field}`),
                          },
                          {
                            title: t('assurance:changes.before'),
                            render: (_, p) =>
                              p.field === 'EFFECTIVENESS' && p.current
                                ? t(`grc:effectiveness.${p.current}`)
                                : (p.current ?? '—'),
                          },
                          {
                            title: t('assurance:changes.after'),
                            render: (_, p) =>
                              p.field === 'EFFECTIVENESS'
                                ? t(`grc:effectiveness.${p.value}`)
                                : p.value,
                          },
                          {
                            title: t('assurance:surveys.respondent'),
                            render: (_, p) =>
                              p.respondent ? loc(p.respondent) || p.respondent.email : '—',
                          },
                          {
                            key: 'act',
                            render: (_, p) =>
                              p.status === 'PENDING'
                                ? can(PERMISSIONS.GRC_EDIT) && (
                                    <Space>
                                      <Button
                                        size="small"
                                        type="primary"
                                        data-testid={`accept-${p.questionId}`}
                                        onClick={() =>
                                          act.mutate(
                                            { kind: 'decide', id: p.id, decision: 'ACCEPT' },
                                            { onError },
                                          )
                                        }
                                      >
                                        {t('assurance:surveys.accept')}
                                      </Button>
                                      <Button
                                        size="small"
                                        onClick={() =>
                                          act.mutate(
                                            { kind: 'decide', id: p.id, decision: 'DISMISS' },
                                            { onError },
                                          )
                                        }
                                      >
                                        {t('assurance:surveys.dismiss')}
                                      </Button>
                                    </Space>
                                  )
                                : t(`assurance:surveys.proposalStatus.${p.status}`),
                          },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </>
  );
}
