import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PASSWORD_POLICY } from '@processhub/shared';

export function PasswordPolicyHint() {
  const { t } = useTranslation();
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {t('validation.passwordHint', { min: DEFAULT_PASSWORD_POLICY.minLength })}
    </Typography.Text>
  );
}
