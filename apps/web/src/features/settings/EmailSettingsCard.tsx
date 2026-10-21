import { useEffect } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Switch,
  Typography,
} from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { EmailSettingsInput } from '@processhub/shared';
import { useEmailSettings, useSaveEmailSettings, useTestEmail } from '@/api/governance';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage } from '@/components/i18n-helpers';

/** SMTP server for notification emails. The password is write-only and stored encrypted. */
export function EmailSettingsCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const email = useEmailSettings();
  const save = useSaveEmailSettings();
  const test = useTestEmail();
  const [form] = Form.useForm<EmailSettingsInput & { testTo: string }>();

  useEffect(() => {
    if (!email.data) return;
    const { hasPassword: _p, encryptionAvailable: _e, ...rest } = email.data;
    form.setFieldsValue({ ...rest, password: '', testTo: user?.email ?? '' });
  }, [email.data, form, user?.email]);

  const submit = async () => {
    const { testTo: _t, ...values } = await form.validateFields();
    try {
      await save.mutateAsync({ ...values, password: values.password || undefined });
      form.setFieldValue('password', '');
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const sendTest = async () => {
    const to = form.getFieldValue('testTo') as string;
    try {
      const res = await test.mutateAsync(to);
      if (res.ok) message.success(t('admin:email.testSent', { to }));
      else message.error(t('admin:email.testFailed', { error: res.error }));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const s = email.data;
  return (
    <Card
      title={
        <Space>
          <MailOutlined />
          {t('admin:email.title')}
        </Space>
      }
      loading={email.isLoading}
    >
      <Typography.Paragraph type="secondary">{t('admin:email.intro')}</Typography.Paragraph>
      {s && !s.encryptionAvailable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('admin:git.noEncryptionKey')}
        />
      )}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="enabled" valuePropName="checked" label={t('admin:email.enable')}>
          <Switch />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={16}>
            <Form.Item name="host" label={t('admin:email.host')}>
              <Input dir="ltr" placeholder="smtp.example.com" />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="port" label={t('admin:email.port')}>
              <InputNumber min={1} max={65535} style={{ inlineSize: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="secure" valuePropName="checked" label={t('admin:email.secure')}>
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="username" label={t('admin:email.username')}>
              <Input dir="ltr" autoComplete="off" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="password"
              label={t('admin:email.password')}
              extra={s?.hasPassword ? t('admin:email.passwordStored') : undefined}
            >
              <Input.Password
                dir="ltr"
                autoComplete="new-password"
                disabled={!s?.encryptionAvailable}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="fromAddress"
              label={t('admin:email.fromAddress')}
              rules={[{ type: 'email' }]}
            >
              <Input dir="ltr" placeholder="processhub@example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="fromName" label={t('admin:email.fromName')}>
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Space wrap align="start">
          <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
            {t('save')}
          </Button>
          <Form.Item name="testTo" noStyle rules={[{ type: 'email' }]}>
            <Input dir="ltr" style={{ inlineSize: 240 }} placeholder={t('admin:email.testTo')} />
          </Form.Item>
          <Button onClick={() => void sendTest()} loading={test.isPending} disabled={!s?.enabled}>
            {t('admin:email.sendTest')}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
