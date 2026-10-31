import { Link } from 'react-router-dom';
import { Alert, App, Button, Card, Col, Row, Space, Statistic, Table, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PROCESS_ELEMENT_ID, PERMISSIONS, type ImpactDto } from '@processhub/shared';
import { useImpact } from '@/api/ea';
import { apiDownload } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { eaStepHref, useEaLabel } from './ea-helpers';

/** "If this application is retired": processes, steps, controls, risks, interfaces and data. */
export function ImpactPanel({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useEaLabel();
  const { locale } = useLocale();
  const { can } = useAuth();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const impact = useImpact(applicationId);
  if (impact.isLoading) return <LoadingState />;
  if (impact.isError || !impact.data)
    return <ErrorState error={impact.error} onRetry={() => void impact.refetch()} />;
  const d = impact.data;
  const grcLink = (x: {
    id: string;
    type: 'RISK' | 'CONTROL';
    code: string | null;
    nameEn: string;
    nameAr: string;
  }) => (
    <Tag key={x.id} color={x.type === 'RISK' ? 'volcano' : 'green'} style={{ marginBlockEnd: 2 }}>
      <Link to={`/grc/${x.type === 'RISK' ? 'risks' : 'controls'}/${x.id}`}>{label(x)}</Link>
    </Tag>
  );
  const exportExcel = async () => {
    try {
      const f = await apiDownload(
        `/ea/applications/${applicationId}/impact/export`,
        { query: { locale } },
        'impact.xlsx',
      );
      downloadBlob(f.blob, f.fileName);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  const tiles: [keyof ImpactDto['summary'], string][] = [
    ['processes', 'ea:impact.processes'],
    ['steps', 'ea:impact.steps'],
    ['controls', 'ea:impact.controls'],
    ['risks', 'ea:impact.risks'],
    ['interfaces', 'ea:fields.interfaces'],
    ['dataObjects', 'ea:fields.dataObjects'],
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }} data-testid="impact-panel">
      <Alert
        type={d.summary.steps ? 'warning' : 'info'}
        showIcon
        message={t('ea:impact.headline', { name: label(d.application) })}
        action={
          <Button icon={<DownloadOutlined />} onClick={() => void exportExcel()}>
            {t('grc:excel.export')}
          </Button>
        }
      />
      <Row gutter={[12, 12]}>
        {tiles
          .filter(([k]) => can(PERMISSIONS.GRC_READ) || (k !== 'controls' && k !== 'risks'))
          .map(([k, text]) => (
            <Col key={k} xs={12} md={8} lg={4}>
              <Card size="small">
                <Statistic title={t(text)} value={d.summary[k]} data-testid={`impact-${k}`} />
              </Card>
            </Col>
          ))}
      </Row>
      <Card title={t('ea:impact.stepsTitle')} size="small">
        <Table
          size="small"
          rowKey={(s) => `${s.process.id}|${s.bpmnElementId}`}
          pagination={false}
          dataSource={d.steps}
          locale={{ emptyText: t('ea:detail.noSteps') }}
          columns={[
            {
              title: t('ea:fields.process'),
              key: 'p',
              render: (_, s) => (
                <Link to={`/processes/${s.process.id}`}>
                  {s.process.code} {loc(s.process)}
                </Link>
              ),
            },
            {
              title: t('ea:fields.step'),
              key: 's',
              render: (_, s) => (
                <Link to={eaStepHref(s)}>
                  {s.bpmnElementId === PROCESS_ELEMENT_ID
                    ? t('ea:fields.wholeProcess')
                    : (s.element && loc(s.element)) || s.bpmnElementId}
                </Link>
              ),
            },
            ...(can(PERMISSIONS.GRC_READ)
              ? [
                  {
                    title: t('ea:trace.risksControls'),
                    key: 'g',
                    render: (_: unknown, s: ImpactDto['steps'][number]) => [
                      ...s.risks.map(grcLink),
                      ...s.controls.map(grcLink),
                    ],
                  },
                ]
              : []),
          ]}
        />
      </Card>
      {can(PERMISSIONS.GRC_READ) && (
        <Card title={t('ea:impact.controlsTitle')} size="small">
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={d.controls}
            locale={{ emptyText: '—' }}
            columns={[
              { title: t('ea:impact.control'), key: 'c', render: (_, c) => grcLink(c) },
              {
                title: t('ea:impact.runsIn'),
                key: 'r',
                width: 160,
                render: (_, c) => (c.runsIn ? t('grc:yes') : t('grc:no')),
              },
              {
                title: t('ea:impact.onSteps'),
                key: 'o',
                width: 160,
                render: (_, c) => c.onSteps,
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
