import { Button, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ColourByMode, LegendItem } from './colour-by';

/** Legend of the active "colour by" view (bottom inline-start corner of the canvas). */
export function ColourByLegend({
  mode,
  items,
  missing,
  note,
  onClose,
}: {
  /** Source of a metric view (event log, simulation run). */
  note?: string;
  mode: ColourByMode;
  items: LegendItem[];
  /** Missing-information view: how many steps lack a role / a description. */
  missing?: { role: number; description: number };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="ph-colour-legend" aria-label={t('modeler:colourBy.legend')}>
      <header>
        <Typography.Text strong>{t(`modeler:colourBy.modes.${mode}`)}</Typography.Text>
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          aria-label={t('modeler:colourBy.off')}
          title={t('modeler:colourBy.off')}
          onClick={onClose}
        />
      </header>
      <Typography.Text type="secondary" className="ph-colour-legend-hint">
        {t('modeler:colourBy.viewOnly')}
      </Typography.Text>
      {note && (
        <Typography.Text className="ph-colour-legend-hint" data-testid="colour-by-note">
          {note}
        </Typography.Text>
      )}
      <ul>
        {items.map((i) => (
          <li key={i.key}>
            <span
              className="ph-colour-swatch"
              style={{ background: i.fill, borderColor: i.stroke }}
              aria-hidden="true"
            />
            <span className="ph-colour-label">{i.label || '—'}</span>
            <span className="ph-colour-count">{i.count}</span>
          </li>
        ))}
      </ul>
      {mode === 'missing' && missing && (missing.role > 0 || missing.description > 0) && (
        <ul className="ph-colour-missing">
          {missing.role > 0 && (
            <li>{t('modeler:colourBy.missingRole', { count: missing.role })}</li>
          )}
          {missing.description > 0 && (
            <li>{t('modeler:colourBy.missingDescription', { count: missing.description })}</li>
          )}
        </ul>
      )}
    </section>
  );
}
