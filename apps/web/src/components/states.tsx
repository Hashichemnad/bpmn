import { Button, Empty, Result, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { useErrorMessage } from './i18n-helpers';

export function LoadingState({ tip }: { tip?: string }) {
  const { t } = useTranslation();
  return (
    <div className="ph-center" role="status" aria-live="polite">
      <Spin size="large" />
      <div className="ph-muted" style={{ marginTop: 12 }}>
        {tip ?? t('loading')}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const message = useErrorMessage();
  return (
    <Result
      status="warning"
      title={t('errorTitle')}
      subTitle={message(error)}
      extra={onRetry ? <Button onClick={onRetry}>{t('retry')}</Button> : undefined}
    />
  );
}

export function EmptyState({ description, action }: { description: ReactNode; action?: ReactNode }) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} style={{ padding: '32px 0' }}>
      {action}
    </Empty>
  );
}
