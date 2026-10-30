import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  AssigneeDto,
  ControlTestStatus,
  EngagementStatus,
  IssueStatus,
  ResponseStatus,
  TestConclusion,
} from '@processhub/shared';
import { useAssuranceSettings } from '@/api/assurance';
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

const ISSUE_STATUS_COLOUR: Record<IssueStatus, string> = {
  OPEN: 'blue',
  IN_PROGRESS: 'processing',
  READY_FOR_VERIFICATION: 'purple',
  CLOSED: 'green',
  ACCEPTED_RISK: 'gold',
};

export function IssueStatusTag({ status }: { status: IssueStatus }) {
  const { t } = useTranslation();
  return <Tag color={ISSUE_STATUS_COLOUR[status]}>{t(`assurance:issues.status.${status}`)}</Tag>;
}

/** Severity / finding rating from the configurable scale (Settings → Risk & Compliance). */
export function SeverityTag({ value }: { value: string }) {
  const settings = useAssuranceSettings();
  const loc = useLocalized();
  const s = settings.data?.severities.find((x) => x.key === value);
  return (
    <Tag color={s?.colour} style={{ color: s ? '#fff' : undefined }}>
      {s ? loc(s) : value}
    </Tag>
  );
}

const ENGAGEMENT_COLOUR: Record<EngagementStatus, string> = {
  PLANNED: 'default',
  FIELDWORK: 'blue',
  REPORTING: 'purple',
  FOLLOW_UP: 'orange',
  CLOSED: 'green',
};

export function EngagementStatusTag({ status }: { status: EngagementStatus }) {
  const { t } = useTranslation();
  return <Tag color={ENGAGEMENT_COLOUR[status]}>{t(`assurance:audits.status.${status}`)}</Tag>;
}

export function ResponseTag({ value }: { value: ResponseStatus }) {
  const { t } = useTranslation();
  const colour = { PENDING: 'default', ACCEPTED: 'green', DISAGREED: 'red' }[value];
  return <Tag color={colour}>{t(`assurance:audits.response.${value}`)}</Tag>;
}
