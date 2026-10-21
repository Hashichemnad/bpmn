import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { diffBlocks, diffStats, htmlToBlocks } from './text-diff';

/** Block/word diff of two HTML versions, memoised. */
export function useDiff(oldHtml: string, newHtml: string) {
  const { t } = useTranslation();
  return useMemo(() => {
    const labels = { diagram: t('docs:diff.diagram'), image: t('docs:diff.image') };
    const rows = diffBlocks(htmlToBlocks(oldHtml, labels), htmlToBlocks(newHtml, labels));
    return { rows, stats: diffStats(rows) };
  }, [oldHtml, newHtml, t]);
}
