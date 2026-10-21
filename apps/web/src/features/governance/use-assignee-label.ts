import { useTranslation } from 'react-i18next';
import type { WorkflowAssigneeDto } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';

/** "Process owner", "Reviewer (Finance)", "Sara Ali" … */
export function useAssigneeLabel() {
  const { t } = useTranslation();
  const loc = useLocalized();
  return (a: WorkflowAssigneeDto) => {
    if (a.type === 'OWNER') return t('governance:assignee.OWNER');
    if (a.type === 'USER') return loc(a.label) || a.label?.email || t('governance:unknownUser');
    const role = t(`admin:roles.${a.roleKey}`);
    return a.label ? `${role} (${loc(a.label)})` : role;
  };
}
