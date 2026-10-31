import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ExecIssue } from '@processhub/shared';

/** Executable check (Phase 5.2) in the Validation panel: errors block deployment. */
export function ExecIssueList({
  issues,
  labelOf,
  onFocus,
}: {
  issues: ExecIssue[];
  labelOf?: (id: string) => string;
  onFocus?: (id?: string) => void;
}) {
  const { t } = useTranslation();
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section aria-label={t('workflow:check.title')} data-testid="exec-issues">
      <Typography.Title level={5} style={{ marginBlock: '12px 4px' }}>
        {t('workflow:check.title')}
      </Typography.Title>
      {errors > 0 && (
        <Typography.Paragraph type="danger" style={{ marginBlockEnd: 8 }}>
          {t('workflow:check.blocking', { count: errors })}
        </Typography.Paragraph>
      )}
      <ul className="ph-issues">
        {issues.map((i, idx) => (
          <li key={`${i.code}-${i.elementId ?? idx}`}>
            <button
              type="button"
              className="ph-issue"
              onClick={() => onFocus?.(i.elementId ?? undefined)}
              disabled={!i.elementId || !onFocus}
            >
              <Tag color={i.severity === 'error' ? 'red' : 'orange'}>
                {t(`workflow:check.severity.${i.severity}`)}
              </Tag>
              <span>
                {t(`workflow:check.codes.${i.code}`, {
                  detail: i.detail
                    ? t(`workflow:check.hints.${i.detail}`, { defaultValue: i.detail })
                    : '',
                })}
              </span>
              {i.elementId && (
                <Typography.Text type="secondary" className="ph-issue-id">
                  {labelOf?.(i.elementId) || <span dir="ltr">{i.elementId}</span>}
                </Typography.Text>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
