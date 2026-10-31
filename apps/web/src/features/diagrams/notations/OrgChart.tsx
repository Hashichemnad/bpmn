import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Col,
  Empty,
  Form,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  TreeSelect,
  Typography,
} from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  generateOrgChart,
  mergeOrgChart,
  stringifyDiagramContent,
  type GraphContent,
  type OrgMergeResult,
} from '@processhub/shared';
import { useObjects } from '@/api/hooks';
import { fetchOrgSource, useRoleActivities } from '@/api/diagrams';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import type { GraphEditorContext } from '../GraphEditor';
import type { GeneratorProps } from '../NewDiagramModal';
import { DiagramView } from '../DiagramView';
import { exportGraph, type GraphInstance } from '../kit/graph-diagram';
import { SHAPE_TYPE, type GraphShape } from '../kit/graph-modules';

/** Organisation chart fields: unit → department, position → role (+ what it does), person → user. */
export function OrgChartProperties({ element, update, canEdit }: GraphEditorContext) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const departments = useDepartmentTreeData();
  const [q, setQ] = useState('');
  const roles = useObjects({ type: 'ROLE', q: q || undefined, pageSize: 50, sort: 'nameEn' });
  if (element.type !== SHAPE_TYPE) return null;
  const n = (element as GraphShape).businessObject;
  if (n.kind === 'unit')
    return (
      <Form.Item label={t('fields.department')} extra={t('diagrams:org.unitHint')}>
        <TreeSelect
          allowClear
          treeDefaultExpandAll
          value={n.departmentId ?? null}
          disabled={!canEdit}
          treeData={departments}
          placeholder={t('none')}
          onChange={(departmentId: string | null) =>
            update({ departmentId: departmentId ?? undefined })
          }
        />
      </Form.Item>
    );
  if (n.kind === 'person')
    return (
      <Form.Item label={t('diagrams:org.user')} extra={t('diagrams:org.userHint')}>
        <UserSelect
          allowClear
          value={n.userId ?? null}
          placeholder={t('none')}
          onChange={(userId) => canEdit && update({ userId: userId ?? undefined })}
        />
      </Form.Item>
    );
  return (
    <>
      <Form.Item label={t('diagrams:org.role')} extra={t('diagrams:org.roleHint')}>
        <Select
          showSearch
          allowClear
          filterOption={false}
          onSearch={setQ}
          value={n.objectId ?? null}
          disabled={!canEdit}
          placeholder={t('none')}
          loading={roles.isFetching}
          data-testid="org-role"
          options={(roles.data?.items ?? []).map((r) => ({
            value: r.id,
            label: `${r.code ? `${r.code} · ` : ''}${loc(r)}`,
          }))}
          onChange={(objectId: string | null) => {
            const r = roles.data?.items.find((x) => x.id === objectId);
            update({
              objectId: objectId ?? undefined,
              ...(r && !n.nameEn && !n.nameAr ? { nameEn: r.nameEn, nameAr: r.nameAr } : {}),
            });
          }}
        />
      </Form.Item>
      {n.objectId && <RoleActivities roleId={n.objectId} />}
    </>
  );
}

/** Processes and steps a position performs, with its RACI letters (as in the B2 RACI report). */
export function RoleActivities({ roleId }: { roleId: string }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const activities = useRoleActivities(roleId);
  const rows = activities.data ?? [];
  return (
    <div className="ph-org-activities" data-testid="org-activities">
      <Typography.Text strong>{t('diagrams:org.performs')}</Typography.Text>
      <List
        size="small"
        loading={activities.isLoading}
        dataSource={rows}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('diagrams:org.performsNone')}
            />
          ),
        }}
        renderItem={(r) => (
          <List.Item style={{ display: 'block' }}>
            <Link to={`/processes/${r.process.id}`}>
              <span dir="ltr">{r.process.code}</span> {loc(r.process)}
            </Link>
            <ul className="ph-org-steps">
              {r.steps.map((s) => (
                <li key={s.id}>
                  <Tooltip title={t(`diagrams:org.raci.${s.letter}`)}>
                    <Tag color={s.letter === 'A' ? 'purple' : 'blue'}>{s.letter}</Tag>
                  </Tooltip>
                  <Link
                    to={`/processes/${r.process.id}/model?element=${encodeURIComponent(s.id)}&view=1`}
                  >
                    {loc(s) || s.id}
                  </Link>
                  {s.viaLane && (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {' '}
                      · {t('diagrams:org.viaLane')}
                    </Typography.Text>
                  )}
                </li>
              ))}
            </ul>
          </List.Item>
        )}
      />
    </div>
  );
}

/** Builds the chart from departments, positions and (optionally) people. */
async function generate(includePersons: boolean) {
  const source = await fetchOrgSource();
  return { content: generateOrgChart(source, { includePersons }), people: source.people !== null };
}

/** Top-bar tool: regenerate from data with a preview of what changes (merge by id). */
export function OrgChartTools({
  instance,
  canEdit,
  onApply,
}: {
  instance: GraphInstance | null;
  canEdit: boolean;
  onApply: (content: GraphContent) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [persons, setPersons] = useState(false);
  const [result, setResult] = useState<OrgMergeResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !instance) return;
    let alive = true;
    setLoading(true);
    generate(persons)
      .then(
        ({ content }) =>
          alive && setResult(mergeOrgChart(exportGraph(instance, 'ORG_CHART'), content)),
      )
      .catch((err) => message.error(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, persons, instance, message, errorMessage]);

  if (!canEdit) return null;
  return (
    <>
      <Tooltip title={t('diagrams:org.regenerateHint')}>
        <Button
          size="small"
          type="text"
          icon={<SyncOutlined />}
          onClick={() => setOpen(true)}
          data-testid="org-regenerate"
        >
          <span className="ph-ws-label">{t('diagrams:org.regenerate')}</span>
        </Button>
      </Tooltip>
      <Modal
        open={open}
        title={t('diagrams:org.previewTitle')}
        width="min(1100px, 95vw)"
        okText={t('diagrams:org.apply')}
        cancelText={t('cancel')}
        okButtonProps={{ disabled: !result || loading }}
        onCancel={() => setOpen(false)}
        onOk={() => {
          if (result) onApply(result.content);
          setOpen(false);
        }}
        destroyOnHidden
      >
        <OrgPreview result={result} loading={loading} persons={persons} onPersons={setPersons} />
      </Modal>
    </>
  );
}

function OrgPreview({
  result,
  loading,
  persons,
  onPersons,
}: {
  result: OrgMergeResult | null;
  loading: boolean;
  persons: boolean;
  onPersons: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const content = useMemo(
    () => (result ? stringifyDiagramContent(result.content) : null),
    [result],
  );
  return (
    <>
      <Typography.Paragraph type="secondary">{t('diagrams:org.mergeHint')}</Typography.Paragraph>
      <Checkbox checked={persons} onChange={(e) => onPersons(e.target.checked)}>
        {t('diagrams:org.includePersons')}
      </Checkbox>
      {result && (
        <Row gutter={16} style={{ marginBlock: 16 }} data-testid="org-preview">
          <Col span={6}>
            <Statistic title={t('diagrams:org.added')} value={result.added.length} />
          </Col>
          <Col span={6}>
            <Statistic title={t('diagrams:org.renamed')} value={result.renamed.length} />
          </Col>
          <Col span={6}>
            <Statistic title={t('diagrams:org.removed')} value={result.removed.length} />
          </Col>
          <Col span={6}>
            <Statistic title={t('diagrams:org.keptManual')} value={result.keptManual} />
          </Col>
        </Row>
      )}
      {result && (result.removed.length > 0 || result.renamed.length > 0) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 12 }}
          message={
            <Space direction="vertical" size={2}>
              {result.removed.map((n) => (
                <span key={n.id}>
                  <Tag color="red">{t('diagrams:diff.removed')}</Tag>
                  {loc(n)}
                </span>
              ))}
              {result.renamed.map((r) => (
                <span key={r.after.id}>
                  <Tag color="orange">{t('diagrams:org.renamed')}</Tag>
                  {loc(r.before)} → {loc(r.after)}
                </span>
              ))}
            </Space>
          }
        />
      )}
      {content && !loading && <DiagramView type="ORG_CHART" content={content} height={420} />}
    </>
  );
}

/** "New organisation chart": optionally generate it from departments and roles. */
export function OrgChartGenerator({ onContent }: GeneratorProps) {
  const { t } = useTranslation();
  const [on, setOn] = useState(false);
  const [persons, setPersons] = useState(false);
  const [canPersons, setCanPersons] = useState(true);
  useEffect(() => {
    if (!on) return onContent(null);
    let alive = true;
    void generate(persons).then(({ content, people }) => {
      if (!alive) return;
      setCanPersons(people);
      onContent(stringifyDiagramContent(content), 'Generated from departments and roles');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, persons]);
  return (
    <Alert
      type="info"
      style={{ marginBlockEnd: 16 }}
      message={
        <Space direction="vertical">
          <Checkbox
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            data-testid="org-generate-new"
          >
            {t('diagrams:org.generateFromData')}
          </Checkbox>
          {on && canPersons && (
            <Checkbox checked={persons} onChange={(e) => setPersons(e.target.checked)}>
              {t('diagrams:org.includePersons')}
            </Checkbox>
          )}
        </Space>
      }
    />
  );
}
