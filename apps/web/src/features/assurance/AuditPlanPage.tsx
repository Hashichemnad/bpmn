import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, InputNumber, Progress, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type CreateEngagementInput } from '@processhub/shared';
import { useAuditUniverse, useEngagements } from '@/api/assurance';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RatingTag } from '@/features/grc/grc-tags';
import { EngagementFormModal } from './EngagementFormModal';
import { EngagementStatusTag, SeverityTag } from './assurance-tags';

/** Audit management: the annual plan of engagements and the audit universe. */
export function AuditPlanPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || new Date().getFullYear();
  const tab = params.get('tab') ?? 'plan';
  const plan = useEngagements({ year });
  const universe = useAuditUniverse(year);
  const [creating, setCreating] = useState<Partial<CreateEngagementInput> | null>(null);
  const manage = can(PERMISSIONS.AUDIT_MANAGE);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t('assurance:audits.title') }]}
        title={t('assurance:audits.title')}
        subtitle={t('assurance:audits.subtitle')}
        extra={
          <Space wrap>
            {t('assurance:audits.year')}
            <InputNumber
              min={2000}
              max={2100}
              value={year}
              onChange={(v) => v && set('year', String(v))}
            />
            {manage && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating({ year })}>
                {t('assurance:audits.new')}
              </Button>
            )}
          </Space>
        }
      />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => set('tab', k)}
          items={[
            {
              key: 'plan',
              label: t('assurance:audits.plan', { year }),
              children: (
                <Table
                  rowKey="id"
                  data-testid="audit-plan"
                  loading={plan.isFetching}
                  dataSource={plan.data ?? []}
                  pagination={false}
                  locale={{ emptyText: t('assurance:audits.empty') }}
                  columns={[
                    {
                      title: t('assurance:issues.code'),
                      render: (_, e) => (
                        <Link to={`/grc/audits/${e.id}`} dir="ltr">
                          {e.code}
                        </Link>
                      ),
                    },
                    {
                      title: t('assurance:audits.engagement'),
                      render: (_, e) => <Link to={`/grc/audits/${e.id}`}>{loc(e, 'title')}</Link>,
                    },
                    {
                      title: t('assurance:issues.statusLabel'),
                      render: (_, e) => (
                        <Space>
                          <EngagementStatusTag status={e.status} />
                          {e.late && <Tag color="red">{t('assurance:overdue')}</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: t('assurance:audits.plannedDates'),
                      render: (_, e) =>
                        `${formatDate(e.plannedStart, false)} – ${formatDate(e.plannedEnd, false)}`,
                    },
                    {
                      title: t('assurance:audits.lead'),
                      render: (_, e) => (e.lead ? loc(e.lead) || e.lead.email : '—'),
                    },
                    {
                      title: t('assurance:audits.workProgramme'),
                      render: (_, e) =>
                        e.itemCount ? (
                          <Progress
                            size="small"
                            percent={Math.round((e.itemsDone / e.itemCount) * 100)}
                            style={{ minWidth: 90 }}
                          />
                        ) : (
                          '—'
                        ),
                    },
                    {
                      title: t('assurance:audits.findings'),
                      render: (_, e) => (
                        <Space size={2} wrap>
                          {Object.entries(e.findingsByRating).map(([k, n]) => (
                            <span key={k}>
                              <SeverityTag value={k} />×{n}
                            </span>
                          ))}
                          {!e.findingCount && '—'}
                        </Space>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'universe',
              label: t('assurance:audits.universe'),
              children: (
                <>
                  <Typography.Paragraph type="secondary">
                    {t('assurance:audits.universeHint')}
                  </Typography.Paragraph>
                  <Table
                    rowKey={(r) => `${r.kind}:${r.id}`}
                    data-testid="audit-universe"
                    loading={universe.isFetching}
                    dataSource={universe.data ?? []}
                    pagination={{ pageSize: 25 }}
                    columns={[
                      {
                        title: t('assurance:audits.kind'),
                        render: (_, r) => t(`assurance:audits.kinds.${r.kind}`),
                      },
                      {
                        title: t('assurance:audits.auditable'),
                        render: (_, r) => (
                          <>
                            {r.code && <span dir="ltr">{r.code} </span>}
                            {loc(r)}
                          </>
                        ),
                      },
                      {
                        title: t('assurance:audits.priority'),
                        render: (_, r) =>
                          r.priorityScore ? (
                            <RatingTag score={r.priorityScore} band={r.priorityBand} />
                          ) : (
                            <Typography.Text type="secondary">
                              {t('assurance:audits.noRisks')}
                            </Typography.Text>
                          ),
                      },
                      { title: t('assurance:audits.risks'), dataIndex: 'riskCount' },
                      {
                        title: t('assurance:audits.lastAudited'),
                        render: (_, r) => formatDate(r.lastAuditedAt, false),
                      },
                      {
                        title: t('assurance:audits.plannedIn', { year }),
                        render: (_, r) =>
                          r.planned.length ? (
                            <Space size={4} wrap>
                              {r.planned.map((p) => (
                                <Link key={p.id} to={`/grc/audits/${p.id}`} dir="ltr">
                                  {p.code}
                                </Link>
                              ))}
                            </Space>
                          ) : manage ? (
                            <Button
                              size="small"
                              onClick={() =>
                                setCreating({
                                  year,
                                  titleEn: r.nameEn,
                                  titleAr: r.nameAr,
                                  ...(r.kind === 'PROCESS'
                                    ? { processIds: [r.id] }
                                    : { departmentIds: [r.id] }),
                                })
                              }
                            >
                              {t('assurance:audits.planIt')}
                            </Button>
                          ) : (
                            '—'
                          ),
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
      {creating && <EngagementFormModal prefill={creating} onClose={() => setCreating(null)} />}
    </>
  );
}
