import type { ReactNode } from 'react';
import { Result } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';

/** Hides UI the user cannot use. The server enforces permissions regardless. */
export function Can({
  all,
  any,
  children,
}: {
  all?: Permission[];
  any?: Permission[];
  children: ReactNode;
}) {
  const { can, canAny } = useAuth();
  if (all && !can(...all)) return null;
  if (any && !canAny(...any)) return null;
  return <>{children}</>;
}

export function RequirePermission({
  all,
  any,
  children,
}: {
  all?: Permission[];
  any?: Permission[];
  children: ReactNode;
}) {
  const { can, canAny } = useAuth();
  const { t } = useTranslation();
  if ((all && !can(...all)) || (any && !canAny(...any))) {
    return <Result status="403" title={t('forbiddenTitle')} subTitle={t('forbiddenText')} />;
  }
  return <>{children}</>;
}
