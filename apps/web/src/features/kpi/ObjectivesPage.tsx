import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  Space,
  Table,
  Tag,
  TreeSelect,
} from 'antd';
import { CloudOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { buildTree, type ObjectiveDto, type TreeNode } from '@processhub/shared';
import { useDeleteObjective, useKpiImport, useObjectives, useSaveObjective } from '@/api/kpi';
import { PageHeader } from '@/components/PageHeader';
import { ExcelMenu } from '@/components/ExcelMenu';
import { BilingualFields } from '@/components/BilingualFields';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { useKpiAccess, useObjectiveTreeData } from './kpi-helpers';

type Row = Omit<TreeNode<ObjectiveDto>, 'children'> & { children?: Row[] };
const useObjectivesImport = () => useKpiImport('objectives');

/** Strategic objectives: a simple bilingual hierarchy the KPIs contribute to. */
export function ObjectivesPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const access = useKpiAccess();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const objectives = useObjectives();
  const remove = useDeleteObjective();
  const [editing, setEditing] = useState<{ item?: ObjectiveDto; parentId?: string } | null>(null);
  const rows = useMemo(() => {
    const strip = (nodes: TreeNode<ObjectiveDto>[]): Row[] =>
      nodes.map((n) => ({ ...n, children: n.children.length ? strip(n.children) : undefined }));
    return strip(buildTree(objectives.data ?? []));
  }, [objectives.data]);

  return (
    <>
      <PageHeader
        title={t('kpi:objectives.title')}
        subtitle={t('kpi:objectives.subtitle')}
        extra={
          <>
            <ExcelMenu
              basePath="/kpis"
              kind="objectives"
              title={t('kpi:objectives.title')}
              canImport={access.canEdit}
              useImport={useObjectivesImport}
            />
            {access.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
                {t('kpi:objectives.new')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        {objectives.isError ? (
          <ErrorState error={objectives.error} onRetry={() => void objectives.refetch()} />
        ) : (
          <Table<Row>
            rowKey="id"
            loading={objectives.isLoading}
            dataSource={rows}
            pagination={false}
            expandable={{ defaultExpandAllRows: true }}
            locale={{ emptyText: <EmptyState description={t('kpi:objectives.empty')} /> }}
            columns={[
              {
                title: t('kpi:fields.name').replace(/.*/, t('kpi:objectives.title')),
                key: 'n',
                render: (_, o) => (
                  <Space>
                    <Link to={`/kpis?objectiveId=${o.id}`}>
                      {[o.code, loc(o)].filter(Boolean).join(' · ')}
                    </Link>
                    {o.salesforceId && (
                      <Tag icon={<CloudOutlined />} color="blue">
                        Salesforce
                      </Tag>
                    )}
                  </Space>
                ),
              },
              {
                title: t('kpi:objectives.kpis'),
                key: 'k',
                width: 100,
                render: (_, o) => o.kpiCount,
              },
              {
                title: t('kpi:fields.owner'),
                key: 'o',
                width: 180,
                render: (_, o) => (o.owner ? loc(o.owner) || o.owner.email : '—'),
              },
              ...(access.canEdit
                ? [
                    {
                      key: 'a',
                      width: 130,
                      render: (_: unknown, o: Row) => (
                        <Space size={0}>
                          <Button
                            type="text"
                            icon={<PlusOutlined />}
                            aria-label={t('kpi:objectives.new')}
                            onClick={() => setEditing({ parentId: o.id })}
                          />
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            aria-label={t('edit')}
                            onClick={() =>
                              setEditing({ item: objectives.data?.find((x) => x.id === o.id) })
                            }
                          />
                          {!o.children?.length && (
                            <Popconfirm
                              title={t('kpi:objectives.deleteConfirm')}
                              onConfirm={() =>
                                remove.mutate(o.id, {
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
        )}
      </Card>
      {editing && (
        <ObjectiveFormModal
          item={editing.item}
          parentId={editing.parentId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ObjectiveFormModal({
  item,
  parentId,
  onClose,
}: {
  item?: ObjectiveDto;
  parentId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm();
  const save = useSaveObjective();
  const tree = useObjectiveTreeData();
  return (
    <Modal
      open
      width={720}
      title={item ? t('kpi:objectives.edit') : t('kpi:objectives.new')}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          item ? { ...item, ownerId: item.owner?.id ?? null } : { parentId: parentId ?? null }
        }
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
                ownerId: v.ownerId ?? null,
                ...(typeof v.sortOrder === 'number' ? { sortOrder: v.sortOrder } : {}),
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
            <Form.Item name="code" label={t('kpi:fields.code')}>
              <Input dir="ltr" maxLength={50} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="parentId" label={t('kpi:fields.parent')}>
              <TreeSelect treeData={tree} allowClear treeDefaultExpandAll />
            </Form.Item>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item name="sortOrder" label="#">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <BilingualFields description />
        <Form.Item name="ownerId" label={t('kpi:fields.owner')}>
          <UserSelect allowClear known={item?.owner ? [item.owner] : []} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
