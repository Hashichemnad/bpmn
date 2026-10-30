import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Popconfirm,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  CloudOutlined,
  DeleteOutlined,
  EditOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PROCESS_ELEMENT_ID, type KpiMeasurementDto } from '@processhub/shared';
import {
  useDeleteKpi,
  useDeleteMeasurement,
  useKpi,
  useRecalculate,
  useUploadEvidence,
} from '@/api/kpi';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { KpiFormModal } from './KpiFormModal';
import { MeasureModal } from './MeasureModal';
import { KpiChart } from './KpiChart';
import { RagTag } from './kpi-components';
import { useFormatPeriod, useFormatValue, useKpiAccess } from './kpi-helpers';

/** KPI detail: definition, chart of actuals vs target, measurements with evidence, links. */
export function KpiDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const formatValue = useFormatValue();
  const formatPeriod = useFormatPeriod();
  const access = useKpiAccess();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const detail = useKpi(id);
  const remove = useDeleteKpi();
  const removeValue = useDeleteMeasurement(id ?? '');
  const upload = useUploadEvidence(id ?? '');
  const recalculate = useRecalculate(id ?? '');
  const [editing, setEditing] = useState(false);
  const [measuring, setMeasuring] = useState<string | null>(null);

  if (detail.isLoading) return <LoadingState />;
  if (detail.isError || !detail.data)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const d = detail.data;
  const k = d.item;
  const canMeasure =
    access.canMeasure(k) && (k.dataSource === 'MANUAL' || k.dataSource === 'EXCEL');

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('kpi:register.title'), to: '/kpis' }, { title: loc(k) }]}
        title={
          <Space wrap>
            {loc(k)}
            {k.code && (
              <Typography.Text type="secondary" dir="ltr">
                {k.code}
              </Typography.Text>
            )}
            <RagTag rag={k.latest?.rag} />
          </Space>
        }
        subtitle={`${t(`kpi:frequency.${k.frequency}`)} · ${t(`kpi:direction.${k.direction}`)} · ${t(`kpi:dataSource.${k.dataSource}`)}`}
        extra={
          <>
            {canMeasure && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setMeasuring(k.duePeriod)}
              >
                {t('kpi:detail.enterValue')}
              </Button>
            )}
            {access.canEdit && k.dataSource === 'CALCULATED' && (
              <Button
                icon={<ReloadOutlined />}
                loading={recalculate.isPending}
                onClick={() =>
                  recalculate.mutate(undefined, {
                    onError: (err) => message.error(errorMessage(err)),
                  })
                }
              >
                {t('kpi:detail.recalculate')}
              </Button>
            )}
            {access.canEdit && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            {access.canEdit && (
              <Popconfirm
                title={t('kpi:register.deleteConfirm')}
                onConfirm={() =>
                  remove.mutate(k.id, {
                    onSuccess: () => navigate('/kpis'),
                    onError: (err) => message.error(errorMessage(err)),
                  })
                }
              >
                <Button danger icon={<DeleteOutlined />}>
                  {t('delete')}
                </Button>
              </Popconfirm>
            )}
          </>
        }
      />
      {k.due && canMeasure && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('kpi:detail.due', { period: formatPeriod(k.duePeriod) })}
          action={
            <Button size="small" onClick={() => setMeasuring(k.duePeriod)}>
              {t('kpi:detail.enterValue')}
            </Button>
          }
        />
      )}
      {k.salesforceId && (
        <Alert
          type="info"
          showIcon
          icon={<CloudOutlined />}
          style={{ marginBlockEnd: 16 }}
          data-testid="kpi-salesforce"
          message={
            <Space wrap>
              {t('kpi:detail.salesforce')}
              {k.lastSyncedAt && (
                <span>{t('kpi:detail.lastSync', { when: formatDate(k.lastSyncedAt) })}</span>
              )}
              {k.salesforceUrl && (
                <a href={k.salesforceUrl} target="_blank" rel="noopener noreferrer">
                  {t('kpi:detail.openInSalesforce')}
                </a>
              )}
            </Space>
          }
          description={t('kpi:detail.lockedHint')}
        />
      )}
      {k.dataSource === 'CALCULATED' && d.calculatedNow !== null && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('kpi:detail.calculatedNow', { value: formatValue(d.calculatedNow, k.unit) })}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title={t('kpi:fields.trend')} data-testid="kpi-chart-card">
            <KpiChart kpi={k} measurements={d.measurements} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title={t('kpi:detail.definition')}>
            {loc(k, 'description') && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {loc(k, 'description')}
              </Typography.Paragraph>
            )}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t('kpi:fields.formulaEn').split(' (')[0]}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{loc(k, 'formula') || '—'}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.target')}>
                {formatValue(k.target, k.unit)}
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.greenThreshold')}>
                {formatValue(k.greenThreshold ?? k.target, k.unit)}
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.redThreshold')}>
                {formatValue(k.redThreshold, k.unit)}
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.baseline')}>
                {formatValue(k.baseline, k.unit)}
                {k.baselinePeriod && ` (${formatPeriod(k.baselinePeriod)})`}
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.owner')}>
                {k.owner ? loc(k.owner) || k.owner.email : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.department')}>
                {k.department ? loc(k.department) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('kpi:fields.objectives')}>
                {k.objectives.length
                  ? k.objectives.map((o) => (
                      <Tag key={o.id}>{[o.code, loc(o)].filter(Boolean).join(' · ')}</Tag>
                    ))
                  : '—'}
              </Descriptions.Item>
              {k.capabilities.length > 0 && (
                <Descriptions.Item label={t('kpi:fields.capabilities')}>
                  {k.capabilities.map((c) => (
                    <Tag key={c.id}>{loc(c)}</Tag>
                  ))}
                </Descriptions.Item>
              )}
              {k.risks.length > 0 && (
                <Descriptions.Item label={t('kpi:fields.risks')}>
                  {k.risks.map((r) => (
                    <Tag key={r.id} color="volcano">
                      <Link to={`/grc/risks/${r.id}`}>
                        {[r.code, loc(r)].filter(Boolean).join(' · ')}
                      </Link>
                    </Tag>
                  ))}
                </Descriptions.Item>
              )}
              {k.calculatedMetric && (
                <Descriptions.Item label={t('kpi:fields.calculatedMetric')}>
                  {t(`kpi:metric.${k.calculatedMetric}`)}
                  {k.calculatedProcess && (
                    <>
                      {' · '}
                      <Link to={`/processes/${k.calculatedProcess.id}`}>
                        {k.calculatedProcess.code} {loc(k.calculatedProcess)}
                      </Link>
                    </>
                  )}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card title={t('kpi:detail.history')}>
            <Table<KpiMeasurementDto>
              size="small"
              rowKey="id"
              data-testid="kpi-measurements"
              dataSource={[...d.measurements].reverse()}
              pagination={{ pageSize: 12 }}
              locale={{ emptyText: t('kpi:detail.noValues') }}
              columns={[
                {
                  title: t('kpi:fields.period'),
                  key: 'p',
                  render: (_, m) => formatPeriod(m.period),
                },
                {
                  title: t('kpi:fields.actual'),
                  key: 'v',
                  render: (_, m) => (
                    <Typography.Text strong>{formatValue(m.value, k.unit)}</Typography.Text>
                  ),
                },
                {
                  title: t('kpi:fields.target'),
                  key: 't',
                  render: (_, m) => formatValue(m.target, k.unit),
                },
                {
                  title: t('kpi:fields.status'),
                  key: 'r',
                  render: (_, m) => <RagTag rag={m.rag} />,
                },
                {
                  title: t('kpi:fields.comment'),
                  key: 'c',
                  render: (_, m) => (
                    <Space direction="vertical" size={0}>
                      <span>{m.comment || ''}</span>
                      {m.evidence.map((f) => (
                        <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer">
                          <PaperClipOutlined /> {f.fileName}
                        </a>
                      ))}
                    </Space>
                  ),
                },
                {
                  title: t('kpi:fields.source'),
                  key: 's',
                  render: (_, m) => (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t(`kpi:dataSource.${m.source}`)}
                      {m.updatedBy && ` · ${loc(m.updatedBy) || m.updatedBy.email}`}
                    </Typography.Text>
                  ),
                },
                ...(canMeasure
                  ? [
                      {
                        key: 'a',
                        width: 120,
                        render: (_: unknown, m: KpiMeasurementDto) => (
                          <Space size={0}>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              aria-label={t('edit')}
                              onClick={() => setMeasuring(m.period)}
                            />
                            <Upload
                              showUploadList={false}
                              beforeUpload={(file) => {
                                upload.mutate(
                                  { measurementId: m.id, file },
                                  { onError: (err) => message.error(errorMessage(err)) },
                                );
                                return false;
                              }}
                            >
                              <Button
                                type="text"
                                size="small"
                                icon={<PaperClipOutlined />}
                                aria-label={t('kpi:detail.uploadEvidence')}
                                title={t('kpi:detail.uploadEvidence')}
                              />
                            </Upload>
                            <Popconfirm
                              title={t('kpi:detail.deleteValueConfirm')}
                              onConfirm={() =>
                                removeValue.mutate(m.id, {
                                  onError: (err) => message.error(errorMessage(err)),
                                })
                              }
                            >
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                aria-label={t('delete')}
                              />
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title={t('kpi:detail.links')}>
            <Table
              size="small"
              rowKey="linkId"
              pagination={false}
              dataSource={d.links}
              locale={{ emptyText: t('kpi:detail.noLinks') }}
              columns={[
                {
                  title: t('kpi:fields.process'),
                  key: 'p',
                  render: (_, l) => (
                    <Link to={`/processes/${l.process.id}`}>
                      {l.process.code} {loc(l.process)}
                    </Link>
                  ),
                },
                {
                  title: t('kpi:fields.step'),
                  key: 's',
                  render: (_, l) =>
                    l.bpmnElementId === PROCESS_ELEMENT_ID ? (
                      t('kpi:fields.wholeProcess')
                    ) : (
                      <Link
                        to={`/processes/${l.process.id}/model?element=${encodeURIComponent(l.bpmnElementId)}`}
                      >
                        {(l.element && loc(l.element)) || l.bpmnElementId}
                      </Link>
                    ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
      {editing && <KpiFormModal detail={d} onClose={() => setEditing(false)} />}
      {measuring && (
        <MeasureModal
          kpi={k}
          measurements={d.measurements}
          period={measuring}
          onClose={() => setMeasuring(null)}
        />
      )}
    </>
  );
}
