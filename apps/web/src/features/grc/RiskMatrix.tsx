import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { ratingBand, type GrcSettings } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { textOn, useGrcConfig } from './grc-helpers';

/**
 * 5 × 5 risk matrix: likelihood upwards (5 at the top), impact along the reading direction
 * (right in English, left in Arabic). Cells take their band colour; counts are clickable.
 */
export function RiskMatrix({
  cells,
  title,
  onCell,
  selected,
  testId,
  settingsOverride,
}: {
  /** `cells[likelihood-1][impact-1]`; omitted = preview of the bands only. */
  cells?: number[][];
  title?: string;
  onCell?: (likelihood: number, impact: number) => void;
  selected?: { likelihood: number; impact: number } | null;
  testId?: string;
  /** Unsaved settings (preview in Settings → Risk & Compliance). */
  settingsOverride?: GrcSettings;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const saved = useGrcConfig();
  const config = settingsOverride ?? saved;
  const label = (l: { en: string; ar: string }) => (locale === 'ar' ? l.ar : l.en);
  const rows = [5, 4, 3, 2, 1];
  const cols = [1, 2, 3, 4, 5];
  return (
    <div className="ph-risk-matrix" data-testid={testId}>
      {title && (
        <Typography.Title level={5} style={{ marginBlockStart: 0 }}>
          {title}
        </Typography.Title>
      )}
      <div className="ph-risk-matrix-grid" role="table" aria-label={title}>
        <div className="ph-risk-matrix-row" aria-hidden>
          <div className="ph-risk-matrix-axis">{t('grc:matrix.likelihood')} ↓</div>
        </div>
        {rows.map((l) => (
          <div key={l} className="ph-risk-matrix-row" role="row">
            <div className="ph-risk-matrix-label" role="rowheader">
              <span>{l}</span> {label(config.likelihoodLabels[l - 1])}
            </div>
            {cols.map((i) => {
              const score = l * i;
              const band = ratingBand(score, config.bands);
              const count = cells?.[l - 1]?.[i - 1] ?? 0;
              const isSelected = selected?.likelihood === l && selected?.impact === i;
              const clickable = !!onCell && (!cells || count > 0);
              const style = {
                background: band?.colour ?? '#f0f0f0',
                color: textOn(band?.colour ?? '#f0f0f0'),
                opacity: cells && !count ? 0.45 : 1,
              };
              const text = t('grc:matrix.cellTitle', { likelihood: l, impact: i, score });
              return clickable ? (
                <button
                  key={i}
                  type="button"
                  role="cell"
                  className={`ph-risk-matrix-cell${isSelected ? ' is-selected' : ''}`}
                  style={style}
                  title={text}
                  aria-label={`${text}: ${t('grc:matrix.risks', { count })}`}
                  data-cell={`${l},${i}`}
                  onClick={() => onCell?.(l, i)}
                >
                  {cells ? count : score}
                </button>
              ) : (
                <div
                  key={i}
                  role="cell"
                  className="ph-risk-matrix-cell"
                  style={style}
                  title={text}
                  data-cell={`${l},${i}`}
                >
                  {cells ? count || '' : score}
                </div>
              );
            })}
          </div>
        ))}
        <div className="ph-risk-matrix-row ph-risk-matrix-footer">
          <div className="ph-risk-matrix-label" />
          {cols.map((i) => (
            <div key={i} className="ph-risk-matrix-label is-col">
              <span>{i}</span> {label(config.impactLabels[i - 1])}
            </div>
          ))}
        </div>
        <div className="ph-risk-matrix-axis ph-risk-matrix-axis-x" aria-hidden>
          {t('grc:matrix.impact')}
        </div>
      </div>
    </div>
  );
}
