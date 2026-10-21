import { useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Space, Table, TreeSelect, Typography, type TableProps } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { buildTree, descendantIds, type DepartmentDto, type TreeNode } from '@processhub/shared';
import { useDeleteDepartment, useDepartments, useSaveDepartment } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { BilingualFields } from '@/components/BilingualFields';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';

type Row = Omit<TreeNode<DepartmentDto>, 'children'> & { children?: Row[] };

export function DepartmentsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const departments = useDepartments();
  const save = useSaveDepartment();
  const remove = useDeleteDepartment();
  const [editing, setEditing] = useState<DepartmentDto | 'new' | null>(null);
  const [form] = Form.useForm();

  const rows = useMemo(() => {
    // Ant Design treats an empty children array as expandable; drop it for leaves.
    const strip = (nodes: TreeNode<DepartmentDto>[]): Row[] =>
      nodes.map(({ children, ...d }) => ({ ...d, children: children.length ? strip(children) : undefined }));
    return strip(buildTree(departments.data ?? []));
  }, [departments.data]);

  const parentOptions = useMemo(() => {
    const exclude = new Set(
      editing && editing !== 'new' ? [editing.id, ...descendantIds(departments.data ?? [], editing.id)] : [],
    );
    type Node = { title: string; value: string; disabled: boolean; children: Node[] };
    const map = (nodes: TreeNode<DepartmentDto>[]): Node[] =>
      nodes.map((d) => ({ title: loc(d), value: d.id, disabled: exclude.has(d.id), children: map(d.children) }));
    return map(buildTree(departments.data ?? []));
  }, [departments.data, editing, loc]);

  const open = (d: DepartmentDto | 'new', parentId?: string) => {
    setEditing(d);
    form.resetFields();
    form.setFieldsValue(d === 'new' ? { parentId: parentId ?? null } : { nameEn: d.nameEn, nameAr: d.nameAr, code: d.code, parentId: d.parentId });
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      await save.mutateAsync({ id: editing === 'new' ? undefined : editing?.id, body: { ...values, parentId: values.parentId ?? null } });
      message.success(t('saved'));
      setEditing(null);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const confirmDelete = (d: DepartmentDto) =>
    modal.confirm({
      title: t('admin:departments.deleteTitle', { name: loc(d) }),
      content: t('admin:departments.deleteText'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await remove.mutateAsync(d.id);
          message.success(t('deleted'));
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const columns: TableProps<Row>['columns'] = [
    { title: t('fields.name'), key: 'name', render: (_, d) => <Typography.Text strong>{loc(d)}</Typography.Text> },
    { title: t('fields.code'), dataIndex: 'code', render: (v: string | null) => v || '—', width: 140 },
    { title: t('admin:departments.users'), dataIndex: 'userCount', width: 120 },
    {
      title: '',
      key: 'actions',
      width: 160,
      render: (_, d) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => open('new', d.id)} aria-label={t('admin:departments.addChild')} title={t('admin:departments.addChild')} />
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => open(d)} aria-label={t('edit')} title={t('edit')} />
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(d)} aria-label={t('delete')} title={t('delete')} />
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('admin:departments.title')}
        subtitle={t('admin:departments.subtitle')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {t('admin:departments.new')}
          </Button>
        }
      />
      <Card>
        {departments.isError ? (
          <ErrorState error={departments.error} onRetry={() => void departments.refetch()} />
        ) : (
          <Table<Row>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            loading={departments.isLoading}
            pagination={false}
            expandable={{ defaultExpandAllRows: true }}
            locale={{
              emptyText: (
                <EmptyState
                  description={t('admin:departments.empty')}
                  action={<Button onClick={() => open('new')}>{t('admin:departments.new')}</Button>}
                />
              ),
            }}
          />
        )}
      </Card>
      <Modal
        title={editing === 'new' ? t('admin:departments.new') : t('admin:departments.edit')}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={save.isPending}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <BilingualFields />
          <Form.Item name="code" label={t('fields.code')}>
            <Input dir="ltr" maxLength={50} style={{ maxWidth: 200 }} />
          </Form.Item>
          <Form.Item name="parentId" label={t('admin:departments.parent')}>
            <TreeSelect allowClear treeData={parentOptions} treeDefaultExpandAll placeholder={t('admin:departments.topLevel')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
