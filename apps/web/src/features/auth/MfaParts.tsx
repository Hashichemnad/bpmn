import { useState } from 'react';
import { Alert, Button, Flex, Form, Input, QRCode, Space, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { MfaSetupDto } from '@processhub/shared';
import { codeRules } from './mfa-rules';

/** Six-digit authenticator code. Digits always run left to right, also in Arabic. */
export function CodeInput(props: { value?: string; onChange?: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div dir="ltr" style={{ display: 'flex', justifyContent: 'center' }}>
      <Input.OTP
        length={6}
        size="large"
        formatter={(v) => v.replace(/\D/g, '')}
        aria-label={t('auth.mfa.code')}
        autoFocus
        {...props}
      />
    </div>
  );
}

/** Step 2 of enrolment: scan the QR code (or type the key), then confirm with a code. */
export function MfaEnrolment({
  setup,
  onConfirm,
  loading,
}: {
  setup: MfaSetupDto;
  onConfirm: (code: string) => Promise<void> | void;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <Flex vertical gap={16}>
      <Typography.Paragraph style={{ margin: 0 }}>{t('auth.mfa.scanHint')}</Typography.Paragraph>
      <Flex justify="center">
        <QRCode value={setup.otpauthUrl} size={180} bordered={false} errorLevel="M" />
      </Flex>
      <Typography.Text type="secondary">{t('auth.mfa.manualKey')}</Typography.Text>
      <Typography.Text code copyable={{ text: setup.secret }} dir="ltr" style={{ fontSize: 15 }}>
        {grouped}
      </Typography.Text>
      <Form
        layout="vertical"
        requiredMark={false}
        onFinish={(v: { code: string }) => onConfirm(v.code)}
      >
        <Form.Item name="code" label={t('auth.mfa.enterCode')} rules={codeRules(t)}>
          <CodeInput />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {t('auth.mfa.confirm')}
        </Button>
      </Form>
    </Flex>
  );
}

/** Recovery codes, shown once: copy, download, and a clear warning. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'processhub-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard not available: the codes can still be selected */
    }
  };
  return (
    <Flex vertical gap={12}>
      <Alert type="warning" showIcon message={t('auth.mfa.recoveryWarning')} />
      <div
        dir="ltr"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 8,
          fontFamily: 'monospace',
          fontSize: 15,
        }}
        data-testid="recovery-codes"
      >
        {codes.map((c) => (
          <Typography.Text key={c} code>
            {c}
          </Typography.Text>
        ))}
      </div>
      <Space wrap>
        <Button icon={<CopyOutlined />} onClick={() => void copy()}>
          {copied ? t('auth.mfa.copied') : t('auth.mfa.copyCodes')}
        </Button>
        <Button icon={<DownloadOutlined />} onClick={download}>
          {t('auth.mfa.downloadCodes')}
        </Button>
      </Space>
    </Flex>
  );
}
