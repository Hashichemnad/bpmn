import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Flex,
  Form,
  Input,
  Radio,
  Row,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ApiOutlined, GithubOutlined, GitlabOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { GitSettingsInput } from '@processhub/shared';
import { useGitSettings, useSaveGitSettings, useTestGitConnection } from '@/api/docs';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage } from '@/components/i18n-helpers';

type Values = Omit<GitSettingsInput, 'clearToken'>;

/** Settings → Integrations: one-way sync of BPMN models and wiki pages to GitHub / GitLab. */
export function GitIntegrationCard() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useGitSettings();
  const save = useSaveGitSettings();
  const test = useTestGitConnection();
  const [form] = Form.useForm<Values>();
  const provider = Form.useWatch('provider', form) ?? 'github';
  const enabled = Form.useWatch('enabled', form) ?? false;

  useEffect(() => {
    if (!settings.data) return;
    const { hasToken: _h, encryptionAvailable: _e, ...rest } = settings.data;
    form.setFieldsValue({ ...rest, token: '' });
  }, [settings.data, form]);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  const s = settings.data;

  const values = async (): Promise<GitSettingsInput> => {
    const v = await form.validateFields();
    return { ...v, token: v.token?.trim() || undefined };
  };

  const submit = async () => {
    try {
      await save.mutateAsync(await values());
      form.setFieldValue('token', '');
      message.success(t('saved'));
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(errorMessage(err));
    }
  };

  const runTest = async () => {
    try {
      const res = await test.mutateAsync(await values());
      if (res.ok) message.success(t('admin:git.testOk', { branch: res.defaultBranch ?? '—' }));
      else
        modal.error({
          title: t(`errors:${res.code ?? 'GIT_UNKNOWN'}`),
          content: res.message && <Typography.Text code>{res.message}</Typography.Text>,
        });
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(errorMessage(err));
    }
  };

  const removeToken = () =>
    modal.confirm({
      title: t('admin:git.removeTokenTitle'),
      content: t('admin:git.removeTokenText'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          const v = form.getFieldsValue();
          await save.mutateAsync({ ...v, enabled: false, token: undefined, clearToken: true });
          message.success(t('saved'));
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  return (
    <Card
      title={
        <Space>
          <ApiOutlined />
          {t('admin:settings.integrations')}
        </Space>
      }
      extra={
        <Space>
          <Tag color={s.enabled ? 'green' : 'default'}>
            {s.enabled ? t('admin:git.enabled') : t('admin:settings.disabled')}
          </Tag>
          <Link to="/settings/integrations/sync">
            <Button size="small" icon={<SyncOutlined />}>
              {t('admin:git.statusLink')}
            </Button>
          </Link>
        </Space>
      }
    >
      {!s.encryptionAvailable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('admin:git.noEncryptionKey')}
        />
      )}
      <Typography.Paragraph type="secondary">{t('admin:git.intro')}</Typography.Paragraph>
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="enabled" valuePropName="checked" label={t('admin:git.enable')}>
          <Switch />
        </Form.Item>
        <Form.Item name="provider" label={t('admin:git.provider')}>
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio.Button value="github">
              <GithubOutlined /> GitHub
            </Radio.Button>
            <Radio.Button value="gitlab">
              <GitlabOutlined /> GitLab
            </Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="baseUrl"
              label={t('admin:git.baseUrl')}
              extra={
                provider === 'gitlab' ? t('admin:git.baseUrlGitlab') : t('admin:git.baseUrlGithub')
              }
              rules={[
                {
                  pattern: /^$|^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i,
                  message: t('admin:git.invalidUrl'),
                },
              ]}
            >
              <Input
                dir="ltr"
                placeholder={
                  provider === 'gitlab' ? 'https://gitlab.example.com' : 'https://api.github.com'
                }
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="repository"
              label={t('admin:git.repository')}
              extra={
                provider === 'gitlab'
                  ? t('admin:git.repositoryGitlab')
                  : t('admin:git.repositoryGithub')
              }
              rules={[
                { required: enabled, message: t('validation.required') },
                { pattern: /^$|^[\w.-]+(\/[\w.-]+)+$/, message: t('admin:git.invalidRepository') },
              ]}
            >
              <Input
                dir="ltr"
                placeholder={provider === 'gitlab' ? 'group/project' : 'owner/repository'}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="branch"
              label={t('admin:git.branch')}
              rules={[{ required: enabled, message: t('validation.required') }]}
            >
              <Input dir="ltr" placeholder="main" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="folder"
              label={t('admin:git.folder')}
              extra={t('admin:git.folderHint')}
            >
              <Input dir="ltr" placeholder="processhub" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              name="token"
              label={t('admin:git.token')}
              extra={
                s.hasToken
                  ? t('admin:git.tokenStored')
                  : t(
                      provider === 'gitlab'
                        ? 'admin:git.tokenHintGitlab'
                        : 'admin:git.tokenHintGithub',
                    )
              }
            >
              <Input.Password
                dir="ltr"
                autoComplete="new-password"
                placeholder={s.hasToken ? '••••••••••••' : ''}
                disabled={!s.encryptionAvailable}
              />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text strong>{t('admin:git.what')}</Typography.Text>
        <Flex gap={16} style={{ margin: '8px 0 16px' }} wrap="wrap">
          <Form.Item name="syncProcesses" valuePropName="checked" noStyle>
            <Checkbox>{t('admin:git.syncProcesses')}</Checkbox>
          </Form.Item>
          <Form.Item name="syncPages" valuePropName="checked" noStyle>
            <Checkbox>{t('admin:git.syncPages')}</Checkbox>
          </Form.Item>
        </Flex>
        <Form.Item name="trigger" label={t('admin:git.when')}>
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="ON_VERSION">{t('admin:git.onVersion')}</Radio>
              <Radio value="MANUAL">{t('admin:git.manual')}</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('admin:git.oneWay')} />
        <Space wrap>
          <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
            {t('save')}
          </Button>
          <Button icon={<ApiOutlined />} onClick={() => void runTest()} loading={test.isPending}>
            {t('admin:git.test')}
          </Button>
          {s.hasToken && (
            <Button danger type="link" onClick={removeToken}>
              {t('admin:git.removeToken')}
            </Button>
          )}
        </Space>
      </Form>
    </Card>
  );
}
