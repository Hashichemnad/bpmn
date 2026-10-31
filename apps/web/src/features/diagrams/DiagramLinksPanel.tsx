import { App, Button, Empty, List, Space, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type ObjectType } from '@processhub/shared';
import { useDiagramLinkActions, useDiagramLinks } from '@/api/diagrams';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { ObjectPicker } from '@/features/modeler/ElementPanel';
import type { SelectedElement } from './DiagramWorkspace';

/** Library objects a diagram element can be linked to (same set as BPMN steps). */
const LINK_TYPES: ObjectType[] = ['ROLE', 'SYSTEM', 'DOCUMENT', 'TERM', 'RISK', 'CONTROL', 'KPI'];
const GRC: ObjectType[] = ['RISK', 'CONTROL'];

/**
 * Object links of the selected element (roles, IT systems, documents, dictionary terms, risks,
 * controls, KPIs): list, add and remove. Without a selection: every link of the diagram.
 */
export function DiagramLinksPanel({
  diagramId,
  element,
  canEdit,
  beforeLink,
}: {
  diagramId: string;
  element: SelectedElement | null;
  canEdit: boolean;
  /** Saves pending edits first (the element must exist on the server). */
  beforeLink: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { can } = useAuth();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const links = useDiagramLinks(diagramId);
  const actions = useDiagramLinkActions(diagramId);
  const rows = (links.data ?? []).filter((l) => !element || l.elementId === element.id);
  const canGrc = can(PERMISSIONS.GRC_EDIT) || can(PERMISSIONS.GRC_PROPOSE);
  const types = LINK_TYPES.filter((ty) => !GRC.includes(ty) || canGrc);

  const add = async (repoObjectId: string) => {
    if (!element) return;
    try {
      if (!(await beforeLink())) return;
      await actions.create.mutateAsync({ elementId: element.id, repoObjectId });
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <div className="ph-panel-section">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {element
          ? t('diagrams:links.forElement', { name: loc(element) || element.id })
          : t('diagrams:links.all')}
      </Typography.Paragraph>
      <List
        size="small"
        loading={links.isLoading}
        dataSource={rows}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('diagrams:links.none')} />
          ),
        }}
        renderItem={(l) => (
          <List.Item
            actions={
              canEdit
                ? [
                    <Button
                      key="del"
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t('delete')}
                      loading={actions.remove.isPending}
                      onClick={() =>
                        actions.remove
                          .mutateAsync(l.id)
                          .catch((err) => message.error(errorMessage(err)))
                      }
                    />,
                  ]
                : []
            }
          >
            <Space direction="vertical" size={0}>
              <Space size={4} wrap>
                <Tag bordered={false}>{t(`objects:types.${l.repoObject.type}`)}</Tag>
                <span>
                  {l.repoObject.code ? `${l.repoObject.code} · ` : ''}
                  {loc(l.repoObject)}
                </span>
              </Space>
              {!element && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {loc(l.element ?? { nameEn: l.elementId, nameAr: '' }) || l.elementId}
                </Typography.Text>
              )}
            </Space>
          </List.Item>
        )}
      />
      {canEdit && element && (
        <Space direction="vertical" style={{ width: '100%', marginBlockStart: 12 }}>
          {types.map((type) => (
            <ObjectPicker
              key={type}
              type={type}
              exclude={
                new Set(rows.filter((r) => r.repoObject.type === type).map((r) => r.repoObject.id))
              }
              onPick={(o) => void add(o.id)}
            />
          ))}
        </Space>
      )}
    </div>
  );
}
