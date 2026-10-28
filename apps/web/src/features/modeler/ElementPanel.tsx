import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
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
import { DisconnectOutlined, ExportOutlined, LinkOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  STEP_KIND_APPROVAL,
  STEP_KIND_TASK,
  isApprovalLabel,
  type ObjectLinkDto,
  type ObjectType,
  type ProcessDto,
  type RepoObjectDto,
} from '@processhub/shared';
import { useCreateLink, useDeleteLink, useObject, useObjects, useProcessTree } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import type {
  BpmnInstance,
  DiagramElement,
  ElementRegistry,
  EventBus,
  Modeling,
} from './bpmn-types';
import {
  canDrillDown,
  isActivityElement,
  laneOf,
  laneRoleOf,
  linkedProcessOf,
  readLabels,
} from './diagram';
import { labelAttr, pickLabel } from './labels';
import { useProcessTreeOptions } from './process-tree-options';

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
  onPick: (object: RepoObjectDto) => void;
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
      onChange={(id: string) => {
        const o = objects.data?.items.find((x) => x.id === id);
        if (o) onPick(o);
      }}
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
  const { options: processTree } = useProcessTreeOptions(process.id);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
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

  // Lane of the element and the role linked to it (lanes linked to a library role).
  const registry = instance?.get<ElementRegistry>('elementRegistry');
  const lane =
    element && registry && element.type !== 'bpmn:Lane' ? laneOf(registry, element) : null;
  const laneRoleId = element?.type === 'bpmn:Lane' ? laneRoleOf(element) : laneRoleOf(lane);
  const laneRole = useObject(laneRoleId ?? undefined);

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
            onPick={(o) =>
              createLink.mutate(
                { bpmnElementId: element.id, repoObjectId: o.id },
                { onError: (err) => message.error(errorMessage(err)) },
              )
            }
          />
        )}
      </div>
    );
  };

  /** Lane label = role name in both languages (the shown one in the active language). */
  const setLaneRole = (role: { id: string; nameEn: string; nameAr: string } | null) => {
    if (!modeling) return;
    if (!role) {
      modeling.updateModdleProperties(element, bo, { 'ph:roleId': undefined });
      return;
    }
    modeling.updateModdleProperties(element, bo, {
      'ph:roleId': role.id,
      'ph:nameEn': role.nameEn || role.nameAr,
      'ph:nameAr': role.nameAr || role.nameEn,
    });
    const display = pickLabel({ nameEn: role.nameEn, nameAr: role.nameAr }, locale);
    if ((bo.name ?? '') !== display) modeling.updateLabel(element, display || null);
  };
  const role = laneRole.data;
  const labels = readLabels(bo);
  const roleLabelDiffers =
    element.type === 'bpmn:Lane' &&
    !!role &&
    ((role.nameEn || role.nameAr) !== (labels.nameEn ?? '') ||
      (role.nameAr || role.nameEn) !== (labels.nameAr ?? ''));
  const laneSection = element.type === 'bpmn:Lane' && (
    <>
      <Divider style={{ margin: '12px 0' }} />
      <div className="ph-panel-section">
        <Typography.Text strong>{t('modeler:lane.role')}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>
          {t('modeler:lane.roleHint')}
        </Typography.Paragraph>
        {laneRoleId ? (
          <Flex wrap="wrap" gap={4} align="center">
            <Tag color="purple">
              <Link to={`/library/objects/${laneRoleId}`}>
                {role ? loc(role) : laneRole.isError ? t('modeler:lane.roleMissing') : '…'}
              </Link>
            </Tag>
            {canEdit && roleLabelDiffers && (
              <Button
                size="small"
                icon={<SyncOutlined />}
                onClick={() => role && setLaneRole(role)}
              >
                {t('modeler:lane.updateLabel')}
              </Button>
            )}
            {canEdit && (
              <Button
                size="small"
                type="text"
                icon={<DisconnectOutlined />}
                onClick={() => setLaneRole(null)}
              >
                {t('modeler:lane.unlink')}
              </Button>
            )}
          </Flex>
        ) : canEdit ? (
          <ObjectPicker type="ROLE" exclude={new Set()} onPick={setLaneRole} />
        ) : (
          <Typography.Text type="secondary">{t('none')}</Typography.Text>
        )}
      </div>
    </>
  );

  // Tasks placed in a lane linked to a role: suggest "role performs this step" (confirm here).
  const suggestedRole =
    canEdit &&
    isActivityElement(element) &&
    laneRoleId &&
    role &&
    !elementLinks.some((l) => l.repoObject.id === laneRoleId) &&
    !dismissed.has(`${element.id}/${laneRoleId}`)
      ? role
      : null;
  const suggestion = suggestedRole && (
    <Alert
      type="info"
      showIcon
      className="ph-panel-suggestion"
      message={t('modeler:lane.suggestion', {
        role: loc(suggestedRole),
        lane: lane ? pickLabel(readLabels(lane.businessObject), locale) : '',
      })}
      description={
        <Space size={4} style={{ marginBlockStart: 4 }}>
          <Button
            size="small"
            type="primary"
            loading={createLink.isPending}
            onClick={() =>
              createLink.mutate(
                { bpmnElementId: element.id, repoObjectId: suggestedRole.id, relation: 'PERFORMS' },
                { onError: (err) => message.error(errorMessage(err)) },
              )
            }
          >
            {t('modeler:lane.suggestionLink')}
          </Button>
          <Button
            size="small"
            type="text"
            onClick={() => setDismissed((d) => new Set(d).add(`${element.id}/${suggestedRole.id}`))}
          >
            {t('modeler:lane.suggestionDismiss')}
          </Button>
        </Space>
      }
    />
  );

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

      {laneSection}

      {isActivityElement(element) && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          {suggestion}
          {linkSection('ROLE')}
          {linkSection('SYSTEM')}
          {linkSection('DOCUMENT')}
        </>
      )}
    </div>
  );
}
