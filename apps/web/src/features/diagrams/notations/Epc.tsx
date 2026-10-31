import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  List,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
  TreeSelect,
  Typography,
} from 'antd';
import { SwapOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_CATEGORIES,
  type ConvertEpcInput,
  type DiagramDto,
  type EpcConversionResultDto,
  type EpcIssue,
  type ObjectType,
} from '@processhub/shared';
import { api } from '@/api/client';
import { useObjects } from '@/api/hooks';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import type { GraphEditorContext } from '../GraphEditor';
import type { GraphInstance } from '../kit/graph-diagram';
import { SHAPE_TYPE, type GraphShape } from '../kit/graph-modules';

/** Library object type an EPC resource links to. */
const RESOURCE_OBJECT: Record<string, ObjectType> = {
  orgUnit: 'ROLE',
  system: 'SYSTEM',
  document: 'DOCUMENT',
};

/** Validation panel: the syntax rules as warnings; clicking one selects the element. */
export function EpcValidation({
  issues,
  instance,
}: {
  issues: EpcIssue[];
  instance: GraphInstance | null;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const name = (id: string | null) => {
    if (!id || !instance) return '';
    const el = instance.get<{ get(id: string): GraphShape | undefined }>('elementRegistry').get(id);
    return el ? loc(el.businessObject) || el.id : id;
  };
  const select = (id: string | null) => {
    if (!id || !instance) return;
    const el = instance.get<{ get(id: string): unknown }>('elementRegistry').get(id);
    if (!el) return;
    instance.get<{ select(e: unknown): void }>('selection').select(el);
    const canvas = instance.get<{ scrollToElement(e: unknown): void; focus?(): void }>('canvas');
    canvas.scrollToElement(el);
    // Keys (Delete …) act on the selected element.
    canvas.focus?.();
  };
  if (!issues.length)
    return (
      <Alert type="success" showIcon message={t('diagrams:epc.valid')} data-testid="epc-valid" />
    );
  return (
    <List
      size="small"
      data-testid="epc-issues"
      dataSource={issues}
      renderItem={(i) => (
        <List.Item
          className={i.elementId ? 'ph-clickable' : undefined}
          onClick={() => select(i.elementId)}
          data-code={i.code}
        >
          <Typography.Text>
            <WarningOutlined style={{ color: '#d97706', marginInlineEnd: 6 }} />
            {t(`diagrams:epc.issues.${i.code}`)}
            {i.elementId && (
              <Typography.Text type="secondary"> · {name(i.elementId)}</Typography.Text>
            )}
          </Typography.Text>
        </List.Item>
      )}
    />
  );
}

/** EPC fields: process paths link to a process, resources to a library object. */
export function EpcProperties({ element, update, canEdit }: GraphEditorContext) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const processes = useProcessTreeOptions('');
  const n = element.type === SHAPE_TYPE ? (element as GraphShape).businessObject : null;
  const objectType = n ? RESOURCE_OBJECT[n.kind] : undefined;
  const [q, setQ] = useState('');
  const objects = useObjects(
    { type: objectType, q: q || undefined, pageSize: 50, sort: 'nameEn' },
    !!objectType,
  );
  if (!n) return null;
  if (n.kind === 'processPath')
    return (
      <Form.Item label={t('diagrams:valueChain.linkedProcess')}>
        <TreeSelect
          allowClear
          showSearch
          treeNodeFilterProp="title"
          value={n.processId ?? null}
          disabled={!canEdit}
          treeData={processes.options}
          placeholder={t('none')}
          onChange={(processId: string | null) => update({ processId: processId ?? undefined })}
        />
      </Form.Item>
    );
  if (!objectType) return null;
  return (
    <Form.Item label={t(`objects:types.${objectType}`)} extra={t('diagrams:epc.resourceHint')}>
      <Select
        showSearch
        allowClear
        filterOption={false}
        onSearch={setQ}
        value={n.objectId ?? null}
        disabled={!canEdit}
        placeholder={t('none')}
        loading={objects.isFetching}
        options={(objects.data?.items ?? []).map((o) => ({
          value: o.id,
          label: `${o.code ? `${o.code} · ` : ''}${loc(o)}`,
        }))}
        onChange={(objectId: string | null) => {
          const o = objects.data?.items.find((x) => x.id === objectId);
          update({
            objectId: objectId ?? undefined,
            ...(o && !n.nameEn && !n.nameAr ? { nameEn: o.nameEn, nameAr: o.nameAr } : {}),
          });
        }}
      />
    </Form.Item>
  );
}

/** "Convert to BPMN": a new draft process from the saved EPC, with the mapping report. */
export function EpcConvert({
  diagram,
  issues,
  beforeConvert,
}: {
  diagram: DiagramDto;
  issues: EpcIssue[];
  beforeConvert: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const processes = useProcessTreeOptions('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EpcConversionResultDto | null>(null);
  const [form] = Form.useForm<ConvertEpcInput>();

  const submit = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (!(await beforeConvert())) return;
      setResult(
        await api<EpcConversionResultDto>(`/diagrams/${diagram.id}/convert-to-bpmn`, {
          method: 'POST',
          body: v,
        }),
      );
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={t('diagrams:epc.convertHint')}>
        <Button
          size="small"
          type="text"
          icon={<SwapOutlined />}
          onClick={() => {
            setResult(null);
            form.setFieldsValue({
              nameEn: diagram.nameEn,
              nameAr: diagram.nameAr,
              category: 'CORE',
            });
            setOpen(true);
          }}
          data-testid="epc-convert"
        >
          <span className="ph-ws-label">{t('diagrams:epc.convert')}</span>
        </Button>
      </Tooltip>
      <Modal
        open={open}
        title={t('diagrams:epc.convertTitle')}
        width={result ? 'min(1000px, 95vw)' : 640}
        onCancel={() => setOpen(false)}
        okText={result ? t('close') : t('diagrams:epc.convert')}
        cancelButtonProps={{ style: result ? { display: 'none' } : undefined }}
        confirmLoading={busy}
        onOk={() => (result ? setOpen(false) : void submit())}
        destroyOnHidden
      >
        {!result ? (
          <>
            <Typography.Paragraph type="secondary">
              {t('diagrams:epc.convertText')}
            </Typography.Paragraph>
            {issues.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBlockEnd: 12 }}
                message={t('diagrams:epc.convertWithIssues', { count: issues.length })}
              />
            )}
            <Form form={form} layout="vertical" name="epc-convert">
              <Form.Item
                name="code"
                label={t('fields.code')}
                rules={[
                  { required: true, message: t('validation.required') },
                  { pattern: /^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/, message: t('validation.code') },
                ]}
              >
                <Input dir="ltr" maxLength={30} placeholder="C.02.03" />
              </Form.Item>
              <Form.Item name="nameEn" label={t('fields.nameEn')}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item name="nameAr" label={t('fields.nameAr')}>
                <Input dir="rtl" maxLength={200} />
              </Form.Item>
              <Form.Item name="category" label={t('fields.category')}>
                <Select
                  options={PROCESS_CATEGORIES.map((c) => ({
                    value: c,
                    label: t(`processes:category.${c}`),
                  }))}
                />
              </Form.Item>
              <Form.Item name="parentId" label={t('diagrams:epc.parent')}>
                <TreeSelect
                  allowClear
                  showSearch
                  treeNodeFilterProp="title"
                  treeData={processes.options}
                  placeholder={t('none')}
                />
              </Form.Item>
            </Form>
          </>
        ) : (
          <div data-testid="epc-report">
            <Alert
              type="success"
              showIcon
              style={{ marginBlockEnd: 12 }}
              message={
                <span>
                  {t('diagrams:epc.converted', { code: result.code })}{' '}
                  <Link to={`/processes/${result.processId}/model`}>
                    {t('diagrams:epc.openProcess')}
                  </Link>
                </span>
              }
            />
            <Table
              size="small"
              rowKey="epcId"
              pagination={false}
              scroll={{ y: 360 }}
              dataSource={result.report}
              columns={[
                {
                  key: 'epc',
                  title: t('diagrams:epc.reportEpc'),
                  render: (_, r) => (
                    <span>
                      <Tag bordered={false}>{t(`diagrams:kinds.${r.epcKind}`)}</Tag>
                      {loc(r) || r.epcId}
                    </span>
                  ),
                },
                {
                  key: 'result',
                  title: t('diagrams:epc.reportBpmn'),
                  render: (_, r) => (
                    <span>
                      {t(`diagrams:epc.results.${r.result}`)}
                      {r.bpmnId && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {' '}
                          · <span dir="ltr">{r.bpmnId}</span>
                        </Typography.Text>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
