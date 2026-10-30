import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  TreeSelect,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  CAPABILITY_MAX_LEVEL,
  STRATEGIC_IMPORTANCE,
  buildTree,
  type CapabilityDto,
  type TreeNode,
} from '@processhub/shared';
import { useCapabilities, useDeleteEa, useEaImport, useSaveEa } from '@/api/ea';
import { PageHeader } from '@/components/PageHeader';
import { ExcelMenu } from '@/components/ExcelMenu';
import { BilingualFields } from '@/components/BilingualFields';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { ApplicationSelect, CapabilitySelect } from './ea-components';
import { applicationPath, useEaAccess, useEaLabel, useEnumOptions } from './ea-helpers';
import { CapabilityMap } from './CapabilityMap';

const useCapabilityImport = () => useEaImport('capabilities');
type Row = Omit<TreeNode<CapabilityDto>, 'children'> & { children?: Row[] };

/** Business capability map: tree list and the map view (levels 1–3). */
export function CapabilitiesPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useEaLabel();
  const access = useEaAccess();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'map';
  const caps = useCapabilities();
  const remove = useDeleteEa('capability');
  const [editing, setEditing] = useState<{ item?: CapabilityDto; parentId?: string } | null>(null);

  const rows = useMemo(() => {
    const strip = (nodes: TreeNode<CapabilityDto>[]): Row[] =>
      nodes.map((n) => ({ ...n, children: n.children.length ? strip(n.children) : undefined }));
    return strip(buildTree(caps.data ?? []));
  }, [caps.data]);

  const setView = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'list') next.set('view', 'list');
    else next.delete('view');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('ea:capabilities.title')}
        subtitle={t('ea:capabilities.subtitle')}
        extra={
          <>
            <Segmented
              value={view}
              onChange={(v) => setView(String(v))}
              options={[
                { value: 'map', label: t('ea:capabilities.map') },
                { value: 'list', label: t('ea:capabilities.tree') },
              ]}
            />
            <ExcelMenu
              basePath="/ea"
              kind="capabilities"
              title={t('ea:capabilities.title')}
              canImport={access.canEdit}
              useImport={useCapabilityImport}
            />
            {access.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
                {t('ea:capabilities.new')}
              </Button>
            )}
          </>
        }
      />
      {caps.isLoading ? (
        <LoadingState />
      ) : caps.isError ? (
        <ErrorState error={caps.error} onRetry={() => void caps.refetch()} />
      ) : view === 'map' ? (
        <CapabilityMap capabilities={caps.data ?? []} />
      ) : (
        <Card>
          <Table<Row>
            rowKey="id"
            size="middle"
            dataSource={rows}
            pagination={false}
            expandable={{ defaultExpandAllRows: true }}
            locale={{ emptyText: <EmptyState description={t('ea:capabilities.empty')} /> }}
            columns={[
              {
                title: t('ea:fields.name'),
                key: 'n',
                render: (_, c) => (
                  <Space>
                    <span>{label(c)}</span>
                    <Tag>{t('ea:capabilities.level', { level: c.level })}</Tag>
                  </Space>
                ),
              },
              {
                title: t('ea:fields.importance'),
                key: 'i',
                width: 140,
                render: (_, c) => t(`ea:importance.${c.importance}`),
              },
              {
                title: t('ea:fields.processes'),
                key: 'p',
                render: (_, c) =>
                  c.processes.map((p) => (
                    <Tag key={p.id}>
                      <Link to={`/processes/${p.id}`}>
                        {p.code} {loc(p)}
                      </Link>
                    </Tag>
                  )),
              },
              {
                title: t('ea:fields.applications'),
                key: 'a',
                render: (_, c) =>
                  c.applications.map((a) => (
                    <Tag key={a.id}>
                      <Link to={applicationPath(a.id)}>{a.code || loc(a)}</Link>
                    </Tag>
                  )),
              },
              {
                title: t('ea:fields.owner'),
                key: 'o',
                width: 150,
                render: (_, c) => (c.owner ? loc(c.owner) || c.owner.email : '—'),
              },
              ...(access.canEdit
                ? [
                    {
                      title: '',
                      key: 'actions',
                      width: 130,
                      render: (_: unknown, c: Row) => (
                        <Space size={0}>
                          {c.level < CAPABILITY_MAX_LEVEL && (
                            <Button
                              type="text"
                              icon={<PlusOutlined />}
                              aria-label={t('ea:capabilities.newChild')}
                              title={t('ea:capabilities.newChild')}
                              onClick={() => setEditing({ parentId: c.id })}
                            />
                          )}
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            aria-label={t('edit')}
                            onClick={() =>
                              setEditing({ item: caps.data?.find((x) => x.id === c.id) })
                            }
                          />
                          {access.canAdmin && !c.children?.length && (
                            <Popconfirm
                              title={t('ea:capabilities.deleteConfirm')}
                              onConfirm={() =>
                                remove.mutate(c.id, {
                                  onError: (err) => message.error(errorMessage(err)),
                                })
                              }
                            >
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                aria-label={t('delete')}
                              />
                            </Popconfirm>
                          )}
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}
      {editing && (
        <CapabilityFormModal
          item={editing.item}
          parentId={editing.parentId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function CapabilityFormModal({
  item,
  parentId,
  onClose,
}: {
  item?: CapabilityDto;
  parentId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm();
  const save = useSaveEa('capability');
  const importance = useEnumOptions('importance', STRATEGIC_IMPORTANCE);
  const processes = useProcessTreeOptions('');
  const initial = item
    ? {
        ...item,
        ownerId: item.owner?.id ?? null,
        processIds: item.processes.map((p) => p.id),
        applicationIds: item.applications.map((a) => a.id),
      }
    : { parentId: parentId ?? null, importance: 'MEDIUM', processIds: [], applicationIds: [] };

  return (
    <Modal
      open
      width={760}
      title={item ? t('ea:capabilities.edit') : t('ea:capabilities.new')}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={(v: Record<string, unknown>) =>
          save.mutate(
            {
              id: item?.id,
              body: {
                code: v.code || null,
                nameEn: v.nameEn ?? '',
                nameAr: v.nameAr ?? '',
                descriptionEn: v.descriptionEn ?? '',
                descriptionAr: v.descriptionAr ?? '',
                parentId: v.parentId ?? null,
                importance: v.importance,
                ownerId: v.ownerId ?? null,
                ...(v.sortOrder !== undefined && v.sortOrder !== null
                  ? { sortOrder: v.sortOrder }
                  : {}),
                processIds: v.processIds ?? [],
                applicationIds: v.applicationIds ?? [],
              },
            },
            {
              onSuccess: () => {
                message.success(t('saved'));
                onClose();
              },
              onError: (err) => message.error(errorMessage(err)),
            },
          )
        }
      >
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="code" label={t('ea:fields.code')}>
              <Input dir="ltr" maxLength={50} />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="parentId" label={t('ea:fields.parent')}>
              <CapabilitySelect exclude={item?.id} maxLevel={CAPABILITY_MAX_LEVEL - 1} />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="sortOrder" label="#">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <BilingualFields description />
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="importance" label={t('ea:fields.importance')}>
              <Select options={importance} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="ownerId" label={t('ea:fields.owner')}>
              <UserSelect allowClear known={item?.owner ? [item.owner] : []} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="processIds" label={t('ea:fields.processes')}>
          <TreeSelect
            multiple
            treeData={processes.options}
            showSearch
            treeNodeFilterProp="title"
            treeDefaultExpandAll
            allowClear
          />
        </Form.Item>
        <Form.Item name="applicationIds" label={t('ea:fields.applications')}>
          <ApplicationSelect multiple />
        </Form.Item>
      </Form>
    </Modal>
  );
}
