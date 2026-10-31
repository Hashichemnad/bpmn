import { Button, Flex, Progress, Tag, Typography } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { EventLogStatus, MiningJobDto } from '@processhub/shared';
import { useCancelJob } from '@/api/mining';

const STATUS_COLOUR: Record<EventLogStatus, string> = {
  DRAFT: 'default',
  IMPORTING: 'processing',
  READY: 'success',
  FAILED: 'error',
  DELETING: 'warning',
};

export function LogStatusTag({ status }: { status: EventLogStatus }) {
  const { t } = useTranslation();
  return <Tag color={STATUS_COLOUR[status]}>{t(`mining:status.${status}`)}</Tag>;
}

/** Progress of a running job with a cancel button. */
export function JobProgress({ job, canCancel = true }: { job: MiningJobDto; canCancel?: boolean }) {
  const { t } = useTranslation();
  const cancel = useCancelJob();
  const running = job.status === 'QUEUED' || job.status === 'RUNNING';
  return (
    <Flex vertical gap={4} data-testid="mining-job">
      <Flex align="center" gap={8}>
        <Typography.Text>
          {t(`mining:job.kind.${job.kind}`)} — {t(`mining:job.status.${job.status}`)}
        </Typography.Text>
        {running && canCancel && (
          <Button
            size="small"
            icon={<StopOutlined />}
            loading={cancel.isPending}
            onClick={() => cancel.mutate(job.id)}
          >
            {t('mining:job.cancel')}
          </Button>
        )}
      </Flex>
      <Progress
        percent={Math.round(job.progress * 100)}
        status={
          job.status === 'FAILED'
            ? 'exception'
            : job.status === 'DONE'
              ? 'success'
              : running
                ? 'active'
                : 'normal'
        }
      />
      {job.status === 'FAILED' && job.error && (
        <Typography.Text type="danger">
          {t('mining:job.failed', { error: job.error })}
        </Typography.Text>
      )}
    </Flex>
  );
}
