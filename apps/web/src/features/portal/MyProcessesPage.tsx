import { Link } from 'react-router-dom';
import { Alert, Col, Empty, Row, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { MyPortalItemDto } from '@processhub/shared';
import { useMyPortal } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { PortalItemCard } from './PortalItemCard';

const REASON_COLORS = { OWNER: 'gold', DEPARTMENT: 'blue', ROLE: 'purple' } as const;

/** Processes and pages where the user's job roles or department are involved. */
export function MyProcessesPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const my = useMyPortal();
  if (my.isLoading) return <LoadingState />;
  if (my.isError || !my.data)
    return <ErrorState error={my.error} onRetry={() => void my.refetch()} />;
  const d = my.data;
  const card = (item: MyPortalItemDto) => (
    <Col xs={24} md={12} lg={8} key={item.id}>
      <PortalItemCard item={item}>
        <div style={{ marginBlockStart: 8 }}>
          {item.reasons.map((r) => (
            <Tag key={r} color={REASON_COLORS[r]}>
              {t(`portal:my.reason.${r}`)}
            </Tag>
          ))}
        </div>
        {item.steps.length > 0 && (
          <div style={{ marginBlockStart: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('portal:my.yourSteps')}:{' '}
            </Typography.Text>
            {item.steps.map((s, i) => (
              <span key={s.bpmnElementId}>
                {i > 0 && ', '}
                <Link
                  to={`/portal/processes/${item.id}?step=${encodeURIComponent(s.bpmnElementId)}`}
                >
                  {loc(s) || s.bpmnElementId}
                </Link>
              </span>
            ))}
          </div>
        )}
      </PortalItemCard>
    </Col>
  );
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('portal:nav.home'), to: '/portal' }, { title: t('portal:nav.my') }]}
        title={t('portal:my.title')}
        subtitle={
          <Space size={6} wrap>
            {d.department && <Tag color="blue">{loc(d.department)}</Tag>}
            {d.jobRoles.map((r) => (
              <Tag color="purple" key={r.id}>
                {loc(r)}
              </Tag>
            ))}
          </Space>
        }
      />
      {!d.department && !d.jobRoles.length && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('portal:my.noProfile')}
        />
      )}
      <Typography.Title level={4} className="ph-portal-section-title">
        {t('portal:nav.processes')}
      </Typography.Title>
      {d.processes.length ? (
        <Row gutter={[16, 16]}>{d.processes.map(card)}</Row>
      ) : (
        <Empty description={t('portal:my.noProcesses')} />
      )}
      <Typography.Title level={4} className="ph-portal-section-title">
        {t('portal:nav.docs')}
      </Typography.Title>
      {d.pages.length ? (
        <Row gutter={[16, 16]}>{d.pages.map(card)}</Row>
      ) : (
        <Empty description={t('portal:my.noPages')} />
      )}
    </>
  );
}
