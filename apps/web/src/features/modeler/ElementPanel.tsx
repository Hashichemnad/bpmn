import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Select,
  Space,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { ExportOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  STEP_KIND_APPROVAL,
  STEP_KIND_TASK,
  buildTree,
  isApprovalLabel,
  type ObjectLinkDto,
  type ObjectType,
  type ProcessDto,
  type ProcessSummaryDto,
  type TreeNode,
} from '@processhub/shared';
import { useCreateLink, useDeleteLink, useObjects, useProcessTree } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import type { BpmnInstance, DiagramElement, EventBus, Modeling } from './bpmn-types';
import { canDrillDown, isActivityElement, linkedProcessOf, readLabels } from './diagram';
import { labelAttr } from './labels';

interface Props {
  instance: BpmnInstance | null;
  element: DiagramElement | null;
  process: ProcessDto;
  links: ObjectLinkDto[];
  canEdit: boolean;
}

/** Re-renders when the given element changes on the canvas (label edits, undo, ...). */
function useElementVersion(instance: BpmnInstance | null, element: DiagramElement | null) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!instance || !element) return;
    const eventBus = instance.get<EventBus>('eventBus');
    const handler = (e: { element: DiagramElement }) => {
      if (e.element.id === element.id || e.element.labelTarget?.id === element.id)
        setVersion((v) => v + 1);
    };
    eventBus.on('element.changed', handler as never);
    return () => eventBus.off('element.changed', handler as never);
  }, [instance, element]);
  return version;
}

function ObjectPicker({
  type,
  exclude,
  onPick,
  disabled,
}: {
  type: ObjectType;
  exclude: Set<string>;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const objects = useObjects({ type, q: q || undefined, pageSize: 20, sort: 'nameEn' });
  return (
    <Select
      showSearch
      value={null}
      size="small"
      style={{ width: '100%' }}
      placeholder={t(`modeler:add.${type}`)}
      filterOption={false}
      onSearch={setQ}
      loading={objects.isFetching}
      disabled={disabled}
      notFoundContent={t('modeler:noObjects')}
      options={(objects.data?.items ?? [])
        .filter((o) => !exclude.has(o.id))
        .map((o) => ({ value: o.id, label: `${o.code ? `${o.code} · ` : ''}${loc(o)}` }))}
      onChange={(id: string) => id && onPick(id)}
    />
  );
}

export function ElementPanel({ instance, element, process, links, canEdit }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const version = useElementVersion(instance, element);
  const createLink = useCreateLink(process.id);
  const deleteLink = useDeleteLink(process.id);
  const tree = useProcessTree();
  const [names, setNames] = useState({ nameEn: '', nameAr: '' });
  const [desc, setDesc] = useState({ descriptionEn: '', descriptionAr: '' });

  const bo = element?.businessObject;
  useEffect(() => {
    if (!bo) return;
    const l = readLabels(bo);
    setNames({ nameEn: l.nameEn ?? '', nameAr: l.nameAr ?? '' });
    setDesc({
      descriptionEn: (bo.get('ph:descriptionEn') as string | undefined) ?? '',
      descriptionAr: (bo.get('ph:descriptionAr') as string | undefined) ?? '',
    });
  }, [bo, version]);

  const processTree = useMemo(() => {
    type Node = { title: string; value: string; disabled: boolean; children: Node[] };
    const map = (nodes: TreeNode<ProcessSummaryDto>[]): Node[] =>
      nodes.map((p) => ({
        title: `${p.code} ${loc(p)}`,
        value: p.id,
        disabled: p.id === process.id,
        children: map(p.children),
      }));
    return map(buildTree(tree.data ?? []));
  }, [tree.data, loc, process.id]);

  if (!element || !bo || element.type === 'bpmn:Process' || element.type === 'bpmn:Collaboration') {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space direction="vertical" size={4}>
            <Typography.Text>{t('modeler:selectElement')}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('modeler:labelsHint')}
            </Typography.Text>
          </Space>
        }
      />
    );
  }

  const modeling = canEdit && instance ? instance.get<Modeling>('modeling') : null;
  const typeKey = element.type.replace('bpmn:', '');

  const commitName = (lang: 'en' | 'ar') => {
    if (!modeling) return;
    const attr = labelAttr(lang);
    const value = names[attr].trim();
    const current = readLabels(bo)[attr] ?? '';
    if (value === current) return;
    modeling.updateModdleProperties(element, bo, { [`ph:${attr}`]: value || undefined });
    // Refresh the visible label when editing the active language (or its fallback).
    const l = { ...readLabels(bo), [attr]: value };
    const display = (locale === 'ar' ? l.nameAr || l.nameEn : l.nameEn || l.nameAr) || '';
    if ((bo.name ?? '') !== display) modeling.updateLabel(element, display || null);
  };

  const commitDescription = (field: 'descriptionEn' | 'descriptionAr') => {
    if (!modeling) return;
    const value = desc[field].trim();
    if (((bo.get(`ph:${field}`) as string | undefined) ?? '') === value) return;
    modeling.updateModdleProperties(element, bo, { [`ph:${field}`]: value || undefined });
  };

  const elementLinks = links.filter((l) => l.bpmnElementId === element.id);
  const linkSection = (type: ObjectType) => {
    const items = elementLinks.filter((l) => l.repoObject.type === type);
    return (
      <div className="ph-panel-section">
        <Typography.Text strong>{t(`modeler:linked.${type}`)}</Typography.Text>
        <Flex wrap="wrap" gap={4} style={{ margin: '8px 0' }}>
          {items.length === 0 && <Typography.Text type="secondary">{t('none')}</Typography.Text>}
          {items.map((l) => (
            <Tag
              key={l.id}
              color={type === 'ROLE' ? 'purple' : type === 'SYSTEM' ? 'cyan' : 'gold'}
              closable={canEdit}
              onClose={(e) => {
                e.preventDefault();
                deleteLink.mutate(l.id, { onError: (err) => message.error(errorMessage(err)) });
              }}
            >
              <Link to={`/library/objects/${l.repoObject.id}`}>{loc(l.repoObject)}</Link>
            </Tag>
          ))}
        </Flex>
        {canEdit && (
          <ObjectPicker
            type={type}
            exclude={new Set(items.map((i) => i.repoObject.id))}
            disabled={createLink.isPending}
            onPick={(repoObjectId) =>
              createLink.mutate(
                { bpmnElementId: element.id, repoObjectId },
                { onError: (err) => message.error(errorMessage(err)) },
              )
            }
          />
        )}
      </div>
    );
  };

  const linkedProcessId = linkedProcessOf(bo);
  const linkedProcess = tree.data?.find((p) => p.id === linkedProcessId);

  return (
    <div className="ph-element-panel">
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t(`modeler:types.${typeKey}`, { defaultValue: typeKey })}
        </Typography.Text>
        <Typography.Text code copyable dir="ltr" style={{ fontSize: 12 }}>
          {element.id}
        </Typography.Text>
      </Space>
      <Divider style={{ margin: '12px 0' }} />
      <Form layout="vertical" size="small">
        <Form.Item label={t('fields.nameEn')}>
          <Input.TextArea
            dir="ltr"
            lang="en"
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={names.nameEn}
            readOnly={!canEdit}
            onChange={(e) => setNames((n) => ({ ...n, nameEn: e.target.value }))}
            onBlur={() => commitName('en')}
          />
        </Form.Item>
        <Form.Item label={t('fields.nameAr')}>
          <Input.TextArea
            dir="rtl"
            lang="ar"
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={names.nameAr}
            readOnly={!canEdit}
            onChange={(e) => setNames((n) => ({ ...n, nameAr: e.target.value }))}
            onBlur={() => commitName('ar')}
          />
        </Form.Item>
        {element.type !== 'bpmn:SequenceFlow' && (
          <>
            <Form.Item label={t('modeler:description.en')} extra={t('modeler:description.hint')}>
              <Input.TextArea
                dir="ltr"
                lang="en"
                autoSize={{ minRows: 2, maxRows: 8 }}
                maxLength={2000}
                value={desc.descriptionEn}
                readOnly={!canEdit}
                onChange={(e) => setDesc((d) => ({ ...d, descriptionEn: e.target.value }))}
                onBlur={() => commitDescription('descriptionEn')}
              />
            </Form.Item>
            <Form.Item label={t('modeler:description.ar')}>
              <Input.TextArea
                dir="rtl"
                lang="ar"
                autoSize={{ minRows: 2, maxRows: 8 }}
                maxLength={2000}
                value={desc.descriptionAr}
                readOnly={!canEdit}
                onChange={(e) => setDesc((d) => ({ ...d, descriptionAr: e.target.value }))}
                onBlur={() => commitDescription('descriptionAr')}
              />
            </Form.Item>
          </>
        )}
        {element.type === 'bpmn:UserTask' && (
          <Form.Item label={t('modeler:stepKind.label')} extra={t('modeler:stepKind.hint')}>
            <Select
              value={(bo.get('ph:stepKind') as string | undefined) ?? ''}
              disabled={!canEdit}
              onChange={(value: string) =>
                modeling?.updateModdleProperties(element, bo, {
                  'ph:stepKind': value || undefined,
                })
              }
              options={[
                {
                  value: '',
                  label: t('modeler:stepKind.auto', {
                    kind: t(
                      isApprovalLabel(readLabels(bo).nameEn || bo.name)
                        ? 'modeler:stepKind.approval'
                        : 'modeler:stepKind.task',
                    ),
                  }),
                },
                { value: STEP_KIND_APPROVAL, label: t('modeler:stepKind.approval') },
                { value: STEP_KIND_TASK, label: t('modeler:stepKind.task') },
              ]}
            />
          </Form.Item>
        )}
      </Form>

      {canDrillDown(element) && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div className="ph-panel-section">
            <Typography.Text strong>
              <LinkOutlined /> {t('modeler:linkedProcess')}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>
              {t('modeler:linkedProcessHint')}
            </Typography.Paragraph>
            {canEdit ? (
              <TreeSelect
                allowClear
                showSearch
                size="small"
                style={{ width: '100%' }}
                treeNodeFilterProp="title"
                treeData={processTree}
                value={linkedProcessId ?? undefined}
                placeholder={t('modeler:chooseProcess')}
                onChange={(value: string | undefined) =>
                  modeling?.updateModdleProperties(element, bo, {
                    'ph:linkedProcessId': value || undefined,
                  })
                }
              />
            ) : (
              <Typography.Text>
                {linkedProcess ? `${linkedProcess.code} ${loc(linkedProcess)}` : t('none')}
              </Typography.Text>
            )}
            {linkedProcessId && (
              <Button
                type="link"
                size="small"
                icon={<ExportOutlined />}
                style={{ paddingInline: 0, marginTop: 4 }}
                onClick={() => navigate(`/processes/${linkedProcessId}/model`)}
              >
                {t('modeler:openLinkedProcess')}
              </Button>
            )}
          </div>
        </>
      )}

      {isActivityElement(element) && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          {linkSection('ROLE')}
          {linkSection('SYSTEM')}
          {linkSection('DOCUMENT')}
        </>
      )}
    </div>
  );
}
