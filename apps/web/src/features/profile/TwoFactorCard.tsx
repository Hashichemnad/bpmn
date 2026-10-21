import { useState } from 'react';
import { Alert, App, Button, Card, Flex, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { MfaConfirmInput, MfaSetupDto } from '@processhub/shared';
import {
  useMfaDisable,
  useMfaEnable,
  useMfaRecoveryCodes,
  useMfaSetup,
  useMfaStatus,
} from '@/api/auth';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate } from '@/components/i18n-helpers';
import { CodeInput, MfaEnrolment, RecoveryCodes } from '@/features/auth/MfaParts';
import { codeRules } from '@/features/auth/mfa-rules';

type Dialog =
  | { kind: 'password' }
  | { kind: 'enrol'; setup: MfaSetupDto }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'confirm'; action: 'disable' | 'regenerate' }
  | null;

/** Profile → Two-factor authentication (authenticator app) for accounts with a password. */
export function TwoFactorCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const status = useMfaStatus();
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const disable = useMfaDisable();
  const regenerate = useMfaRecoveryCodes();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form] = Form.useForm();

  if (status.isLoading) return <LoadingState />;
  if (status.isError || !status.data)
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  const close = () => {
    setDialog(null);
    form.resetFields();
  };

  const start = async (v: { password: string }) => {
    try {
      setDialog({ kind: 'enrol', setup: await setup.mutateAsync(v.password) });
      form.resetFields();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const confirmEnrol = async (code: string) => {
    try {
      const res = await enable.mutateAsync({ code });
      setDialog({ kind: 'codes', codes: res.recoveryCodes });
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const confirmAction = async (action: 'disable' | 'regenerate', v: MfaConfirmInput) => {
    try {
      if (action === 'disable') {
        await disable.mutateAsync(v);
        message.success(t('auth.mfa.disabled'));
        close();
      } else {
        const res = await regenerate.mutateAsync(v);
        form.resetFields();
        setDialog({ kind: 'codes', codes: res.recoveryCodes });
      }
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const passwordField = (
    <Form.Item
      name="password"
      label={t('profile.currentPassword')}
      rules={[{ required: true, message: t('validation.required') }]}
    >
      <Input.Password autoComplete="current-password" autoFocus />
    </Form.Item>
  );

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined />
          {t('auth.mfa.cardTitle')}
        </Space>
      }
      extra={
        s.available && (
          <Tag color={s.enabled ? 'green' : 'default'}>
            {s.enabled ? t('auth.mfa.on') : t('auth.mfa.off')}
          </Tag>
        )
      }
    >
      {!s.available ? (
        <Typography.Text type="secondary">{t('auth.mfa.notAvailable')}</Typography.Text>
      ) : s.enabled ? (
        <Flex vertical gap={12}>
          <Typography.Text>
            {t('auth.mfa.enabledSince', { date: formatDate(s.enabledAt) })}
          </Typography.Text>
          <Typography.Text type={s.recoveryCodesLeft <= 2 ? 'warning' : 'secondary'}>
            {t('auth.mfa.codesLeft', { count: s.recoveryCodesLeft })}
          </Typography.Text>
          {s.required && <Alert type="info" showIcon message={t('auth.mfa.requiredNote')} />}
          <Space wrap>
            <Button onClick={() => setDialog({ kind: 'confirm', action: 'regenerate' })}>
              {t('auth.mfa.newCodes')}
            </Button>
            {!s.required && (
              <Button danger onClick={() => setDialog({ kind: 'confirm', action: 'disable' })}>
                {t('auth.mfa.turnOff')}
              </Button>
            )}
          </Space>
        </Flex>
      ) : (
        <Flex vertical gap={12} align="start">
          <Typography.Text type="secondary">{t('auth.mfa.intro')}</Typography.Text>
          {s.required && <Alert type="warning" showIcon message={t('auth.mfa.requiredNote')} />}
          <Button type="primary" onClick={() => setDialog({ kind: 'password' })}>
            {t('auth.mfa.turnOn')}
          </Button>
        </Flex>
      )}

      <Modal
        open={dialog?.kind === 'password'}
        title={t('auth.mfa.turnOn')}
        onCancel={close}
        onOk={() => form.submit()}
        okText={t('auth.mfa.next')}
        cancelText={t('cancel')}
        confirmLoading={setup.isPending}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">{t('auth.mfa.passwordFirst')}</Typography.Paragraph>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={start}>
          {passwordField}
        </Form>
      </Modal>

      <Modal
        open={dialog?.kind === 'enrol'}
        title={t('auth.mfa.turnOn')}
        onCancel={close}
        footer={null}
        destroyOnHidden
      >
        {dialog?.kind === 'enrol' && (
          <MfaEnrolment setup={dialog.setup} onConfirm={confirmEnrol} loading={enable.isPending} />
        )}
      </Modal>

      <Modal
        open={dialog?.kind === 'codes'}
        title={t('auth.mfa.recoveryTitle')}
        onCancel={close}
        closable={false}
        maskClosable={false}
        footer={
          <Button type="primary" onClick={close}>
            {t('auth.mfa.savedCodes')}
          </Button>
        }
        width={560}
        destroyOnHidden
      >
        {dialog?.kind === 'codes' && <RecoveryCodes codes={dialog.codes} />}
      </Modal>

      <Modal
        open={dialog?.kind === 'confirm'}
        title={
          dialog?.kind === 'confirm' && dialog.action === 'disable'
            ? t('auth.mfa.turnOff')
            : t('auth.mfa.newCodes')
        }
        onCancel={close}
        onOk={() => form.submit()}
        okText={t('confirm')}
        okButtonProps={{ danger: dialog?.kind === 'confirm' && dialog.action === 'disable' }}
        cancelText={t('cancel')}
        confirmLoading={disable.isPending || regenerate.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(v: MfaConfirmInput) =>
            dialog?.kind === 'confirm' && void confirmAction(dialog.action, v)
          }
        >
          {passwordField}
          <Form.Item name="code" label={t('auth.mfa.enterCode')} rules={codeRules(t)}>
            <CodeInput />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
