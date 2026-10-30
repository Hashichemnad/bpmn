import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotificationDto } from '@processhub/shared';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';

/** Translated text of a notification from its type and stored parameters. */
export function useNotificationText() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  return useCallback(
    (n: NotificationDto) => {
      const p = n.params;
      const title = `${p.code ? `${p.code} ` : ''}${loc({ titleEn: p.titleEn, titleAr: p.titleAr }, 'title')}`;
      const values = {
        title,
        actor:
          loc({ nameEn: p.actorEn, nameAr: p.actorAr }) ||
          (n.actor ? loc(n.actor) || n.actor.email : ''),
        step: loc({ nameEn: p.stepEn, nameAr: p.stepAr }),
        version: p.version ?? '',
        comment: p.comment ?? '',
        due: p.due ? formatDate(String(p.due), false) : '',
        status: p.status ? t(`governance:feedback.status.${p.status}`) : '',
        kind:
          p.kind === 'IMPROVEMENT' || p.kind === 'OUTDATED'
            ? t(`governance:feedback.kind.${p.kind}`)
            : '',
        reply: p.reply ?? '',
      };
      const key =
        n.type === 'REVIEW_OVERDUE'
          ? `REVIEW_OVERDUE_${p.kind === 'periodic' ? 'periodic' : 'task'}`
          : n.type === 'GRC_REVIEW'
            ? `GRC_REVIEW_${p.kind === 'overdue' ? 'overdue' : 'due'}`
            : n.type;
      return {
        title: t(`governance:notifications.title.${key}`, values),
        detail: values.comment || values.reply || '',
      };
    },
    [t, loc, formatDate],
  );
}
