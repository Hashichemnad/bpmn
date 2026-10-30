import { useState } from 'react';
import { Button } from 'antd';
import { IssuesCloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { IssueFormModal, type IssuePrefill } from './IssueFormModal';

/** "Raise issue" from a test, a risk, feedback or a finding (issue managers only). */
export function RaiseIssueButton({
  prefill,
  size,
}: {
  prefill: IssuePrefill;
  size?: 'small' | 'middle';
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can(PERMISSIONS.ISSUES_MANAGE)) return null;
  return (
    <>
      <Button
        size={size}
        icon={<IssuesCloseOutlined />}
        data-testid="raise-issue"
        onClick={() => setOpen(true)}
      >
        {t('assurance:issues.raise')}
      </Button>
      {open && <IssueFormModal prefill={prefill} onClose={() => setOpen(false)} />}
    </>
  );
}
