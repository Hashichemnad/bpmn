import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Popconfirm,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PROCESS_ELEMENT_ID, type InterfaceDto } from '@processhub/shared';
import { useApplication, useDeleteEa } from '@/api/ea';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ApplicationFormModal } from './ApplicationFormModal';
import { ImpactPanel } from './ImpactPanel';
import { ClassificationTag, CriticalityTag, LifecycleTag } from './ea-components';
import { applicationPath, eaStepHref, useEaAccess, useEaLabel } from './ea-helpers';

/** Application detail: overview, processes and steps supported, interfaces, data objects. */
export function ApplicationDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useEaLabel();
  const formatDate = useFormatDate();
  const access = useEaAccess();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const detail = useApplication(id);
  const remove = useDeleteEa('application');
  const [editing, setEditing] = useState(false);

  if (detail.isLoading) return <LoadingState />;
  if (detail.isError || !detail.data)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const d = detail.data;
  const a = d.item;
  const user = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? loc(u) || u.email : '—';

  const interfaceColumns = [
    {
      title: t('ea:fields.source'),
      key: 'source',
      render: (_: unknown, i: InterfaceDto) => (
        <Link to={applicationPath(i.source.id)}>{label(i.source)}</Link>
      ),
    },
    {
      title: t('ea:fields.direction'),
      key: 'direction',
      width: 70,
      render: (_: unknown, i: InterfaceDto) => (
        <span aria-label={t(`ea:direction.${i.direction}`)}>
          {i.direction === 'TWO_WAY' ? '⇄' : <span className="ph-flip-rtl">→</span>}
        </span>
      ),
    },
    {
      title: t('ea:fields.target'),
      key: 'target',
      render: (_: unknown, i: InterfaceDto) => (
        <Link to={applicationPath(i.target.id)}>{label(i.target)}</Link>
      ),
    },
    {
      title: t('ea:fields.technology'),
      key: 'technology',
      render: (_: unknown, i: InterfaceDto) => t(`ea:technology.${i.technology}`),
    },
    {
      title: t('ea:fields.frequency'),
      key: 'frequency',
      render: (_: unknown, i: InterfaceDto) => t(`ea:frequency.${i.frequency}`),
    },
    {
      title: t('ea:fields.dataObjects'),
      key: 'data',
      render: (_: unknown, i: InterfaceDto) =>
        i.dataObjects.map((o) => <Tag key={o.id}>{loc(o)}</Tag>),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('ea:applications.title'), to: '/ea/applications' }, { title: loc(a) }]}
        title={
          <Space wrap>
            {loc(a)}
            {a.code && (
              <Typography.Text type="secondary" dir="ltr">
                {a.code}
              </Typography.Text>
            )}
            <LifecycleTag lifecycle={a.lifecycle} />
            <CriticalityTag value={a.criticality} />
          </Space>
        }
        subtitle={t(`ea:appType.${a.appType}`)}
        extra={
          <>
            {access.canEdit && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            {access.canAdmin && (
              <Popconfirm
                title={t('ea:applications.deleteConfirm')}
                onConfirm={() =>
                  remove.mutate(a.id, {
                    onSuccess: () => {
                      message.success(t('deleted'));
                      navigate('/ea/applications');
                    },
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
      <Tabs
        items={[
          {
            key: 'overview',
            label: t('ea:detail.overview'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                  <Card>
                    {loc(a, 'description') && (
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                        {loc(a, 'description')}
                      </Typography.Paragraph>
                    )}
                    <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
                      <Descriptions.Item label={t('ea:fields.vendor')}>
                        {a.vendor || '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.version')}>
                        <span dir="ltr">{a.version || '—'}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.businessOwner')}>
                        {user(a.businessOwner)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.itOwner')}>
                        {user(a.itOwner)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.department')}>
                        {a.department ? loc(a.department) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.hosting')}>
                        {t(`ea:hosting.${a.hosting}`)}
                        {a.hostingCountry && ` · ${a.hostingCountry}`}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.dataClassification')}>
                        <ClassificationTag value={a.dataClassification} />
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.liveFrom')}>
                        {formatDate(a.liveFrom, false)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.phaseOutFrom')}>
                        {formatDate(a.phaseOutFrom, false)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.retiredAt')}>
                        {formatDate(a.retiredAt, false)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.capabilities')} span={2}>
                        {a.capabilities.length
                          ? a.capabilities.map((c) => <Tag key={c.id}>{label(c)}</Tag>)
                          : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.url')} span={2}>
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" dir="ltr">
                            <LinkOutlined /> {a.url}
                          </a>
                        ) : (
                          '—'
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('ea:fields.licenceNotes')} span={2}>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{a.licenceNotes || '—'}</span>
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <Card title={t('ea:detail.supportedSteps')} data-testid="app-steps">
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
                      ]}
                    />
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'impact',
            label: t('ea:impact.tab'),
            children: <ImpactPanel applicationId={a.id} />,
          },
          {
            key: 'interfaces',
            label: `${t('ea:fields.interfaces')} (${d.interfaces.length})`,
            children: (
              <Card>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={d.interfaces}
                  columns={interfaceColumns}
                  locale={{ emptyText: t('ea:detail.noInterfaces') }}
                />
              </Card>
            ),
          },
          {
            key: 'data',
            label: `${t('ea:fields.dataObjects')} (${d.dataObjects.length})`,
            children: (
              <Card>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={d.dataObjects}
                  locale={{ emptyText: t('ea:detail.noData') }}
                  columns={[
                    {
                      title: t('ea:fields.name'),
                      key: 'n',
                      render: (_, o) => (
                        <Space>
                          {label(o)}
                          {o.systemOfRecord && (
                            <Tag color="gold">{t('ea:fields.systemOfRecord')}</Tag>
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: t('ea:fields.classification'),
                      key: 'c',
                      render: (_, o) => <ClassificationTag value={o.classification} />,
                    },
                    {
                      title: t('ea:fields.usage'),
                      key: 'crud',
                      render: (_, o) =>
                        (['create', 'read', 'update', 'delete'] as const)
                          .filter((k) => o[k])
                          .map((k) => <Tag key={k}>{t(`ea:crud.${k}`)}</Tag>),
                    },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      {editing && <ApplicationFormModal item={a} onClose={() => setEditing(false)} />}
    </>
  );
}
