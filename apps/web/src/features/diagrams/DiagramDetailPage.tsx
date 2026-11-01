import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Flex,
  List,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FilePptOutlined,
  FormOutlined,
  GlobalOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ExportDialog, type ExportRequest } from '@/features/exports/ExportDialog';
import { useComments, useGovernance } from '@/api/governance';
import {
  useDeleteDiagram,
  useDiagram,
  useDiagramContent,
  useDiagramLinks,
  useDiagramWhereUsed,
} from '@/api/diagrams';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { PageHeader } from '@/components/PageHeader';
import { StatusTag } from '@/components/tags';
import { ImportedTag } from '@/components/ImportedTag';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { GovernancePanel } from '@/features/governance/GovernancePanel';
import { DiagramFormModal } from './DiagramFormModal';
import { DiagramTypeIcon } from './DiagramTypeIcon';
import { DiagramView } from './DiagramView';
import { DiagramVersionsDrawer } from './DiagramVersionsDrawer';

/** /diagrams/:id — details, preview, lifecycle, links, where used and comments of a diagram. */
export function DiagramDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();
  const diagram = useDiagram(id);
  const content = useDiagramContent(id);
  const links = useDiagramLinks(id);
  const usage = useDiagramWhereUsed({ diagramId: id });
  const comments = useComments('DIAGRAM', id);
  const governance = useGovernance('DIAGRAM', id);
  const remove = useDeleteDiagram();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [exportReq, setExportReq] = useState<ExportRequest | null>(null);
  const tab = params.get('tab') ?? 'overview';

  if (diagram.isLoading) return <LoadingState />;
  if (diagram.isError || !diagram.data)
    return <ErrorState error={diagram.error} onRetry={() => void diagram.refetch()} />;
  const d = diagram.data;

  const confirmDelete = () =>
    modal.confirm({
      title: t('diagrams:deleteTitle', { name: loc(d) }),
      content: t('diagrams:deleteText'),
      okButtonProps: { danger: true },
      okText: t('delete'),
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await remove.mutateAsync(d.id);
          message.success(t('diagrams:deleted'));
          navigate(d.processId ? `/processes/${d.processId}` : '/processes');
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const overview = (
    <Row gutter={[24, 24]}>
      <Col xs={24} xl={16}>
        <Card
          title={t('diagrams:preview')}
          extra={
            <Link to={`/diagrams/${d.id}/edit`}>
              <Button type="primary" icon={d.canEditContent ? <FormOutlined /> : undefined}>
                {d.canEditContent ? t('diagrams:openEditor') : t('diagrams:openViewer')}
              </Button>
            </Link>
          }
        >
          {(d.descriptionEn || d.descriptionAr) && (
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
              {loc(d, 'description')}
            </Typography.Paragraph>
          )}
          {content.data ? (
            <DiagramView type={d.type} content={content.data.content} height={460} />
          ) : (
            <LoadingState />
          )}
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <GovernancePanel type="DIAGRAM" id={d.id} />
        <Card title={t('processes:details')} style={{ marginBlockStart: 24 }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t('fields.code')}>
              <span dir="ltr">{d.code}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('diagrams:fields.type')}>
              <Space size={6}>
                <DiagramTypeIcon type={d.type} />
                {t(`diagrams:type.${d.type}`)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.nameEn')}>{d.nameEn || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('fields.nameAr')}>
              <span dir="rtl">{d.nameAr || '—'}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('diagrams:fields.process')}>
              {d.process ? (
                <Link to={`/processes/${d.process.id}`}>
                  <span dir="ltr">{d.process.code}</span> {loc(d.process)}
                </Link>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.owner')}>
              {d.owner ? loc(d.owner) || d.owner.email : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.department')}>
              {d.department ? loc(d.department) : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('modeler:versions')}>
              {d.latestVersion ? `v${d.latestVersion}` : t('modeler:noVersionYet')}
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.updatedAt')}>
              {formatDate(d.updatedAt)}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );

  const linkRows = links.data ?? [];
  const usageRows = usage.data ?? [];

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.processHouse'), to: '/' },
          ...(d.process
            ? [{ title: `${d.process.code} ${loc(d.process)}`, to: `/processes/${d.process.id}` }]
            : []),
          { title: d.code },
        ]}
        title={
          <Flex align="center" gap={10} wrap="wrap">
            <DiagramTypeIcon type={d.type} />
            <span className="ph-title-code" dir="ltr">
              {d.code}
            </span>
            <span>{loc(d)}</span>
          </Flex>
        }
        subtitle={
          <Space size={6} style={{ marginTop: 4 }}>
            <Tag bordered={false}>{t(`diagrams:type.${d.type}`)}</Tag>
            <StatusTag
              status={d.status}
              changesRequested={governance.data?.changesRequested}
              rejected={governance.data?.rejected}
            />
            <ImportedTag origin={d.importOrigin} />
          </Space>
        }
        extra={
          <>
            {d.canEdit && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'history',
                    icon: <HistoryOutlined />,
                    label: t('modeler:versions'),
                    onClick: () => setHistory(true),
                  },
                  {
                    key: 'print',
                    label: t('diagrams:exportPdf'),
                    onClick: () => window.open(`/print/diagrams/${d.id}`, '_blank', 'noopener'),
                  },
                  ...(d.type === 'VALUE_CHAIN'
                    ? [
                        {
                          key: 'html',
                          icon: <GlobalOutlined />,
                          label: t('integrations:export.menuHtml'),
                          onClick: () =>
                            setExportReq({
                              format: 'html',
                              scope: 'VALUE_CHAIN',
                              id: d.id,
                              title: loc(d),
                            }),
                        },
                        {
                          key: 'pptx',
                          icon: <FilePptOutlined />,
                          label: t('integrations:export.menuPptx'),
                          onClick: () =>
                            setExportReq({
                              format: 'pptx',
                              scope: 'VALUE_CHAIN',
                              id: d.id,
                              title: loc(d),
                            }),
                        },
                      ]
                    : []),
                  ...(d.canDelete
                    ? [
                        { type: 'divider' as const },
                        {
                          key: 'delete',
                          danger: true,
                          icon: <DeleteOutlined />,
                          label: t('delete'),
                          onClick: confirmDelete,
                        },
                      ]
                    : []),
                ],
              }}
            >
              <Button>
                {t('more')} <DownOutlined />
              </Button>
            </Dropdown>
          </>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams(k === 'overview' ? {} : { tab: k })}
        items={[
          { key: 'overview', label: t('processes:tabs.overview'), children: overview },
          {
            key: 'objects',
            label: `${t('processes:tabs.objects')} (${linkRows.length})`,
            children: (
              <Card>
                <List
                  dataSource={linkRows}
                  locale={{ emptyText: <Empty description={t('diagrams:links.none')} /> }}
                  renderItem={(l) => (
                    <List.Item>
                      <Space wrap>
                        <Tag bordered={false}>{t(`objects:types.${l.repoObject.type}`)}</Tag>
                        <Link to={`/library/objects/${l.repoObject.id}`}>
                          {l.repoObject.code ? `${l.repoObject.code} · ` : ''}
                          {loc(l.repoObject)}
                        </Link>
                        <Typography.Text type="secondary">
                          ← {l.element ? loc(l.element) || l.elementId : l.elementId}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
          {
            key: 'usage',
            label: `${t('diagrams:whereUsed.tab')} (${usageRows.length})`,
            children: (
              <Card>
                <List
                  dataSource={usageRows}
                  locale={{ emptyText: <Empty description={t('diagrams:whereUsed.none')} /> }}
                  renderItem={(u) => (
                    <List.Item>
                      <Space wrap>
                        {u.diagram ? (
                          <>
                            <DiagramTypeIcon type={u.diagram.type} />
                            <Link to={`/diagrams/${u.diagram.id}`}>
                              <span dir="ltr">{u.diagram.code}</span> {loc(u.diagram)}
                            </Link>
                          </>
                        ) : u.process ? (
                          <>
                            <DiagramTypeIcon type={null} />
                            <Link
                              to={`/processes/${u.process.id}/model?element=${encodeURIComponent(u.elementId ?? '')}&view=1`}
                            >
                              <span dir="ltr">{u.process.code}</span> {loc(u.process)}
                            </Link>
                          </>
                        ) : null}
                        {u.element && (
                          <Typography.Text type="secondary">· {loc(u.element)}</Typography.Text>
                        )}
                        <Tag bordered={false}>{t(`diagrams:whereUsed.relation.${u.relation}`)}</Tag>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
          {
            key: 'comments',
            label: `${t('processes:tabs.comments')} (${(comments.data ?? []).filter((c) => !c.resolvedAt).length})`,
            children: (
              <Card>
                <CommentsPanel
                  type="DIAGRAM"
                  id={d.id}
                  onOpenElement={(el) =>
                    navigate(`/diagrams/${d.id}/edit?element=${encodeURIComponent(el)}`)
                  }
                />
              </Card>
            ),
          },
        ]}
      />
      {editing && (
        <DiagramFormModal open type={d.type} diagram={d} onClose={() => setEditing(false)} />
      )}
      <DiagramVersionsDrawer
        diagram={d}
        open={history}
        canEdit={d.canEditContent}
        onClose={() => setHistory(false)}
      />
      <ExportDialog request={exportReq} onClose={() => setExportReq(null)} />
    </>
  );
}
