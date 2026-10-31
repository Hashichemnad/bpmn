import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, Col, Descriptions, Dropdown, List, Row, Space, Typography } from 'antd';
import {
  BranchesOutlined,
  DownOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { usePortalProcess } from '@/api/portal';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { CategoryTag } from '@/components/tags';
import { useLocalized } from '@/components/i18n-helpers';
import { FeedbackButton } from './FeedbackButton';
import { PortalDiagram } from './PortalDiagram';
import type { StepInfo } from './step-info';
import { PortalMeta } from './PortalMeta';
import { extractBpmnLabels } from '@processhub/shared';
import { StepDetails } from './StepDetails';
import { PortalKpis } from '@/features/kpi/PortalKpis';
import { PortalPerformance } from '@/features/mining/PortalPerformance';
import { portalItemLink } from './portal-links';
import { ReportDialog, type ReportKind } from '@/features/reports/ReportDialog';

/** A published process: official version, diagram with step details, sub-processes, documentation. */
export function PortalProcessPage() {
  const { processId } = useParams<{ processId: string }>();
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const process = usePortalProcess(processId);
  const [step, setStep] = useState<StepInfo | null>(null);
  const [report, setReport] = useState<ReportKind | null>(null);
  const selectedId = step?.id ?? params.get('step');

  if (process.isLoading) return <LoadingState />;
  if (process.isError || !process.data) {
    return <ErrorState error={process.error} onRetry={() => void process.refetch()} />;
  }
  const p = process.data;
  // Step names of the published diagram (KPI list).
  const stepLabels = p.kpis?.length && p.bpmnXml ? extractBpmnLabels(p.bpmnXml) : null;
  const stepName = (id: string) => {
    const l = stepLabels?.get(id);
    return (l && loc({ nameEn: l.nameEn || l.name, nameAr: l.nameAr })) || id;
  };
  const select = (s: StepInfo | null) => {
    setStep(s);
    setParams(s ? { step: s.id } : {}, { replace: true });
  };

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('portal:nav.home'), to: '/portal' },
          { title: t('portal:nav.processes'), to: '/portal/processes' },
          ...p.ancestors.map((a) => ({
            title: `${a.code} ${loc(a)}`,
            to: `/portal/processes/${a.id}`,
          })),
          { title: p.code },
        ]}
        title={
          <Space wrap>
            <span className="ph-title-code" dir="ltr">
              {p.code}
            </span>
            <span>{loc(p)}</span>
          </Space>
        }
        subtitle={<CategoryTag category={p.category} />}
        extra={
          <>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={() =>
                window.open(`/portal/print/processes/${p.id}?lang=${locale}`, '_blank', 'noopener')
              }
            >
              {t('portal:downloadPdf')}
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'handbook',
                    icon: <FileWordOutlined />,
                    label: t('processes:reports.handbook'),
                    onClick: () => setReport('handbook'),
                  },
                  {
                    key: 'raci',
                    icon: <FileExcelOutlined />,
                    label: t('processes:reports.raci'),
                    onClick: () => setReport('raci'),
                  },
                ],
              }}
            >
              <Button>
                {t('processes:reports.menu')} <DownOutlined />
              </Button>
            </Dropdown>
            <FeedbackButton type="PROCESS" id={p.id} />
          </>
        }
      />
      <PortalMeta
        meta={p.meta}
        extra={
          p.department ? (
            <Descriptions.Item label={t('fields.department')}>
              {loc(p.department)}
            </Descriptions.Item>
          ) : undefined
        }
      />
      {loc(p, 'description') && (
        <Typography.Paragraph className="ph-portal-reading" style={{ whiteSpace: 'pre-wrap' }}>
          {loc(p, 'description')}
        </Typography.Paragraph>
      )}
      <Card
        size="small"
        title={t('portal:process.diagram')}
        extra={<Typography.Text type="secondary">{t('portal:process.clickHint')}</Typography.Text>}
      >
        {p.bpmnXml ? (
          <div className="ph-portal-diagram-wrap">
            <PortalDiagram process={p} selectedId={selectedId} onSelect={select} />
            {step && (
              <div className="ph-portal-step-panel">
                <StepDetails step={step} process={p} onClose={() => select(null)} />
              </div>
            )}
          </div>
        ) : (
          <Typography.Text type="secondary">{t('portal:process.noDiagram')}</Typography.Text>
        )}
      </Card>
      <Row gutter={[16, 16]} style={{ marginBlockStart: 16 }}>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <>
                <BranchesOutlined /> {t('portal:process.subProcesses')}
              </>
            }
          >
            <List
              size="small"
              dataSource={p.children}
              locale={{ emptyText: t('portal:process.noSubProcesses') }}
              renderItem={(c) => (
                <List.Item>
                  <Link to={`/portal/processes/${c.id}`}>
                    <span dir="ltr" className="ph-title-code" style={{ marginInlineEnd: 6 }}>
                      {c.code}
                    </span>
                    {loc(c)}
                  </Link>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <>
                <FileTextOutlined /> {t('portal:process.documentation')}
              </>
            }
          >
            <List
              size="small"
              dataSource={p.relatedPages}
              locale={{ emptyText: t('portal:process.noDocumentation') }}
              renderItem={(d) => (
                <List.Item>
                  <Link to={portalItemLink(d)}>{loc(d, 'title')}</Link>
                  {d.space && <Typography.Text type="secondary">{loc(d.space)}</Typography.Text>}
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
      {p.kpis && p.kpis.length > 0 && (
        <div style={{ marginBlockStart: 16 }}>
          <PortalKpis kpis={p.kpis} stepName={stepName} />
        </div>
      )}
      <div style={{ marginBlockStart: 16 }}>
        <PortalPerformance processId={p.id} />
      </div>
      {report && (
        <ReportDialog
          kind={report}
          process={p}
          hasChildren={p.children.length > 0}
          publishedOnly
          onClose={() => setReport(null)}
        />
      )}
    </>
  );
}
