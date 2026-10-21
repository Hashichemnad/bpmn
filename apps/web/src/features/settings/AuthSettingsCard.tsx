import { useEffect } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_MFA_REQUIRED_ROLES,
  MAX_GROUP_MAPPINGS,
  SSO_PROVIDERS,
  SYSTEM_ROLE_KEYS,
  type AuthSettingsInput,
} from '@processhub/shared';
import { useAuthSettings, useTestAuthSettings, useUpdateAuthSettings } from '@/api/auth';
import { useUsers } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';

type Values = Omit<AuthSettingsInput, 'clearClientSecret'>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const isValidation = (err: unknown) => !!err && typeof err === 'object' && 'errorFields' in err;

/**
 * Settings → Authentication (Super Admin): single sign-on with Microsoft Entra ID or any OpenID
 * Connect provider, just-in-time users and group mappings, password sign-in and 2FA rules.
 */
export function AuthSettingsCard() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const loc = useLocalized();
  const settings = useAuthSettings();
  const save = useUpdateAuthSettings();
  const test = useTestAuthSettings();
  const departments = useDepartmentTreeData();
  const superAdmins = useUsers({ role: 'SUPER_ADMIN', status: 'ACTIVE', pageSize: 100 });
  const [form] = Form.useForm<Values>();
  const provider = Form.useWatch('provider', form);
  const ssoEnabled = Form.useWatch('ssoEnabled', form);
  const localLoginEnabled = Form.useWatch('localLoginEnabled', form);
  const mfaRequiredRoles = Form.useWatch('mfaRequiredRoles', form) as string[] | undefined;
  const adminsWithoutMfa =
    !!mfaRequiredRoles && DEFAULT_MFA_REQUIRED_ROLES.some((r) => !mfaRequiredRoles.includes(r));

  useEffect(() => {
    if (!settings.data) return;
    const {
      hasClientSecret: _h,
      encryptionAvailable: _e,
      redirectUri: _r,
      localLoginForced: _f,
      ...rest
    } = settings.data;
    form.setFieldsValue({ ...rest, clientSecret: '' });
  }, [settings.data, form]);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  const s = settings.data;

  const values = async (): Promise<AuthSettingsInput> => {
    await form.validateFields();
    // All values, also those of fields not shown (tenant ID vs issuer, break-glass account).
    const v = form.getFieldsValue(true) as Values;
    return {
      ...v,
      clientSecret: v.clientSecret?.trim() || undefined,
      allowedDomains: (v.allowedDomains ?? []).map((d) => d.trim().toLowerCase()),
      groupMappings: (v.groupMappings ?? []).map((m) => ({
        ...m,
        roles: m.roles ?? [],
        departmentId: m.departmentId ?? null,
      })),
      defaultDepartmentId: v.defaultDepartmentId ?? null,
      breakGlassUserId: v.breakGlassUserId ?? null,
    };
  };

  const submit = async () => {
    try {
      await save.mutateAsync(await values());
      form.setFieldValue('clientSecret', '');
      message.success(t('saved'));
    } catch (err) {
      if (!isValidation(err)) message.error(errorMessage(err));
    }
  };

  const runTest = async () => {
    try {
      const res = await test.mutateAsync(await values());
      if (res.ok) message.success(t('admin:auth.testOk', { issuer: res.issuer }));
      else
        modal.error({
          title: t(`errors:${res.errorCode ?? 'SSO_PROVIDER_ERROR'}`),
          content: res.message && <Typography.Text code>{res.message}</Typography.Text>,
        });
    } catch (err) {
      if (!isValidation(err)) message.error(errorMessage(err));
    }
  };

  const roleOptions = SYSTEM_ROLE_KEYS.map((r) => ({ value: r, label: t(`admin:roles.${r}`) }));

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined />
          {t('admin:auth.title')}
        </Space>
      }
      extra={
        <Tag color={s.ssoEnabled ? 'green' : 'default'}>
          {s.ssoEnabled ? t('admin:auth.ssoOn') : t('admin:settings.disabled')}
        </Tag>
      }
    >
      {!s.encryptionAvailable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('admin:auth.noEncryptionKey')}
        />
      )}
      {s.localLoginForced && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('admin:auth.localLoginForced')}
        />
      )}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Typography.Title level={5}>{t('admin:auth.sso')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('admin:auth.ssoIntro')}</Typography.Paragraph>
        <Form.Item name="ssoEnabled" valuePropName="checked" label={t('admin:auth.enableSso')}>
          <Switch />
        </Form.Item>
        <Form.Item name="provider" label={t('admin:auth.provider')}>
          <Radio.Group
            optionType="button"
            options={SSO_PROVIDERS.map((p) => ({
              value: p,
              label: t(`admin:auth.providers.${p}`),
            }))}
          />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            {provider === 'ENTRA' ? (
              <Form.Item
                name="tenantId"
                label={t('admin:auth.tenantId')}
                extra={t('admin:auth.tenantIdHint')}
                rules={[
                  { required: !!ssoEnabled, message: t('validation.required') },
                  { pattern: GUID, message: t('admin:auth.tenantIdInvalid') },
                ]}
              >
                <Input dir="ltr" placeholder="00000000-0000-0000-0000-000000000000" />
              </Form.Item>
            ) : (
              <Form.Item
                name="issuer"
                label={t('admin:auth.issuer')}
                extra={t('admin:auth.issuerHint')}
                rules={[
                  { required: !!ssoEnabled, message: t('validation.required') },
                  { type: 'url', message: t('admin:auth.issuerInvalid') },
                ]}
              >
                <Input dir="ltr" placeholder="https://login.example.com/realms/company" />
              </Form.Item>
            )}
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="clientId"
              label={t('admin:auth.clientId')}
              rules={[{ required: !!ssoEnabled, message: t('validation.required') }]}
            >
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="clientSecret"
          label={t('admin:auth.clientSecret')}
          extra={
            s.hasClientSecret ? t('admin:auth.secretStored') : t('admin:auth.clientSecretHint')
          }
        >
          <Input.Password
            dir="ltr"
            autoComplete="new-password"
            placeholder={s.hasClientSecret ? '••••••••••••' : ''}
            style={{ maxInlineSize: 420 }}
            disabled={!s.encryptionAvailable}
          />
        </Form.Item>
        <Form.Item label={t('admin:auth.redirectUri')} extra={t('admin:auth.redirectUriHint')}>
          <Typography.Text code copyable dir="ltr">
            {s.redirectUri}
          </Typography.Text>
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="buttonLabelEn"
              label={t('admin:auth.buttonLabelEn')}
              extra={t('admin:auth.buttonLabelHint')}
            >
              <Input dir="ltr" lang="en" maxLength={100} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="buttonLabelAr" label={t('admin:auth.buttonLabelAr')}>
              <Input dir="rtl" lang="ar" maxLength={100} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="allowedDomains"
          label={t('admin:auth.allowedDomains')}
          extra={t('admin:auth.allowedDomainsHint')}
          rules={[
            {
              validator: (_, v: string[] | undefined) =>
                (v ?? []).every((d) => DOMAIN.test(d.trim()))
                  ? (v ?? []).length || !ssoEnabled
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('admin:auth.domainRequired')))
                  : Promise.reject(new Error(t('admin:auth.domainInvalid'))),
            },
          ]}
        >
          <Select mode="tags" tokenSeparators={[',', ' ']} open={false} />
        </Form.Item>

        <Divider />
        <Typography.Title level={5}>{t('admin:auth.users')}</Typography.Title>
        <Form.Item
          name="autoCreateUsers"
          valuePropName="checked"
          label={t('admin:auth.autoCreate')}
          extra={t('admin:auth.autoCreateHint')}
        >
          <Switch />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="defaultRole" label={t('admin:auth.defaultRole')}>
              <Select options={roleOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="defaultDepartmentId" label={t('admin:auth.defaultDepartment')}>
              <TreeSelect treeData={departments} allowClear treeDefaultExpandAll />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="groupsClaim"
          label={t('admin:auth.groupsClaim')}
          extra={t('admin:auth.groupsClaimHint')}
          rules={[{ required: true, pattern: /^[A-Za-z0-9_.:/-]+$/ }]}
        >
          <Input dir="ltr" style={{ maxInlineSize: 240 }} />
        </Form.Item>
        <Typography.Text strong>{t('admin:auth.groupMappings')}</Typography.Text>
        <Typography.Paragraph type="secondary">
          {t('admin:auth.groupMappingsHint')}
        </Typography.Paragraph>
        <Form.List name="groupMappings">
          {(fields, { add, remove }) => (
            <Flex vertical gap={8} style={{ marginBottom: 16 }}>
              {fields.map((f) => (
                <Row key={f.key} gutter={8} align="top">
                  <Col xs={24} md={8}>
                    <Form.Item
                      name={[f.name, 'group']}
                      rules={[{ required: true, whitespace: true, max: 256 }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input dir="ltr" placeholder={t('admin:auth.group')} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name={[f.name, 'roles']} style={{ marginBottom: 8 }}>
                      <Select
                        mode="multiple"
                        options={roleOptions}
                        placeholder={t('fields.roles')}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={20} md={7}>
                    <Form.Item name={[f.name, 'departmentId']} style={{ marginBottom: 8 }}>
                      <TreeSelect
                        treeData={departments}
                        allowClear
                        placeholder={t('fields.department')}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={4} md={1}>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t('delete')}
                      onClick={() => remove(f.name)}
                    />
                  </Col>
                </Row>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={() => add({ group: '', roles: [], departmentId: null })}
                disabled={fields.length >= MAX_GROUP_MAPPINGS}
                style={{ alignSelf: 'flex-start' }}
              >
                {t('admin:auth.addMapping')}
              </Button>
            </Flex>
          )}
        </Form.List>
        <Form.Item
          name="syncRolesOnLogin"
          valuePropName="checked"
          label={t('admin:auth.syncRoles')}
          extra={t('admin:auth.syncRolesHint')}
        >
          <Switch />
        </Form.Item>

        <Divider />
        <Typography.Title level={5}>{t('admin:auth.passwordSignIn')}</Typography.Title>
        <Form.Item
          name="localLoginEnabled"
          valuePropName="checked"
          label={t('admin:auth.localLogin')}
          extra={t('admin:auth.localLoginHint')}
        >
          <Switch />
        </Form.Item>
        {localLoginEnabled === false && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('admin:auth.breakGlassWarning')}
            />
            <Form.Item
              name="breakGlassUserId"
              label={t('admin:auth.breakGlass')}
              extra={t('admin:auth.breakGlassHint')}
              rules={[{ required: true, message: t('validation.required') }]}
            >
              <Select
                loading={superAdmins.isLoading}
                options={(superAdmins.data?.items ?? []).map((u) => ({
                  value: u.id,
                  label: `${loc(u) || u.email} (${u.email})`,
                }))}
                style={{ maxInlineSize: 480 }}
              />
            </Form.Item>
          </>
        )}

        <Divider />
        <Typography.Title level={5}>{t('admin:auth.mfa')}</Typography.Title>
        <Form.Item
          name="mfaRequiredRoles"
          label={t('admin:auth.mfaRoles')}
          extra={t('admin:auth.mfaRolesHint')}
        >
          <Select mode="multiple" options={roleOptions} allowClear />
        </Form.Item>
        {adminsWithoutMfa && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('admin:auth.mfaAdminsWarning')}
          />
        )}

        <Space wrap>
          <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
            {t('save')}
          </Button>
          <Button onClick={() => void runTest()} loading={test.isPending}>
            {t('admin:auth.test')}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
