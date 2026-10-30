import { useMemo } from 'react';
import { Card, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildTree, type CapabilityDto, type TreeNode } from '@processhub/shared';
import { EmptyState } from '@/components/states';
import { useEaLabel } from './ea-helpers';

/** Capability map: level-1 columns with nested level-2 / level-3 tiles. */
export function CapabilityMap({ capabilities }: { capabilities: CapabilityDto[] }) {
  const { t } = useTranslation();
  const label = useEaLabel();
  const tree = useMemo(() => buildTree(capabilities), [capabilities]);
  if (!tree.length) return <EmptyState description={t('ea:capabilities.empty')} />;

  const tile = (c: TreeNode<CapabilityDto>) => (
    <div key={c.id} className={`ph-cap-tile ph-cap-l${c.level}`} data-testid="cap-tile">
      <Typography.Text strong={c.level < 3}>{label(c)}</Typography.Text>
      {c.children.length > 0 && <div className="ph-cap-children">{c.children.map(tile)}</div>}
    </div>
  );
  return (
    <Card>
      <div className="ph-cap-map">{tree.map(tile)}</div>
    </Card>
  );
}
