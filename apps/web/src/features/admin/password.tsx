import { Typography } from 'antd';
import type { TFunction } from 'i18next';
import type { Rule } from 'antd/es/form';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PASSWORD_POLICY, checkPasswordPolicy } from '@processhub/shared';

/**
 * Client-side hint using the default policy. The server enforces the configured
 * policy and returns WEAK_PASSWORD with details if it differs.
 */
export function passwordRules(t: TFunction): Rule[] {
  return [
    { required: true, message: t('validation.required') },
    {
      validator: (_, v: string | undefined) => {
        if (!v) return Promise.resolve();
        const errors = checkPasswordPolicy(v, DEFAULT_PASSWORD_POLICY);
        return errors.length
          ? Promise.reject(new Error(errors.map((e) => t(`validation.password.${e}`, { min: DEFAULT_PASSWORD_POLICY.minLength })).join(' · ')))
          : Promise.resolve();
      },
    },
  ];
}

export function PasswordPolicyHint() {
  const { t } = useTranslation();
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {t('validation.passwordHint', { min: DEFAULT_PASSWORD_POLICY.minLength })}
    </Typography.Text>
  );
}
