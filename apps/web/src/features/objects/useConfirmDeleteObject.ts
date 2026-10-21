import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import type { RepoObjectDto } from '@processhub/shared';
import { useDeleteObject } from '@/api/hooks';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';

/** Confirmation dialog for deleting a library object (warns when it is in use). */
export function useConfirmDeleteObject() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { modal, message } = App.useApp();
  const remove = useDeleteObject();
  return (o: RepoObjectDto, onDone?: () => void) =>
    modal.confirm({
      title: t('objects:deleteTitle', { name: loc(o) }),
      content: o.usageCount > 0 ? t('objects:deleteInUse', { count: o.usageCount }) : t('objects:deleteText'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await remove.mutateAsync(o.id);
          message.success(t('deleted'));
          onDone?.();
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });
}
