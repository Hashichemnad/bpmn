import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { WorkflowDto } from '@processhub/shared';
import { useAssigneeLabel } from './use-assignee-label';
import { useLocalized } from '@/components/i18n-helpers';

/** The steps of a workflow, one line each. */
export function WorkflowSummary({ workflow }: { workflow: WorkflowDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useAssigneeLabel();
  return (
    <>
      <ol className="ph-step-list">
        {workflow.steps.map((s, i) => (
          <li key={i}>
            <Typography.Text strong>
              {loc(s) || t('governance:workflows.stepN', { number: i + 1 })}
            </Typography.Text>
            {' — '}
            <Typography.Text type="secondary">
              {s.assignees.length > 1 ? `${t(`governance:rule.${s.rule}`)}: ` : ''}
              {s.assignees.map(label).join(', ')}
            </Typography.Text>
          </li>
        ))}
      </ol>
      {workflow.autoPublish && (
        <Tag color="blue" style={{ marginBlockStart: 6 }}>
          {t('governance:workflows.autoPublish')}
        </Tag>
      )}
    </>
  );
}
