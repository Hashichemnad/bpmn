import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Divider, Flex, Form, Input, Typography } from 'antd';
import { LockOutlined, LoginOutlined, MailOutlined, SafetyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  SSO_START_PATH,
  type CurrentUser,
  type LoginInput,
  type LoginResponseDto,
  type MfaSetupDto,
} from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { usePublicSettings } from '@/api/hooks';
import { useAuthOptions } from '@/api/auth';
import { ApiError, api } from '@/api/client';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { BrandMark } from '@/layout/BrandMark';
import { LanguageToggle } from '@/layout/AppLayout';
import { CodeInput, MfaEnrolment, RecoveryCodes } from './MfaParts';
import { codeRules } from './mfa-rules';

type Step =
  | { kind: 'password' }
  | { kind: 'verify' }
  | { kind: 'setup'; setup: MfaSetupDto | null }
  | { kind: 'codes'; codes: string[]; user: CurrentUser };

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, completeLogin } = useAuth();
  const settings = usePublicSettings();
  const options = useAuthOptions();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const ssoError = params.get('ssoError');
  const [error, setError] = useState<string | null>(null);
  // Translated at render time, so it follows the language toggle.
  const [showSsoError, setShowSsoError] = useState(!!ssoError);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [useRecovery, setUseRecovery] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  // While recovery codes are shown the user is already signed in; leave only on "Continue".
  if (user && step.kind !== 'codes') return <Navigate to={from} replace />;

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
      const until = (err.details as { lockedUntil?: string } | undefined)?.lockedUntil;
      setError(t('auth.lockedUntil', { time: formatDate(until) }));
    } else if (err instanceof ApiError && err.code === 'MFA_CHALLENGE_EXPIRED') {
      setStep({ kind: 'password' });
      setError(errorMessage(err));
    } else {
      setError(errorMessage(err));
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setShowSsoError(false);
    setSubmitting(true);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const signedIn = (u: CurrentUser) => {
    completeLogin(u);
    navigate(from, { replace: true });
  };

  const onPassword = (values: LoginInput) =>
    run(async () => {
      const res = await login(values);
      if ('user' in res) navigate(from, { replace: true });
      else if (res.mfa === 'VERIFY') setStep({ kind: 'verify' });
      else {
        setStep({ kind: 'setup', setup: null });
        const setup = await api<MfaSetupDto>('/auth/login/mfa/setup', { method: 'POST' });
        setStep({ kind: 'setup', setup });
      }
    });

  const onVerify = (values: { code?: string; recoveryCode?: string }) =>
    run(async () => {
      const body = useRecovery ? { recoveryCode: values.recoveryCode } : { code: values.code };
      const res = await api<LoginResponseDto>('/auth/login/mfa', { method: 'POST', body });
      if ('user' in res) signedIn(res.user);
    });

  const onSetupConfirm = (code: string) =>
    run(async () => {
      const res = await api<{ user: CurrentUser; recoveryCodes: string[] }>(
        '/auth/login/mfa/setup/confirm',
        { method: 'POST', body: { code } },
      );
      setStep({ kind: 'codes', codes: res.recoveryCodes, user: res.user });
    });

  const orgName =
    loc({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr }) || 'ProcessHub';
  const o = options.data;
  const ssoLabel =
    loc({ nameEn: o?.ssoButtonLabelEn, nameAr: o?.ssoButtonLabelAr }) || t('auth.sso.button');
  const passwordOffered = !o || o.localLoginEnabled || showPassword;
  const ssoHref = `${SSO_START_PATH}?returnTo=${encodeURIComponent(from)}`;

  const backToPassword = (
    <Button
      type="link"
      block
      onClick={() => {
        setStep({ kind: 'password' });
        setError(null);
      }}
    >
      {t('auth.mfa.backToSignIn')}
    </Button>
  );

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
          <Typography.Text type="secondary">
            {step.kind === 'password' ? t('auth.subtitle') : t(`auth.mfa.title.${step.kind}`)}
          </Typography.Text>
        </Flex>
        {(error || (showSsoError && ssoError)) && (
          <Alert
            type="error"
            showIcon
            message={
              error ?? t(`errors:${ssoError}`, { defaultValue: t('errors:SSO_PROVIDER_ERROR') })
            }
            style={{ marginBottom: 16 }}
            role="alert"
          />
        )}

        {step.kind === 'password' && (
          <>
            {o?.ssoEnabled && (
              <Button
                type={o.localLoginEnabled ? 'default' : 'primary'}
                href={ssoHref}
                block
                size="large"
                icon={<LoginOutlined />}
              >
                {ssoLabel}
              </Button>
            )}
            {o?.ssoEnabled && passwordOffered && (
              <Divider plain>
                <Typography.Text type="secondary">{t('auth.sso.or')}</Typography.Text>
              </Divider>
            )}
            {passwordOffered ? (
              <Form layout="vertical" onFinish={onPassword} requiredMark={false} autoComplete="on">
                <Form.Item
                  name="email"
                  label={t('auth.email')}
                  rules={[
                    { required: true, message: t('validation.required') },
                    { type: 'email', message: t('validation.email') },
                  ]}
                >
                  <Input
                    prefix={<MailOutlined />}
                    dir="ltr"
                    autoComplete="username"
                    autoFocus={!o?.ssoEnabled}
                    size="large"
                  />
                </Form.Item>
                <Form.Item
                  name="password"
                  label={t('auth.password')}
                  rules={[{ required: true, message: t('validation.required') }]}
                >
                  <Input.Password
                    prefix={<LockOutlined />}
                    autoComplete="current-password"
                    size="large"
                  />
                </Form.Item>
                <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                  {t('auth.signIn')}
                </Button>
              </Form>
            ) : (
              <Button
                type="link"
                block
                style={{ marginTop: 16 }}
                onClick={() => setShowPassword(true)}
              >
                {t('auth.sso.adminSignIn')}
              </Button>
            )}
          </>
        )}

        {step.kind === 'verify' && (
          <Form layout="vertical" onFinish={onVerify} requiredMark={false}>
            {useRecovery ? (
              <Form.Item
                name="recoveryCode"
                label={t('auth.mfa.recoveryCode')}
                rules={[{ required: true, message: t('validation.required') }]}
              >
                <Input dir="ltr" autoComplete="one-time-code" autoFocus size="large" />
              </Form.Item>
            ) : (
              <Form.Item
                name="code"
                label={t('auth.mfa.enterCode')}
                extra={t('auth.mfa.verifyHint')}
                rules={codeRules(t)}
              >
                <CodeInput />
              </Form.Item>
            )}
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={submitting}
              icon={<SafetyOutlined />}
            >
              {t('auth.mfa.verify')}
            </Button>
            <Button type="link" block onClick={() => setUseRecovery((v) => !v)}>
              {useRecovery ? t('auth.mfa.useApp') : t('auth.mfa.useRecovery')}
            </Button>
            {backToPassword}
          </Form>
        )}

        {step.kind === 'setup' && (
          <>
            <Alert
              type="info"
              showIcon
              message={t('auth.mfa.requiredByRole')}
              style={{ marginBottom: 16 }}
            />
            {step.setup ? (
              <MfaEnrolment setup={step.setup} onConfirm={onSetupConfirm} loading={submitting} />
            ) : null}
            {backToPassword}
          </>
        )}

        {step.kind === 'codes' && (
          <Flex vertical gap={16}>
            <Alert type="success" showIcon message={t('auth.mfa.enabled')} />
            <RecoveryCodes codes={step.codes} />
            <Button type="primary" size="large" block onClick={() => signedIn(step.user)}>
              {t('auth.mfa.continue')}
            </Button>
          </Flex>
        )}
      </Card>
      <Typography.Text type="secondary" className="ph-login-footer">
        {t('appTagline')}
      </Typography.Text>
    </div>
  );
}
