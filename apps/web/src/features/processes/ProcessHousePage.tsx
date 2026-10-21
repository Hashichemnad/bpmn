import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Col, Flex, Row, Tooltip, Typography } from 'antd';
import { BranchesOutlined, NodeIndexOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  PROCESS_CATEGORIES,
  type ProcessCategory,
  type ProcessSummaryDto,
} from '@processhub/shared';
import { useProcessTree } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { CATEGORY_COLORS } from '@/components/colors';
import { useLocalized } from '@/components/i18n-helpers';
import { ProcessFormModal } from './ProcessFormModal';

/** Landing page: the classic process house — management (roof), core, support (foundation). */
export function ProcessHousePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const tree = useProcessTree();
  const [creating, setCreating] = useState<ProcessCategory | null>(null);

  const { byCategory, childCount } = useMemo(() => {
    const byCategory: Record<ProcessCategory, ProcessSummaryDto[]> = {
      MANAGEMENT: [],
      CORE: [],
      SUPPORT: [],
    };
    const childCount = new Map<string, number>();
    for (const p of tree.data ?? []) {
      if (!p.parentId) byCategory[p.category].push(p);
      else childCount.set(p.parentId, (childCount.get(p.parentId) ?? 0) + 1);
    }
    PROCESS_CATEGORIES.forEach((c) => byCategory[c].sort((a, b) => a.sortOrder - b.sortOrder));
    return { byCategory, childCount };
  }, [tree.data]);

  if (tree.isLoading) return <LoadingState />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;

  const canCreate = can(PERMISSIONS.PROCESSES_CREATE);
  const total = tree.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title={t('processes:house.title')}
        subtitle={t('processes:house.subtitle', { count: total })}
        extra={
          canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating('CORE')}>
              {t('processes:new')}
            </Button>
          )
        }
      />
      <div className="ph-house">
        {PROCESS_CATEGORIES.map((category) => (
          <section
            key={category}
            className={`ph-band ph-band-${category.toLowerCase()}`}
            style={{ '--band-color': CATEGORY_COLORS[category] } as React.CSSProperties}
            aria-labelledby={`band-${category}`}
          >
            <Flex justify="space-between" align="center" className="ph-band-header">
              <div>
                <Typography.Title
                  level={5}
                  id={`band-${category}`}
                  style={{ margin: 0, color: CATEGORY_COLORS[category] }}
                >
                  {t(`processes:category.${category}`)}
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(`processes:house.bandHint.${category}`)}
                </Typography.Text>
              </div>
              {canCreate && (
                <Tooltip
                  title={t('processes:house.addTo', { band: t(`processes:category.${category}`) })}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<PlusOutlined />}
                    onClick={() => setCreating(category)}
                    aria-label={t('processes:house.addTo', {
                      band: t(`processes:category.${category}`),
                    })}
                  />
                </Tooltip>
              )}
            </Flex>
            {byCategory[category].length === 0 ? (
              <div className="ph-band-empty">{t('processes:house.emptyBand')}</div>
            ) : (
              <Row gutter={[12, 12]}>
                {byCategory[category].map((p) => (
                  <Col key={p.id} xs={24} sm={12} md={8} xl={6}>
                    <Link to={`/processes/${p.id}`} className="ph-tile-link">
                      <Card size="small" hoverable className="ph-tile">
                        <Typography.Text type="secondary" className="ph-tile-code" dir="ltr">
                          {p.code}
                        </Typography.Text>
                        <Typography.Paragraph
                          strong
                          ellipsis={{ rows: 2 }}
                          className="ph-tile-name"
                        >
                          {loc(p)}
                        </Typography.Paragraph>
                        <Flex gap={12} className="ph-tile-meta">
                          <span>
                            <BranchesOutlined />{' '}
                            {t('processes:subProcessCount', { count: childCount.get(p.id) ?? 0 })}
                          </span>
                          <Badge status="default" text={t(`processes:status.${p.status}`)} />
                        </Flex>
                      </Card>
                    </Link>
                  </Col>
                ))}
              </Row>
            )}
          </section>
        ))}
        {total === 0 && (
          <Card className="ph-house-empty">
            <Flex vertical align="center" gap={8}>
              <NodeIndexOutlined style={{ fontSize: 32, color: '#94a3b8' }} />
              <Typography.Text strong>{t('processes:house.emptyTitle')}</Typography.Text>
              <Typography.Text type="secondary">{t('processes:house.emptyText')}</Typography.Text>
            </Flex>
          </Card>
        )}
      </div>
      {creating && (
        <ProcessFormModal
          open
          mode="create"
          defaultCategory={creating}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}
