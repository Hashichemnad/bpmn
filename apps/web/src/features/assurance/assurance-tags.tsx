import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AssigneeDto, ControlTestStatus, TestConclusion } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';

const TEST_STATUS_COLOUR: Record<ControlTestStatus, string> = {
  PLANNED: 'default',
  IN_PROGRESS: 'blue',
  SUBMITTED: 'purple',
  RETURNED: 'orange',
  REVIEWED: 'green',
  CLOSED: 'default',
};
const CONCLUSION_COLOUR: Record<TestConclusion, string> = {
  EFFECTIVE: 'green',
  EFFECTIVE_WITH_EXCEPTIONS: 'gold',
  NOT_EFFECTIVE: 'red',
};

export function TestStatusTag({ status }: { status: ControlTestStatus }) {
  const { t } = useTranslation();
  return <Tag color={TEST_STATUS_COLOUR[status]}>{t(`assurance:tests.status.${status}`)}</Tag>;
}

export function ConclusionTag({ value }: { value: TestConclusion | null }) {
  const { t } = useTranslation();
  if (!value) return <>—</>;
  return <Tag color={CONCLUSION_COLOUR[value]}>{t(`assurance:tests.conclusion.${value}`)}</Tag>;
}

/** A named user, everyone with a role, or "Risk & Compliance" when nobody is assigned. */
export function AssigneeLabel({ value }: { value: AssigneeDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  if (value.user) return <>{loc(value.user) || value.user.email}</>;
  if (value.roleKey)
    return <>{t('assurance:anyone', { role: t(`admin:roles.${value.roleKey}`) })}</>;
  return <>{t('assurance:unassigned')}</>;
}
