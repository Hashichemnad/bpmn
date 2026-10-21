import { useMemo, useState } from 'react';
import {
  App,
  Badge,
  Button,
  Card,
  Drawer,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  TreeSelect,
  Typography,
  type TableProps,
} from 'antd';
import { EditOutlined, KeyOutlined, LockOutlined, MoreOutlined, PlusOutlined, StopOutlined, UnlockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  SYSTEM_ROLE_KEYS,
  buildTree,
  type DepartmentDto,
  type SystemRoleKey,
  type TreeNode,
  type UserDto,
  type UserStatus,
} from '@processhub/shared';
import { useDepartments, useResetPassword, useSaveUser, useUnlockUser, useUsers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { BilingualFields } from '@/components/BilingualFields';
import { ErrorState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { PasswordPolicyHint, passwordRules } from './password';

export function useDepartmentTreeData() {
  const departments = useDepartments();
  const loc = useLocalized();
  return useMemo(() => {
    type Node = { title: string; value: string; children: Node[] };
    const map = (nodes: TreeNode<DepartmentDto>[]): Node[] =>
      nodes.map((d) => ({ title: loc(d), value: d.id, children: map(d.children) }));
    return map(buildTree(departments.data ?? []));
  }, [departments.data, loc]);
}

interface Filters {
  q?: string;
  role?: SystemRoleKey;
  status?: UserStatus;
  page: number;
  pageSize: number;
  sort?: string;
  order: 'asc' | 'desc';
}

export function UsersPage() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const [filters, setFilters] = useState<Filters>({ page: 1, pageSize: 20, order: 'asc', sort: 'email' });
  const users = useUsers({ ...filters });
  const saveUser = useSaveUser();
  const unlock = useUnlockUser();
  const resetPassword = useResetPassword();
  const departmentTree = useDepartmentTreeData();
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserDto | null>(null);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();

  const roleOptions = SYSTEM_ROLE_KEYS.filter((r) => r !== 'SUPER_ADMIN' || me?.roles.includes('SUPER_ADMIN')).map(
    (r) => ({ value: r, label: t(`admin:roles.${r}`) }),
  );

  const openEditor = (u: UserDto | 'new') => {
    setEditing(u);
    form.resetFields();
    form.setFieldsValue(
      u === 'new'
        ? { locale: 'en', roles: ['VIEWER'] }
        : { email: u.email, nameEn: u.nameEn, nameAr: u.nameAr, locale: u.locale, roles: u.roles, departmentId: u.department?.id ?? null },
    );
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      await saveUser.mutateAsync({ id: editing === 'new' ? undefined : editing?.id, body: values });
      message.success(t('saved'));
      setEditing(null);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const toggleStatus = (u: UserDto) => {
    const deactivate = u.status === 'ACTIVE';
    modal.confirm({
      title: deactivate ? t('admin:users.deactivateTitle', { name: loc(u) || u.email }) : t('admin:users.activateTitle', { name: loc(u) || u.email }),
      content: deactivate ? t('admin:users.deactivateText') : undefined,
      okText: deactivate ? t('admin:users.deactivate') : t('admin:users.activate'),
      okButtonProps: { danger: deactivate },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await saveUser.mutateAsync({ id: u.id, body: { status: deactivate ? 'INACTIVE' : 'ACTIVE' } });
          message.success(t('saved'));
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });
  };

  const submitReset = async () => {
    const { newPassword } = await resetForm.validateFields();
    try {
      await resetPassword.mutateAsync({ id: resetting!.id, newPassword });
      message.success(t('admin:users.passwordReset'));
      setResetting(null);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const columns: TableProps<UserDto>['columns'] = [
    {
      title: t('fields.name'),
      key: 'nameEn',
      sorter: true,
      render: (_, u) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{loc(u) || '—'}</Typography.Text>
          <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
            {u.email}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('fields.roles'),
      dataIndex: 'roles',
      render: (roles: SystemRoleKey[]) => roles.map((r) => <Tag key={r}>{t(`admin:roles.${r}`)}</Tag>),
    },
    { title: t('fields.department'), key: 'department', render: (_, u) => loc(u.department) || '—' },
    {
      title: t('fields.status'),
      dataIndex: 'status',
      sorter: true,
      render: (_, u) =>
        u.lockedUntil ? (
          <Badge status="warning" text={t('admin:users.locked')} />
        ) : (
          <Badge status={u.status === 'ACTIVE' ? 'success' : 'default'} text={t(`admin:status.${u.status}`)} />
        ),
    },
    { title: t('admin:users.lastLogin'), dataIndex: 'lastLoginAt', sorter: true, render: (v: string | null) => formatDate(v) },
    {
      title: '',
      key: 'actions',
      width: 56,
      render: (_, u) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'edit', icon: <EditOutlined />, label: t('edit'), onClick: () => openEditor(u) },
              { key: 'reset', icon: <KeyOutlined />, label: t('admin:users.resetPassword'), onClick: () => { resetForm.resetFields(); setResetting(u); } },
              ...(u.lockedUntil
                ? [{ key: 'unlock', icon: <UnlockOutlined />, label: t('admin:users.unlock'), onClick: () => void unlock.mutateAsync(u.id).then(() => message.success(t('saved')), (e) => message.error(errorMessage(e))) }]
                : []),
              ...(u.id !== me?.id
                ? [{
                    key: 'status',
                    icon: u.status === 'ACTIVE' ? <StopOutlined /> : <LockOutlined />,
                    danger: u.status === 'ACTIVE',
                    label: u.status === 'ACTIVE' ? t('admin:users.deactivate') : t('admin:users.activate'),
                    onClick: () => toggleStatus(u),
                  }]
                : []),
            ],
          }}
        >
          <Button type="text" icon={<MoreOutlined />} aria-label={t('actions')} />
        </Dropdown>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('admin:users.title')}
        subtitle={t('admin:users.subtitle')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>
            {t('admin:users.new')}
          </Button>
        }
      />
      <Card>
        <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('admin:users.searchPlaceholder')}
            style={{ width: 280 }}
            onSearch={(q) => setFilters((f) => ({ ...f, q: q || undefined, page: 1 }))}
          />
          <Select
            allowClear
            placeholder={t('fields.role')}
            style={{ width: 200 }}
            options={SYSTEM_ROLE_KEYS.map((r) => ({ value: r, label: t(`admin:roles.${r}`) }))}
            onChange={(role) => setFilters((f) => ({ ...f, role, page: 1 }))}
          />
          <Select
            allowClear
            placeholder={t('fields.status')}
            style={{ width: 160 }}
            options={(['ACTIVE', 'INACTIVE'] as const).map((s) => ({ value: s, label: t(`admin:status.${s}`) }))}
            onChange={(status) => setFilters((f) => ({ ...f, status, page: 1 }))}
          />
        </Flex>
        {users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <Table<UserDto>
            rowKey="id"
            columns={columns}
            dataSource={users.data?.items}
            loading={users.isFetching}
            scroll={{ x: 800 }}
            locale={{ emptyText: t('admin:users.empty') }}
            pagination={{
              current: filters.page,
              pageSize: filters.pageSize,
              total: users.data?.total,
              showSizeChanger: true,
              showTotal: (total) => t('totalItems', { count: total }),
            }}
            onChange={(p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              setFilters((f) => ({
                ...f,
                page: p.current ?? 1,
                pageSize: p.pageSize ?? 20,
                sort: s?.order ? String(s.columnKey ?? s.field) : 'email',
                order: s?.order === 'descend' ? 'desc' : 'asc',
              }));
            }}
          />
        )}
      </Card>

      <Drawer
        title={editing === 'new' ? t('admin:users.new') : t('admin:users.edit')}
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={560}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setEditing(null)}>{t('cancel')}</Button>
            <Button type="primary" loading={saveUser.isPending} onClick={() => void submit()}>
              {t('save')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item name="email" label={t('fields.email')} rules={[{ required: true, message: t('validation.required') }, { type: 'email', message: t('validation.email') }]}>
            <Input dir="ltr" autoComplete="off" />
          </Form.Item>
          <BilingualFields />
          {editing === 'new' && (
            <Form.Item name="password" label={t('admin:users.initialPassword')} rules={passwordRules(t)} extra={<PasswordPolicyHint />}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item name="roles" label={t('fields.roles')} rules={[{ required: true, message: t('validation.required') }]}>
            <Select mode="multiple" options={roleOptions} disabled={editing !== 'new' && editing?.id === me?.id} />
          </Form.Item>
          <Form.Item name="departmentId" label={t('fields.department')}>
            <TreeSelect allowClear treeData={departmentTree} treeDefaultExpandAll placeholder={t('none')} />
          </Form.Item>
          <Form.Item name="locale" label={t('profile.language')}>
            <Select options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title={t('admin:users.resetPasswordFor', { name: resetting ? loc(resetting) || resetting.email : '' })}
        open={!!resetting}
        onCancel={() => setResetting(null)}
        onOk={() => void submitReset()}
        okText={t('admin:users.resetPassword')}
        cancelText={t('cancel')}
        confirmLoading={resetPassword.isPending}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">{t('admin:users.resetPasswordText')}</Typography.Paragraph>
        <Form form={resetForm} layout="vertical">
          <Form.Item name="newPassword" label={t('profile.newPassword')} rules={passwordRules(t)} extra={<PasswordPolicyHint />}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
