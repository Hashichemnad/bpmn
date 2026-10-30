import { Alert, App, Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useDecideGrcBatch } from '@/api/assurance';
import { useErrorMessage } from '@/components/i18n-helpers';

/** Approve or reject all changes of one Excel import together (D-104). */
export function BatchDecision({ batchId, count }: { batchId: string; count: number }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const decide = useDecideGrcBatch();
  const run = (decision: 'APPROVE' | 'REJECT') =>
    decide.mutate(
      { batchId, decision },
      {
        onSuccess: () =>
          message.success(
            t(decision === 'APPROVE' ? 'assurance:changes.approved' : 'assurance:changes.rejected'),
          ),
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBlockEnd: 12 }}
      data-testid="change-batch"
      message={t('assurance:changes.batch', { count })}
      action={
        <Space>
          <Button
            size="small"
            type="primary"
            loading={decide.isPending}
            data-testid="batch-approve"
            onClick={() => run('APPROVE')}
          >
            {t('assurance:changes.approveAll')}
          </Button>
          <Button size="small" danger loading={decide.isPending} onClick={() => run('REJECT')}>
            {t('assurance:changes.rejectAll')}
          </Button>
        </Space>
      }
    />
  );
}
