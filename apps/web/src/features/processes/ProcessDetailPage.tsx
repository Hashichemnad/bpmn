import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Flex,
  List,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  BranchesOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type ObjectLinkDto } from '@processhub/shared';
import { useDeleteProcess, useLinks, useProcess } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { CategoryTag, StatusTag } from '@/components/tags';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ProcessFormModal } from './ProcessFormModal';
import { BpmnEditor } from '@/features/modeler/BpmnEditor';
import { RelatedDocsCard } from '@/features/docs/RelatedDocsCard';
import { useRelatedPages } from '@/api/docs';

type Tab = 'overview' | 'subprocesses' | 'objects' | 'docs' | 'model';

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();
  const process = useProcess(id);
  const links = useLinks(id!);
  const remove = useDeleteProcess();
  const related = useRelatedPages('processes', id, can(PERMISSIONS.DOCS_READ));
  const [modalState, setModalState] = useState<'edit' | 'sub' | null>(null);
  const tab = (params.get('tab') as Tab) || 'overview';

  const linksByObject = useMemo(() => {
    const grouped = new Map<
      string,
      { object: ObjectLinkDto['repoObject']; elements: ObjectLinkDto[] }
    >();
    for (const l of links.data ?? []) {
      const g = grouped.get(l.repoObject.id) ?? { object: l.repoObject, elements: [] };
      g.elements.push(l);
      grouped.set(l.repoObject.id, g);
    }
    return [...grouped.values()];
  }, [links.data]);

  if (process.isLoading) return <LoadingState />;
  if (process.isError || !process.data)
    return <ErrorState error={process.error} onRetry={() => void process.refetch()} />;
  const p = process.data;

  const confirmDelete = () =>
    modal.confirm({
      title: t('processes:deleteTitle', { name: loc(p) }),
      content: p.children.length ? t('processes:deleteHasChildren') : t('processes:deleteText'),
      okText: t('delete'),
      okButtonProps: { danger: true, disabled: p.children.length > 0 },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await remove.mutateAsync(p.id);
          message.success(t('deleted'));
          navigate(p.parentId ? `/processes/${p.parentId}` : '/processes');
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const openModelAt = (elementId: string) => setParams({ tab: 'model', element: elementId });

  const actionItems = [
    ...(can(PERMISSIONS.PROCESSES_CREATE)
      ? [
          {
            key: 'sub',
            icon: <PlusOutlined />,
            label: t('processes:addSubProcess'),
            onClick: () => setModalState('sub'),
          },
        ]
      : []),
    ...(p.canDelete
      ? [
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            danger: true,
            label: t('delete'),
            onClick: confirmDelete,
          },
        ]
      : []),
  ];

  const overview = (
    <Row gutter={[24, 24]}>
      <Col xs={24} xl={16}>
        <Card title={t('processes:description')}>
          {p.descriptionEn || p.descriptionAr ? (
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary">{t('fields.descriptionEn')}</Typography.Text>
                <Typography.Paragraph dir="ltr" lang="en" className="ph-prewrap">
                  {p.descriptionEn || '—'}
                </Typography.Paragraph>
              </Col>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary">{t('fields.descriptionAr')}</Typography.Text>
                <Typography.Paragraph dir="rtl" lang="ar" className="ph-prewrap">
                  {p.descriptionAr || '—'}
                </Typography.Paragraph>
              </Col>
            </Row>
          ) : (
            <Typography.Text type="secondary">{t('processes:noDescription')}</Typography.Text>
          )}
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card title={t('processes:details')}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t('fields.code')}>
              <span dir="ltr">{p.code}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.nameEn')}>
              <span dir="ltr">{p.nameEn || '—'}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.nameAr')}>
              <span dir="rtl">{p.nameAr || '—'}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.category')}>
              <CategoryTag category={p.category} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.status')}>
              <StatusTag status={p.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.owner')}>
              {loc(p.owner) || p.owner?.email || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.department')}>
              {loc(p.department) || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('processes:level')}>{p.level}</Descriptions.Item>
            <Descriptions.Item label={t('fields.updatedAt')}>
              {formatDate(p.updatedAt)}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );

  const subprocesses = (
    <Card
      title={t('processes:subProcesses')}
      extra={
        can(PERMISSIONS.PROCESSES_CREATE) && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setModalState('sub')}>
            {t('processes:addSubProcess')}
          </Button>
        )
      }
    >
      {p.children.length === 0 ? (
        <EmptyState description={t('processes:noSubProcesses')} />
      ) : (
        <List
          dataSource={p.children}
          renderItem={(c) => (
            <List.Item extra={<StatusTag status={c.status} />}>
              <List.Item.Meta
                avatar={<BranchesOutlined style={{ color: '#64748b', marginTop: 4 }} />}
                title={<Link to={`/processes/${c.id}`}>{loc(c)}</Link>}
                description={<span dir="ltr">{c.code}</span>}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );

  const objects = (
    <Card title={t('processes:linkedObjects')}>
      <Table
        rowKey={(r) => r.object.id}
        loading={links.isLoading}
        dataSource={linksByObject}
        pagination={false}
        locale={{ emptyText: <EmptyState description={t('processes:noLinkedObjects')} /> }}
        columns={[
          {
            title: t('fields.name'),
            key: 'name',
            render: (_, r) => <Link to={`/library/objects/${r.object.id}`}>{loc(r.object)}</Link>,
          },
          {
            title: t('fields.type'),
            key: 'type',
            width: 140,
            render: (_, r) => <Tag>{t(`objects:types.${r.object.type}`)}</Tag>,
          },
          {
            title: t('processes:usedIn'),
            key: 'elements',
            render: (_, r) => (
              <Space wrap size={4}>
                {r.elements.map((l) => (
                  <Tag
                    key={l.id}
                    className="ph-clickable"
                    onClick={() => openModelAt(l.bpmnElementId)}
                    color="blue"
                  >
                    {loc(l.element) || <span dir="ltr">{l.bpmnElementId}</span>} ·{' '}
                    {t(`objects:relations.${l.relation}`)}
                  </Tag>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.processHouse'), to: '/' },
          ...p.ancestors.map((a) => ({ title: `${a.code} ${loc(a)}`, to: `/processes/${a.id}` })),
          { title: p.code },
        ]}
        title={
          <Flex align="center" gap={10} wrap="wrap">
            <span className="ph-title-code" dir="ltr">
              {p.code}
            </span>
            <span>{loc(p)}</span>
          </Flex>
        }
        subtitle={
          <Space size={6} style={{ marginTop: 4 }}>
            <CategoryTag category={p.category} />
            <StatusTag status={p.status} />
          </Space>
        }
        extra={
          <>
            {p.canEdit && (
              <Button icon={<EditOutlined />} onClick={() => setModalState('edit')}>
                {t('edit')}
              </Button>
            )}
            {actionItems.length > 0 && (
              <Dropdown menu={{ items: actionItems }} trigger={['click']}>
                <Button>
                  {t('more')} <DownOutlined />
                </Button>
              </Dropdown>
            )}
          </>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams(k === 'overview' ? {} : { tab: k })}
        destroyOnHidden={false}
        items={[
          { key: 'overview', label: t('processes:tabs.overview'), children: overview },
          {
            key: 'subprocesses',
            label: `${t('processes:tabs.subprocesses')} (${p.children.length})`,
            children: subprocesses,
          },
          {
            key: 'objects',
            label: `${t('processes:tabs.objects')} (${linksByObject.length})`,
            children: objects,
          },
          ...(can(PERMISSIONS.DOCS_READ)
            ? [
                {
                  key: 'docs',
                  label: `${t('processes:tabs.docs')} (${related.data?.length ?? 0})`,
                  children: <RelatedDocsCard kind="processes" id={p.id} />,
                },
              ]
            : []),
          {
            key: 'model',
            label: t('processes:tabs.model'),
            children: tab === 'model' && (
              <BpmnEditor
                key={p.id}
                process={p}
                focusElementId={params.get('element') ?? undefined}
              />
            ),
          },
        ]}
      />
      {modalState === 'edit' && (
        <ProcessFormModal open mode="edit" process={p} onClose={() => setModalState(null)} />
      )}
      {modalState === 'sub' && (
        <ProcessFormModal open mode="create" parent={p} onClose={() => setModalState(null)} />
      )}
    </>
  );
}
