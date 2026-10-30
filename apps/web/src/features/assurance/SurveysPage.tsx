import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Progress, Space, Table, Tabs, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useCampaigns, useQuestionnaires } from '@/api/assurance';
import { PageHeader } from '@/components/PageHeader';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { CampaignFormModal } from './CampaignFormModal';
import { CampaignStatusTag } from './assurance-tags';

/** Questionnaires and survey campaigns. */
export function SurveysPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'campaigns';
  const campaigns = useCampaigns({});
  const questionnaires = useQuestionnaires();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t('assurance:surveys.title') }]}
        title={t('assurance:surveys.title')}
        subtitle={t('assurance:surveys.subtitle')}
        extra={
          <Space>
            <Button
              icon={<PlusOutlined />}
              data-testid="new-questionnaire"
              onClick={() => navigate('/grc/surveys/questionnaires/new')}
            >
              {t('assurance:surveys.newQuestionnaire')}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              data-testid="new-campaign"
              onClick={() => setCreating(true)}
            >
              {t('assurance:surveys.newCampaign')}
            </Button>
          </Space>
        }
      />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams({ tab: k })}
          items={[
            {
              key: 'campaigns',
              label: t('assurance:surveys.campaigns'),
              children: (
                <Table
                  rowKey="id"
                  data-testid="campaigns"
                  loading={campaigns.isFetching}
                  dataSource={campaigns.data ?? []}
                  pagination={{ pageSize: 20 }}
                  columns={[
                    {
                      title: t('assurance:surveys.campaign'),
                      render: (_, c) => (
                        <Link to={`/grc/surveys/campaigns/${c.id}`}>{loc(c, 'title')}</Link>
                      ),
                    },
                    {
                      title: t('assurance:surveys.purpose'),
                      render: (_, c) => <Tag>{t(`assurance:surveys.purposes.${c.purpose}`)}</Tag>,
                    },
                    {
                      title: t('assurance:issues.statusLabel'),
                      render: (_, c) => <CampaignStatusTag status={c.status} />,
                    },
                    {
                      title: t('assurance:surveys.period'),
                      render: (_, c) =>
                        `${formatDate(c.startAt, false)} – ${formatDate(c.endAt, false)}`,
                    },
                    {
                      title: t('assurance:surveys.responseRate'),
                      render: (_, c) => (
                        <Progress
                          size="small"
                          percent={c.responseRate}
                          format={() =>
                            `${c.counts.SUBMITTED}/${c.counts.SENT + c.counts.OPENED + c.counts.SUBMITTED}`
                          }
                          style={{ minWidth: 100 }}
                        />
                      ),
                    },
                    {
                      title: t('assurance:surveys.proposals'),
                      render: (_, c) => c.pendingProposals || '—',
                    },
                  ]}
                />
              ),
            },
            {
              key: 'questionnaires',
              label: t('assurance:surveys.questionnaires'),
              children: (
                <Table
                  rowKey="id"
                  data-testid="questionnaires"
                  loading={questionnaires.isFetching}
                  dataSource={questionnaires.data ?? []}
                  pagination={{ pageSize: 20 }}
                  columns={[
                    {
                      title: t('assurance:surveys.questionnaire'),
                      render: (_, q) => (
                        <Link to={`/grc/surveys/questionnaires/${q.id}`}>{loc(q, 'title')}</Link>
                      ),
                    },
                    {
                      title: t('assurance:surveys.purpose'),
                      render: (_, q) => <Tag>{t(`assurance:surveys.purposes.${q.purpose}`)}</Tag>,
                    },
                    {
                      title: t('assurance:issues.statusLabel'),
                      render: (_, q) => t(`assurance:surveys.qStatus.${q.status}`),
                    },
                    { title: t('assurance:surveys.questions'), dataIndex: 'questionCount' },
                    { title: t('assurance:surveys.campaigns'), dataIndex: 'campaignCount' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
      {creating && <CampaignFormModal onClose={() => setCreating(false)} />}
    </>
  );
}
