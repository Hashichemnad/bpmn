import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { DownloadOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  ENGAGEMENT_STATUSES,
  WORK_ITEM_RESULTS,
  WORK_ITEM_STATUSES,
  type AuditFindingDto,
  type AuditWorkItemDto,
} from '@processhub/shared';
import { useEngagement, useEngagementAction } from '@/api/assurance';
import { apiDownload } from '@/api/client';
import { downloadBlob } from '@/features/modeler/export';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { GrcItemSelect } from '@/features/grc/GrcItemSelect';
import { EngagementFormModal } from './EngagementFormModal';
import { EvidenceList } from './EvidenceList';
import { EventsTimeline } from './EventsTimeline';
import { FindingCard, FindingFormModal, ResponseModal } from './FindingParts';
import { EngagementStatusTag } from './assurance-tags';

/** One audit engagement: overview, work programme, findings and responses, report, history. */
export function EngagementPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const q = useEngagement(id);
  const act = useEngagementAction(id ?? '');
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState<AuditFindingDto | 'new' | null>(null);
  const [responding, setResponding] = useState<AuditFindingDto | null>(null);
  const [newItem, setNewItem] = useState<{
    controlId?: string | null;
    titleEn?: string;
    titleAr?: string;
  } | null>(null);

  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const e = q.data;
  const open = e.status !== 'CLOSED';
  const manage = e.canManage && open;
  const onError = (err: unknown) => message.error(errorMessage(err));
  const focus = params.get('finding');
  const tab = params.get('tab') ?? (focus ? 'findings' : 'overview');
  const idx = ENGAGEMENT_STATUSES.indexOf(e.status);
  const move = (to: number) =>
    act.mutate(
      { kind: 'status', body: { status: ENGAGEMENT_STATUSES[to], comment: '' } },
      { onError },
    );
  const report = async (locale: 'en' | 'ar') => {
    try {
      const file = await apiDownload(
        `/audits/${e.id}/report`,
        { query: { locale } },
        `${e.code}-${locale}.docx`,
      );
      downloadBlob(file.blob, file.fileName);
    } catch (err) {
      onError(err);
    }
  };
  const refs = (list: { id: string; code: string | null; nameEn: string; nameAr: string }[]) =>
    list.length ? list.map((r) => [r.code, loc(r)].filter(Boolean).join(' ')).join(' · ') : '—';

  const itemColumns = [
    {
      title: t('assurance:audits.workItem'),
      render: (_: unknown, i: AuditWorkItemDto) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{loc(i, 'title')}</Typography.Text>
          {i.procedure.length > 0 && (
            <ol style={{ margin: 0, paddingInlineStart: 18 }}>
              {i.procedure.map((s, k) => (
                <li key={k}>{loc({ nameEn: s.en, nameAr: s.ar })}</li>
              ))}
            </ol>
          )}
        </Space>
      ),
    },
    {
      title: t('assurance:issues.statusLabel'),
      width: 170,
      render: (_: unknown, i: AuditWorkItemDto) => (
        <Select
          size="small"
          disabled={!manage}
          value={i.status}
          style={{ width: 150 }}
          data-testid={`item-status-${i.id}`}
          onChange={(status) =>
            act.mutate({ kind: 'updateItem', id: i.id, body: { status } }, { onError })
          }
          options={WORK_ITEM_STATUSES.map((s) => ({
            value: s,
            label: t(`assurance:audits.itemStatus.${s}`),
          }))}
        />
      ),
    },
    {
      title: t('assurance:audits.result'),
      width: 170,
      render: (_: unknown, i: AuditWorkItemDto) => (
        <Select
          size="small"
          allowClear
          disabled={!manage}
          value={i.result ?? undefined}
          style={{ width: 150 }}
          onChange={(result) =>
            act.mutate(
              { kind: 'updateItem', id: i.id, body: { result: result ?? null } },
              { onError },
            )
          }
          options={WORK_ITEM_RESULTS.map((s) => ({
            value: s,
            label: t(`assurance:audits.itemResult.${s}`),
          }))}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.grcGroup') },
          { title: t('assurance:audits.title'), to: `/grc/audits?year=${e.year}` },
          { title: e.code },
        ]}
        title={
          <Space wrap>
            <span dir="ltr">{e.code}</span>
            {loc(e, 'title')}
          </Space>
        }
        subtitle={
          <Space wrap>
            <EngagementStatusTag status={e.status} />
            {formatDate(e.plannedStart, false)} – {formatDate(e.plannedEnd, false)}
          </Space>
        }
        extra={
          <Space wrap>
            <Dropdown
              menu={{
                items: [
                  { key: 'en', label: 'English', onClick: () => void report('en') },
                  { key: 'ar', label: 'العربية', onClick: () => void report('ar') },
                ],
              }}
            >
              <Button icon={<DownloadOutlined />} data-testid="audit-report">
                {t('assurance:audits.report')}
              </Button>
            </Dropdown>
            {manage && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            {e.canManage && idx > 0 && (
              <Button onClick={() => move(idx - 1)}>
                {t('assurance:audits.back', {
                  status: t(`assurance:audits.status.${ENGAGEMENT_STATUSES[idx - 1]}`),
                })}
              </Button>
            )}
            {e.canManage && idx < ENGAGEMENT_STATUSES.length - 1 && (
              <Button
                type="primary"
                data-testid="engagement-next"
                loading={act.isPending}
                onClick={() => move(idx + 1)}
              >
                {t('assurance:audits.next', {
                  status: t(`assurance:audits.status.${ENGAGEMENT_STATUSES[idx + 1]}`),
                })}
              </Button>
            )}
            {e.canManage && e.status === 'PLANNED' && (
              <Button
                danger
                onClick={() =>
                  Modal.confirm({
                    title: t('assurance:audits.deleteConfirm'),
                    onOk: () =>
                      act.mutateAsync({ kind: 'delete' }).then(() => navigate('/grc/audits')),
                  })
                }
              >
                {t('delete')}
              </Button>
            )}
          </Space>
        }
      />
      <Steps
        size="small"
        current={idx}
        style={{ marginBlockEnd: 16 }}
        items={ENGAGEMENT_STATUSES.map((s) => ({ title: t(`assurance:audits.status.${s}`) }))}
      />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => {
            const n = new URLSearchParams(params);
            n.set('tab', k);
            n.delete('finding');
            setParams(n);
          }}
          items={[
            {
              key: 'overview',
              label: t('assurance:audits.overview'),
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} lg={14}>
                    <Descriptions
                      size="small"
                      column={1}
                      items={[
                        {
                          key: 'obj',
                          label: t('assurance:audits.objective'),
                          children: (
                            <span style={{ whiteSpace: 'pre-wrap' }}>
                              {loc(e, 'objective') || '—'}
                            </span>
                          ),
                        },
                        {
                          key: 'scope',
                          label: t('assurance:audits.scope'),
                          children: (
                            <span style={{ whiteSpace: 'pre-wrap' }}>{loc(e, 'scope') || '—'}</span>
                          ),
                        },
                        {
                          key: 'p',
                          label: t('assurance:audits.scopeProcesses'),
                          children: refs(e.scope.processes),
                        },
                        {
                          key: 'd',
                          label: t('assurance:audits.scopeDepartments'),
                          children: e.scope.departments.map((d) => loc(d)).join(' · ') || '—',
                        },
                        {
                          key: 'r',
                          label: t('grc:register.RISK.title'),
                          children: refs(e.scope.risks),
                        },
                        {
                          key: 'c',
                          label: t('grc:register.CONTROL.title'),
                          children: refs(e.scope.controls),
                        },
                        {
                          key: 'q',
                          label: t('grc:register.REQUIREMENT.title'),
                          children: refs(e.scope.requirements),
                        },
                        {
                          key: 'lead',
                          label: t('assurance:audits.lead'),
                          children: e.lead ? loc(e.lead) || e.lead.email : '—',
                        },
                        {
                          key: 'team',
                          label: t('assurance:audits.team'),
                          children: e.team.map((u) => loc(u) || u.email).join(', ') || '—',
                        },
                        {
                          key: 'act',
                          label: t('assurance:audits.actualDates'),
                          children: `${formatDate(e.actualStart, false)} – ${formatDate(e.actualEnd, false)}`,
                        },
                        {
                          key: 'sum',
                          label: t('assurance:audits.summary'),
                          children: (
                            <span style={{ whiteSpace: 'pre-wrap' }}>
                              {loc(e, 'summary') || '—'}
                            </span>
                          ),
                        },
                      ]}
                    />
                  </Col>
                  <Col xs={24} lg={10}>
                    <EventsTimeline
                      events={e.events}
                      statusNs="assurance:audits.status"
                      commenting={act.isPending}
                      onComment={
                        e.canManage
                          ? (body) => act.mutateAsync({ kind: 'comment', body })
                          : undefined
                      }
                    />
                  </Col>
                </Row>
              ),
            },
            {
              key: 'programme',
              label: `${t('assurance:audits.workProgramme')} (${e.itemsDone}/${e.itemCount})`,
              children: (
                <>
                  {manage && (
                    <Space style={{ marginBlockEnd: 12 }} wrap>
                      <Button
                        icon={<PlusOutlined />}
                        data-testid="add-item"
                        onClick={() => setNewItem({})}
                      >
                        {t('assurance:audits.addItem')}
                      </Button>
                    </Space>
                  )}
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    data-testid="work-items"
                    dataSource={e.items}
                    locale={{ emptyText: t('assurance:audits.noItems') }}
                    columns={itemColumns}
                    expandable={{
                      expandedRowRender: (i) => (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Typography.Text strong>{t('assurance:audits.notes')}</Typography.Text>
                          <Input.TextArea
                            defaultValue={i.notes}
                            disabled={!manage}
                            autoSize={{ minRows: 2 }}
                            onBlur={(ev) =>
                              ev.target.value !== i.notes &&
                              act.mutate(
                                { kind: 'updateItem', id: i.id, body: { notes: ev.target.value } },
                                { onError },
                              )
                            }
                          />
                          <EvidenceList
                            files={i.files}
                            canAdd={manage}
                            testId={`item-evidence-${i.id}`}
                            onUpload={(file) =>
                              act.mutateAsync({ kind: 'itemFile', id: i.id, file })
                            }
                          />
                        </Space>
                      ),
                    }}
                  />
                </>
              ),
            },
            {
              key: 'findings',
              label: `${t('assurance:audits.findings')} (${e.findingCount})`,
              children: (
                <>
                  {manage && (
                    <Button
                      icon={<PlusOutlined />}
                      data-testid="add-finding"
                      style={{ marginBlockEnd: 12 }}
                      onClick={() => setFinding('new')}
                    >
                      {t('assurance:audits.addFinding')}
                    </Button>
                  )}
                  {!e.findings.length && <Empty description={t('assurance:audits.noFindings')} />}
                  {e.findings.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      highlight={f.id === focus}
                      onEdit={manage ? () => setFinding(f) : undefined}
                      onRespond={() => setResponding(f)}
                    />
                  ))}
                </>
              ),
            },
          ]}
        />
      </Card>
      {editing && <EngagementFormModal engagement={e} onClose={() => setEditing(false)} />}
      {finding && (
        <FindingFormModal
          finding={finding === 'new' ? undefined : finding}
          items={e.items}
          saving={act.isPending}
          onClose={() => setFinding(null)}
          onSave={(body) =>
            act.mutate(
              finding === 'new'
                ? { kind: 'addFinding', body }
                : { kind: 'updateFinding', id: finding.id, body },
              { onSuccess: () => setFinding(null), onError },
            )
          }
        />
      )}
      {responding && (
        <ResponseModal
          finding={responding}
          saving={act.isPending}
          onClose={() => setResponding(null)}
          onSave={(body) =>
            act.mutate(
              { kind: 'respond', id: responding.id, body },
              { onSuccess: () => setResponding(null), onError },
            )
          }
        />
      )}
      {newItem && (
        <Modal
          open
          title={t('assurance:audits.addItem')}
          onCancel={() => setNewItem(null)}
          confirmLoading={act.isPending}
          onOk={() =>
            act.mutate(
              { kind: 'addItem', body: newItem },
              { onSuccess: () => setNewItem(null), onError },
            )
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} data-testid="item-form">
            <Typography.Text>{t('assurance:audits.itemFromControl')}</Typography.Text>
            <GrcItemSelect
              type="CONTROL"
              multiple={false}
              value={newItem.controlId ?? null}
              onChange={(v) => setNewItem({ ...newItem, controlId: Array.isArray(v) ? v[0] : v })}
            />
            <Typography.Text type="secondary">{t('assurance:audits.itemOrTitle')}</Typography.Text>
            <Input
              dir="ltr"
              placeholder={t('assurance:issues.titleEn')}
              value={newItem.titleEn}
              onChange={(ev) => setNewItem({ ...newItem, titleEn: ev.target.value })}
            />
            <Input
              dir="rtl"
              placeholder={t('assurance:issues.titleAr')}
              value={newItem.titleAr}
              onChange={(ev) => setNewItem({ ...newItem, titleAr: ev.target.value })}
            />
          </Space>
        </Modal>
      )}
    </>
  );
}
