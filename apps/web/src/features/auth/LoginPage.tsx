import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { LoginInput } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { usePublicSettings } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { BrandMark } from '@/layout/BrandMark';
import { LanguageToggle } from '@/layout/AppLayout';

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const settings = usePublicSettings();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (user) return <Navigate to={from} replace />;

  const onFinish = async (values: LoginInput) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
        const until = (err.details as { lockedUntil?: string } | undefined)?.lockedUntil;
        setError(t('auth.lockedUntil', { time: formatDate(until) }));
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const orgName = loc({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr }) || 'ProcessHub';

  return (
    <div className="ph-login">
      <div className="ph-login-lang">
        <LanguageToggle />
      </div>
      <Card className="ph-login-card" variant="borderless">
        <Flex vertical align="center" gap={8} style={{ marginBottom: 24 }}>
          <BrandMark settings={settings.data} size={48} />
          <Typography.Title level={3} style={{ margin: '8px 0 0' }}>
            {orgName}
          </Typography.Title>
          <Typography.Text type="secondary">{t('auth.subtitle')}</Typography.Text>
        </Flex>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} role="alert" />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false} autoComplete="on">
          <Form.Item
            name="email"
            label={t('auth.email')}
            rules={[
              { required: true, message: t('validation.required') },
              { type: 'email', message: t('validation.email') },
            ]}
          >
            <Input prefix={<MailOutlined />} dir="ltr" autoComplete="username" autoFocus size="large" />
          </Form.Item>
          <Form.Item name="password" label={t('auth.password')} rules={[{ required: true, message: t('validation.required') }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            {t('auth.signIn')}
          </Button>
        </Form>
      </Card>
      <Typography.Text type="secondary" className="ph-login-footer">
        {t('appTagline')}
      </Typography.Text>
    </div>
  );
}
