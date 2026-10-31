import { Col, Empty, Row, Segmented } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DIAGRAM_TYPES, type DiagramType } from '@processhub/shared';
import { usePortalDiagrams } from '@/api/diagrams';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { PortalItemCard } from '@/features/portal/PortalItemCard';
import { DiagramTypeIcon } from './DiagramTypeIcon';

/** /portal/diagrams — published diagrams, filtered by type (value chains, org charts, DMN …). */
export function PortalDiagramsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const type = (params.get('type') as DiagramType | null) ?? undefined;
  const list = usePortalDiagrams(type);
  return (
    <>
      <PageHeader title={t('diagrams:portal.title')} subtitle={t('diagrams:portal.subtitle')} />
      <Segmented
        value={type ?? 'ALL'}
        onChange={(v) => setParams(v === 'ALL' ? {} : { type: String(v) })}
        options={[
          { value: 'ALL', label: t('diagrams:portal.all') },
          ...DIAGRAM_TYPES.map((d) => ({
            value: d,
            label: (
              <span>
                <DiagramTypeIcon type={d} /> {t(`diagrams:type.${d}`)}
              </span>
            ),
          })),
        ]}
        style={{ marginBlockEnd: 16 }}
      />
      {list.isLoading ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <Empty description={t('diagrams:portal.none')} />
      ) : (
        <Row gutter={[16, 16]}>
          {list.data.map((item) => (
            <Col key={item.id} xs={24} md={12} xl={8}>
              <PortalItemCard item={item} />
            </Col>
          ))}
        </Row>
      )}
    </>
  );
}
