import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Card, Flex, Form, Input, Result, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { InvitationInfoDto } from '@processhub/shared';
import { api } from '@/api/client';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { BrandMark } from '@/layout/BrandMark';
import { LanguageToggle } from '@/layout/AppLayout';
import { LoadingState } from '@/components/states';
import { PasswordPolicyHint } from '@/features/admin/PasswordPolicyHint';

/** Public page of a set-password invitation (users created by an import, M15). */
export function InvitationPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationInfoDto>(`/auth/invitations/${token}`),
    retry: false,
  });
  const submit = async (v: { password: string }) => {
    setSaving(true);
    setError(null);
    try {
      await api('/auth/invitations/accept', {
        method: 'POST',
        body: { token, password: v.password },
      });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Flex justify="center" align="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: 420, maxWidth: '100%' }}>
        <Flex justify="space-between" align="center" style={{ marginBlockEnd: 16 }}>
          <BrandMark />
          <LanguageToggle />
        </Flex>
        {info.isLoading ? (
          <LoadingState />
        ) : info.isError ? (
          <Result
            status="warning"
            title={t('invitation.invalid')}
            extra={<Link to="/login">{t('invitation.toLogin')}</Link>}
          />
        ) : done ? (
          <Result
            status="success"
            title={t('invitation.done')}
            extra={
              <Link to="/login">
                <Button type="primary">{t('invitation.toLogin')}</Button>
              </Link>
            }
          />
        ) : (
          <>
            <Typography.Title level={4}>
              {t('invitation.title', { name: loc(info.data) || info.data?.email })}
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              {t('invitation.text', { email: info.data?.email })}
            </Typography.Paragraph>
            {error && (
              <Alert type="error" showIcon message={error} style={{ marginBlockEnd: 12 }} />
            )}
            <Form layout="vertical" onFinish={(v) => void submit(v)}>
              <Form.Item
                name="password"
                label={t('invitation.password')}
                rules={[{ required: true }]}
                extra={<PasswordPolicyHint />}
              >
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm"
                label={t('invitation.confirm')}
                dependencies={['password']}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator: (_, v) =>
                      !v || v === getFieldValue('password')
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('invitation.mismatch'))),
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={saving}>
                {t('invitation.submit')}
              </Button>
            </Form>
          </>
        )}
      </Card>
    </Flex>
  );
}
