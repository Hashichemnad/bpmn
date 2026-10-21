import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Input, Row, Tree, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_CATEGORIES,
  buildTree,
  type PortalProcessNodeDto,
  type TreeNode,
} from '@processhub/shared';
import { usePortalProcesses } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { CATEGORY_COLORS } from '@/components/colors';
import { useLocalized } from '@/components/i18n-helpers';
import { ProcessHouse } from './ProcessHouse';

/** All published processes: the house and the full hierarchy per band. */
export function PortalProcessesPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const tree = usePortalProcesses();
  const [filter, setFilter] = useState('');

  const data = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const nodes = (tree.data ?? []).map((n) => ({
      ...n,
      parentId: n.parentId,
      sortOrder: n.sortOrder,
    }));
    type Node = { key: string; title: string; children: Node[] };
    const map = (list: TreeNode<PortalProcessNodeDto>[]): Node[] =>
      list
        .map((n) => ({ key: n.id, title: `${n.code} ${loc(n)}`, children: map(n.children) }))
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.children.length > 0);
    return Object.fromEntries(
      PROCESS_CATEGORIES.map((c) => [c, map(buildTree(nodes.filter((n) => n.category === c)))]),
    );
  }, [tree.data, filter, loc]);

  if (tree.isLoading) return <LoadingState />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('portal:nav.home'), to: '/portal' },
          { title: t('portal:nav.processes') },
        ]}
        title={t('portal:processes.title')}
        subtitle={t('portal:processes.subtitle')}
      />
      <ProcessHouse nodes={tree.data ?? []} />
      <Typography.Title level={4} className="ph-portal-section-title">
        {t('portal:processes.all')}
      </Typography.Title>
      <Input.Search
        allowClear
        placeholder={t('portal:processes.filter')}
        style={{ maxInlineSize: 360, marginBlockEnd: 12 }}
        onChange={(e) => setFilter(e.target.value)}
      />
      <Row gutter={[16, 16]}>
        {PROCESS_CATEGORIES.map((c) => (
          <Col xs={24} lg={8} key={c}>
            <Card
              size="small"
              title={
                <span style={{ color: CATEGORY_COLORS[c] }}>{t(`processes:category.${c}`)}</span>
              }
            >
              {data[c].length ? (
                <Tree
                  key={filter}
                  defaultExpandAll
                  treeData={data[c]}
                  onSelect={(keys) => keys[0] && navigate(`/portal/processes/${String(keys[0])}`)}
                />
              ) : (
                <Typography.Text type="secondary">{t('portal:noProcesses')}</Typography.Text>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
