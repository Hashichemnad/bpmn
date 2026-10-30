import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { App, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useEngagementAction, useFinding } from '@/api/assurance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { FindingCard, ResponseModal } from './FindingParts';

/** One audit finding for its response owner (no audit workspace needed; portal or workspace). */
export function FindingPage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const q = useFinding(id);
  const act = useEngagementAction(q.data?.engagementId ?? '');
  const [responding, setResponding] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const f = q.data;
  return (
    <>
      <PageHeader
        crumbs={
          portal
            ? [{ title: t('assurance:portal.tasks'), to: '/portal/tasks' }, { title: f.code }]
            : [{ title: t('nav.tasks'), to: '/tasks' }, { title: f.code }]
        }
        title={
          <Space wrap>
            <span dir="ltr">{f.engagement.code}</span>
            {loc(f.engagement, 'title')}
          </Space>
        }
        subtitle={
          <Typography.Text type="secondary">{t('assurance:audits.findingFor')}</Typography.Text>
        }
      />
      <FindingCard finding={f} links={!portal} onRespond={() => setResponding(true)} highlight />
      {responding && (
        <ResponseModal
          finding={f}
          saving={act.isPending}
          onClose={() => setResponding(false)}
          onSave={(body) =>
            act.mutate(
              { kind: 'respond', id: f.id, body },
              {
                onSuccess: () => {
                  setResponding(false);
                  message.success(t('assurance:audits.responded'));
                  void q.refetch();
                },
                onError: (e) => message.error(errorMessage(e)),
              },
            )
          }
        />
      )}
    </>
  );
}
