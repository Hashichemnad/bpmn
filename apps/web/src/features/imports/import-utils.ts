import { useTranslation } from 'react-i18next';
import type { ImportIssue } from '@processhub/shared';

/** Translated text of an import issue (parameters interpolated). */
export function useIssueText() {
  const { t } = useTranslation();
  return (i: ImportIssue) => {
    const key = `imports:issue.${i.code}`;
    const text = t(key, { ...(i.params ?? {}) });
    if (text !== key) return text;
    const err = t(`errors:${i.code}`, { ...(i.params ?? {}) });
    return err !== `errors:${i.code}` ? err : i.code;
  };
}

export const formatBytes = (n: number) =>
  n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
