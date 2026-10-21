import { useEffect, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Drawer,
  Flex,
  Form,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  type SpaceAccessLevel,
  type SpaceDto,
  type SpaceGrantInput,
  type SpacePrincipalType,
} from '@processhub/shared';
import { useDepartments, useUsers } from '@/api/hooks';
import { useSaveSpacePermissions, useSpacePermissions } from '@/api/docs';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';

interface Row extends SpaceGrantInput {
  label: string;
}

/** Who can view / edit a space, on top of the global roles. */
export function SpacePermissionsDrawer({
  space,
  onClose,
}: {
  space: SpaceDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { can } = useAuth();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const perms = useSpacePermissions(space.id);
  const save = useSaveSpacePermissions(space.id);
  const users = useUsers({ pageSize: 100, status: 'ACTIVE' }, can(PERMISSIONS.USERS_READ));
  const departments = useDepartments();
  const [viewRestricted, setViewRestricted] = useState(false);
  const [editRestricted, setEditRestricted] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [form] = Form.useForm<{
    principalType: SpacePrincipalType;
    principalId: string;
    access: SpaceAccessLevel;
  }>();
  const principalType = Form.useWatch('principalType', form) ?? 'USER';

  useEffect(() => {
    if (!perms.data) return;
    setViewRestricted(perms.data.viewRestricted);
    setEditRestricted(perms.data.editRestricted);
    setRows(
      perms.data.grants.map((g) => ({
        principalType: g.principalType,
        principalId: g.principalId,
        access: g.access,
        label:
          g.principalType === 'ROLE'
            ? t(`admin:roles.${g.principalId}`)
            : ((loc(g.label) || g.label?.email) ?? g.principalId),
      })),
    );
  }, [perms.data, loc, t]);

  const principalOptions =
    principalType === 'USER'
      ? (users.data?.items ?? []).map((u) => ({ value: u.id, label: loc(u) || u.email }))
      : principalType === 'DEPARTMENT'
        ? (departments.data ?? []).map((d) => ({ value: d.id, label: loc(d) }))
        : SYSTEM_ROLE_KEYS.map((r) => ({ value: r, label: t(`admin:roles.${r}`) }));

  const add = async () => {
    const v = await form.validateFields();
    const label = principalOptions.find((o) => o.value === v.principalId)?.label ?? v.principalId;
    setRows((prev) => [
      ...prev.filter(
        (r) => !(r.principalType === v.principalType && r.principalId === v.principalId),
      ),
      { ...v, label },
    ]);
    form.setFieldValue('principalId', undefined);
  };

  const submit = async () => {
    try {
      await save.mutateAsync({
        viewRestricted,
        editRestricted,
        grants: rows.map(({ principalType: pt, principalId, access }) => ({
          principalType: pt,
          principalId,
          access,
        })),
      });
      message.success(t('saved'));
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      width={640}
      title={t('docs:permissions.title', { name: loc(space) })}
      onClose={onClose}
      extra={
        <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
          {t('save')}
        </Button>
      }
    >
      {perms.isLoading ? (
        <LoadingState />
      ) : perms.isError ? (
        <ErrorState error={perms.error} onRetry={() => void perms.refetch()} />
      ) : (
        <Space direction="vertical" size={16} style={{ inlineSize: '100%' }}>
          <Alert type="info" showIcon message={t('docs:permissions.info')} />
          <Flex justify="space-between" align="center" gap={16}>
            <div>
              <Typography.Text strong>{t('docs:permissions.restrictView')}</Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t('docs:permissions.restrictViewHint')}
              </Typography.Text>
            </div>
            <Switch
              checked={viewRestricted}
              onChange={setViewRestricted}
              aria-label={t('docs:permissions.restrictView')}
            />
          </Flex>
          <Flex justify="space-between" align="center" gap={16}>
            <div>
              <Typography.Text strong>{t('docs:permissions.restrictEdit')}</Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t('docs:permissions.restrictEditHint')}
              </Typography.Text>
            </div>
            <Switch
              checked={editRestricted}
              onChange={setEditRestricted}
              aria-label={t('docs:permissions.restrictEdit')}
            />
          </Flex>
          <Form
            form={form}
            layout="inline"
            initialValues={{ principalType: 'USER', access: 'VIEW' }}
            className="ph-grant-form"
          >
            <Form.Item name="principalType">
              <Select
                style={{ inlineSize: 140 }}
                onChange={() => form.setFieldValue('principalId', undefined)}
                options={(['USER', 'ROLE', 'DEPARTMENT'] as const).map((p) => ({
                  value: p,
                  label: t(`docs:permissions.principal.${p}`),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="principalId"
              rules={[{ required: true, message: t('validation.required') }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                style={{ inlineSize: 220 }}
                options={principalOptions}
                placeholder={t('docs:permissions.choose')}
              />
            </Form.Item>
            <Form.Item name="access">
              <Select
                style={{ inlineSize: 120 }}
                options={(['VIEW', 'EDIT'] as const).map((a) => ({
                  value: a,
                  label: t(`docs:permissions.access.${a}`),
                }))}
              />
            </Form.Item>
            <Button icon={<PlusOutlined />} onClick={() => void add()}>
              {t('docs:permissions.add')}
            </Button>
          </Form>
          <Table
            size="small"
            rowKey={(r) => `${r.principalType}:${r.principalId}`}
            dataSource={rows}
            pagination={false}
            locale={{ emptyText: t('docs:permissions.noGrants') }}
            columns={[
              { title: t('docs:permissions.who'), dataIndex: 'label' },
              {
                title: t('fields.type'),
                key: 'type',
                render: (_, r) => <Tag>{t(`docs:permissions.principal.${r.principalType}`)}</Tag>,
              },
              {
                title: t('docs:permissions.accessLabel'),
                key: 'access',
                render: (_, r) => (
                  <Select
                    size="small"
                    value={r.access}
                    style={{ inlineSize: 110 }}
                    onChange={(access) =>
                      setRows((prev) => prev.map((x) => (x === r ? { ...x, access } : x)))
                    }
                    options={(['VIEW', 'EDIT'] as const).map((a) => ({
                      value: a,
                      label: t(`docs:permissions.access.${a}`),
                    }))}
                  />
                ),
              },
              {
                key: 'remove',
                width: 48,
                render: (_, r) => (
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t('delete')}
                    onClick={() => setRows((prev) => prev.filter((x) => x !== r))}
                  />
                ),
              },
            ]}
          />
        </Space>
      )}
    </Drawer>
  );
}
