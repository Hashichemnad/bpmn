import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { thresholdsFor, type KpiDto, type KpiMeasurementDto } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { EmptyState } from '@/components/states';
import { NO_RAG_HEX, RAG_HEX, useFormatPeriod, useFormatValue } from './kpi-helpers';

/**
 * Actual values against the target (per period) with the green / red thresholds (Recharts,
 * D-113). Time runs right to left in Arabic; numbers and periods via Intl.
 */
export function KpiChart({
  kpi,
  measurements,
  height = 300,
}: {
  kpi: KpiDto;
  measurements: KpiMeasurementDto[];
  height?: number;
}) {
  const { t } = useTranslation();
  const { dir } = useLocale();
  const rtl = dir === 'rtl';
  const formatValue = useFormatValue();
  const formatPeriod = useFormatPeriod();
  if (!measurements.length) return <EmptyState description={t('kpi:detail.noValues')} />;
  const data = measurements.map((m) => {
    const th = thresholdsFor(kpi, m.period, kpi.periodTargets);
    return {
      period: formatPeriod(m.period),
      actual: m.value,
      target: th.target,
      rag: m.rag,
    };
  });
  const green = kpi.greenThreshold ?? null;
  const red = kpi.redThreshold;
  return (
    <div data-testid="kpi-chart" style={{ width: '100%', height, direction: 'ltr' }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="period" reversed={rtl} tick={{ fontSize: 12 }} />
          <YAxis
            orientation={rtl ? 'right' : 'left'}
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => formatValue(v)}
            width={56}
            domain={['auto', 'auto']}
          />
          <Tooltip formatter={(v: number) => formatValue(v, kpi.unit)} />
          <Legend />
          {red !== null && (
            <ReferenceLine
              y={red}
              stroke={RAG_HEX.RED}
              strokeDasharray="4 4"
              label={{
                value: t('kpi:fields.redThreshold'),
                fontSize: 11,
                fill: RAG_HEX.RED,
                position: 'insideTopLeft',
              }}
            />
          )}
          {green !== null && (
            <ReferenceLine
              y={green}
              stroke={RAG_HEX.GREEN}
              strokeDasharray="4 4"
              label={{
                value: t('kpi:fields.greenThreshold'),
                fontSize: 11,
                fill: RAG_HEX.GREEN,
                position: 'insideTopLeft',
              }}
            />
          )}
          <Line
            type="stepAfter"
            dataKey="target"
            name={t('kpi:fields.target')}
            stroke="#64748b"
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            name={t('kpi:fields.actual')}
            stroke="#1d4ed8"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(p: {
              cx?: number;
              cy?: number;
              index?: number;
              payload?: { rag: keyof typeof RAG_HEX | null };
            }) => (
              <circle
                key={p.index}
                cx={p.cx}
                cy={p.cy}
                r={5}
                stroke="#fff"
                strokeWidth={1.5}
                fill={p.payload?.rag ? RAG_HEX[p.payload.rag] : NO_RAG_HEX}
              />
            )}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
