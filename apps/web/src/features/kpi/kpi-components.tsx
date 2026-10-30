import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type { KpiRag } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { NO_RAG_HEX, RAG_HEX } from './kpi-helpers';

const TAG_COLORS: Record<KpiRag, string> = { GREEN: 'green', AMBER: 'orange', RED: 'red' };

/** Traffic light of a KPI value (colour + text, never colour alone). */
export function RagTag({ rag }: { rag: KpiRag | null | undefined }) {
  const { t } = useTranslation();
  if (!rag) return <Tag data-testid="rag-none">{t('kpi:rag.none')}</Tag>;
  return (
    <Tag color={TAG_COLORS[rag]} data-testid={`rag-${rag}`}>
      <span aria-hidden="true">●</span> {t(`kpi:rag.${rag}`)}
    </Tag>
  );
}

/** Small trend line of the last values; the last point is coloured by its status. */
export function Sparkline({
  points,
  width = 96,
  height = 26,
}: {
  points: { period: string; value: number; rag: KpiRag | null }[];
  width?: number;
  height?: number;
}) {
  const { dir } = useLocale();
  if (points.length < 2) return <span className="ph-muted">—</span>;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - 6) / (points.length - 1);
  // Time runs with the reading direction (right to left in Arabic).
  const x = (i: number) => (dir === 'rtl' ? width - 3 - i * step : 3 + i * step);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const last = points[points.length - 1];
  return (
    <Tooltip title={points.map((p) => `${p.period}: ${p.value}`).join(' · ')}>
      <svg width={width} height={height} role="img" aria-label={`${points.length} values`}>
        <polyline
          fill="none"
          stroke="#64748b"
          strokeWidth={1.5}
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
        />
        <circle
          cx={x(points.length - 1)}
          cy={y(last.value)}
          r={3}
          fill={last.rag ? RAG_HEX[last.rag] : NO_RAG_HEX}
        />
      </svg>
    </Tooltip>
  );
}
