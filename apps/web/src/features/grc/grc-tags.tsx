import { Tag, Tooltip } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ControlEffectiveness, GrcStatus } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { bandOf, textOn, useGrcConfig } from './grc-helpers';

/** Score with the band name in the band's colour. */
export function RatingTag({ score, band }: { score: number; band: string | null }) {
  const { locale } = useLocale();
  const b = bandOf(useGrcConfig().bands, band);
  if (!b) return <Tag>{score}</Tag>;
  return (
    <Tag
      bordered={false}
      style={{ background: b.colour, color: textOn(b.colour), fontWeight: 500 }}
      data-band={b.key}
    >
      {locale === 'ar' ? b.nameAr : b.nameEn} · {score}
    </Tag>
  );
}

const STATUS_COLOURS: Record<GrcStatus, string> = {
  DRAFT: 'orange',
  ACTIVE: 'green',
  RETIRED: 'default',
};

export function GrcStatusTag({ status }: { status: GrcStatus }) {
  const { t } = useTranslation();
  return <Tag color={STATUS_COLOURS[status]}>{t(`grc:status.${status}`)}</Tag>;
}

const EFFECTIVENESS_COLOURS: Record<ControlEffectiveness, string> = {
  EFFECTIVE: 'green',
  PARTLY: 'gold',
  NOT_EFFECTIVE: 'red',
  NOT_ASSESSED: 'default',
};

export function EffectivenessTag({ value }: { value: ControlEffectiveness }) {
  const { t } = useTranslation();
  return <Tag color={EFFECTIVENESS_COLOURS[value]}>{t(`grc:effectiveness.${value}`)}</Tag>;
}

export function OverdueTag() {
  const { t } = useTranslation();
  return (
    <Tooltip title={t('grc:detail.overdue')}>
      <Tag color="red" icon={<WarningFilled />}>
        {t('grc:detail.overdue')}
      </Tag>
    </Tooltip>
  );
}
