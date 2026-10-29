import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ConventionIssue } from '@processhub/shared';

/** The convention findings in the Validation panel; required ones block a submission. */
export function ConventionIssueList({
  issues,
  labelOf,
  onFocus,
}: {
  issues: ConventionIssue[];
  /** Label of an element in the active language ('' when it has none). */
  labelOf: (id: string) => string;
  onFocus: (id?: string) => void;
}) {
  const { t } = useTranslation();
  if (!issues.length) return null;
  const blocking = issues.filter((i) => i.mandatory).length;
  return (
    <section className="ph-convention-issues" aria-label={t('modeler:conventions.title')}>
      <Typography.Title level={5} style={{ marginBlock: '12px 4px' }}>
        {t('modeler:conventions.title')}
      </Typography.Title>
      {blocking > 0 && (
        <Typography.Paragraph type="danger" style={{ marginBlockEnd: 8 }}>
          {t('modeler:conventions.blocking', { count: blocking })}
        </Typography.Paragraph>
      )}
      <ul className="ph-issues">
        {issues.map((i, idx) => (
          <li key={`${i.rule}-${i.elementId ?? idx}`}>
            <button
              type="button"
              className="ph-issue"
              onClick={() => onFocus(i.elementId)}
              disabled={!i.elementId}
            >
              <Tag color={i.mandatory ? 'red' : 'orange'}>
                {t(i.mandatory ? 'modeler:conventions.required' : 'modeler:conventions.warning')}
              </Tag>
              <span>
                {t(`modeler:conventions.rules.${i.rule}`, { count: i.count, max: i.max })}
              </span>
              {i.elementId && (
                <Typography.Text type="secondary" className="ph-issue-id">
                  {labelOf(i.elementId) || <span dir="ltr">{i.elementId}</span>}
                </Typography.Text>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
