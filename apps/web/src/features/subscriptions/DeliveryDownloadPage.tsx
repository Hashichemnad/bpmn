import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { apiDownload } from '@/api/client';
import { downloadBlob } from '@/features/modeler/export';
import { useErrorMessage } from '@/components/i18n-helpers';
import { LoadingState } from '@/components/states';

/** Secure link of a report e-mail (signed in as the recipient): downloads the generated file. */
export function DeliveryDownloadPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<'loading' | 'done' | string>('loading');

  const fetchFile = () =>
    apiDownload(`/report-subscriptions/deliveries/${id}/file`, {}, 'report').then(
      (f) => {
        downloadBlob(f.blob, f.fileName);
        setState('done');
      },
      (e: unknown) => setState(errorMessage(e)),
    );

  useEffect(() => {
    void fetchFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <Card>
      {state === 'loading' ? (
        <LoadingState />
      ) : state === 'done' ? (
        <Result
          status="success"
          title={t('integrations:subscriptions.downloaded')}
          extra={[
            <Button key="again" onClick={() => void fetchFile()}>
              {t('integrations:subscriptions.downloadAgain')}
            </Button>,
            <Link key="list" to="/reports/subscriptions">
              <Button type="primary">{t('integrations:subscriptions.manage')}</Button>
            </Link>,
          ]}
        />
      ) : (
        <Result
          status="warning"
          title={t('integrations:subscriptions.downloadFailed')}
          subTitle={state}
        />
      )}
    </Card>
  );
}
