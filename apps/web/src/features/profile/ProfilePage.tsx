import { App, Button, Card, Col, Descriptions, Form, Input, Radio, Row, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CurrentUser, Locale } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage } from '@/components/i18n-helpers';
import { PasswordPolicyHint } from '@/features/admin/PasswordPolicyHint';
import { passwordRules } from '@/features/admin/password';
import { NotificationPrefsCard } from '@/features/notifications/NotificationPrefsCard';

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { setLocale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  if (!user) return null;

  const saveProfile = async (values: { nameEn: string; nameAr: string; locale: Locale }) => {
    try {
      const updated = await api<CurrentUser>('/auth/me', { method: 'PATCH', body: values });
      setUser(updated);
      setLocale(updated.locale);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const changePassword = async (values: { currentPassword: string; newPassword: string }) => {
    try {
      await api('/auth/change-password', { method: 'POST', body: values });
      passwordForm.resetFields();
      message.success(t('profile.passwordChanged'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title={t('profile.title')} subtitle={user.email} />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card title={t('profile.details')}>
            <Form
              form={profileForm}
              layout="vertical"
              initialValues={{ nameEn: user.nameEn, nameAr: user.nameAr, locale: user.locale }}
              onFinish={saveProfile}
            >
              <BilingualFields />
              <Form.Item name="locale" label={t('profile.language')}>
                <Radio.Group
                  optionType="button"
                  options={[
                    { label: 'English', value: 'en' },
                    { label: 'العربية', value: 'ar' },
                  ]}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                {t('save')}
              </Button>
            </Form>
          </Card>
          <Card title={t('profile.access')} style={{ marginTop: 24 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('fields.email')}>
                <span dir="ltr">{user.email}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('fields.roles')}>
                {user.roles.map((r) => (
                  <Tag key={r}>{t(`admin:roles.${r}`)}</Tag>
                ))}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={t('profile.changePassword')}>
            <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
              <Form.Item
                name="currentPassword"
                label={t('profile.currentPassword')}
                rules={[{ required: true, message: t('validation.required') }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label={t('profile.newPassword')}
                rules={passwordRules(t)}
                extra={<PasswordPolicyHint />}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm"
                label={t('profile.confirmPassword')}
                dependencies={['newPassword']}
                rules={[
                  { required: true, message: t('validation.required') },
                  ({ getFieldValue }) => ({
                    validator: (_, v) =>
                      !v || v === getFieldValue('newPassword')
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('validation.passwordMismatch'))),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                {t('profile.updatePassword')}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24}>
          <NotificationPrefsCard />
        </Col>
      </Row>
    </>
  );
}
