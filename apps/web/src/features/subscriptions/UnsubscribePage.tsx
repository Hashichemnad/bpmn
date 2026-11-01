import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, Flex, Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { BrandMark } from '@/layout/BrandMark';
import { LanguageToggle } from '@/layout/AppLayout';
import { LoadingState } from '@/components/states';
import { useErrorMessage } from '@/components/i18n-helpers';

/** Public page of the unsubscribe link in every scheduled report e-mail. */
export function UnsubscribePage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<{ name?: string; error?: string } | null>(null);

  useEffect(() => {
    api<{ name: string }>('/report-subscriptions/unsubscribe', {
      method: 'POST',
      body: { token },
    }).then(
      (r) => setState({ name: r.name }),
      (e: unknown) => setState({ error: errorMessage(e) }),
    );
  }, [token, errorMessage]);

  return (
    <Flex justify="center" align="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: 480, maxWidth: '100%' }}>
        <Flex justify="space-between" align="center" style={{ marginBlockEnd: 16 }}>
          <BrandMark />
          <LanguageToggle />
        </Flex>
        {!state ? (
          <LoadingState />
        ) : state.error ? (
          <Result
            status="warning"
            title={t('integrations:subscriptions.unsubscribeFailed')}
            subTitle={state.error}
          />
        ) : (
          <Result
            status="success"
            title={t('integrations:subscriptions.unsubscribed')}
            subTitle={t('integrations:subscriptions.unsubscribedHint', { name: state.name })}
            extra={
              <Link to="/reports/subscriptions">
                <Button>{t('integrations:subscriptions.manage')}</Button>
              </Link>
            }
          />
        )}
      </Card>
    </Flex>
  );
}
