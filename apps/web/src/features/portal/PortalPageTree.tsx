import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tree, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildTree, type PortalPageNodeDto, type TreeNode } from '@processhub/shared';
import { usePortalSpacePages } from '@/api/portal';
import { useLocalized } from '@/components/i18n-helpers';
import { useViewportHeight, virtualTreeHeight } from '@/components/useVirtualTreeHeight';

/** Tree of the published pages of a space. */
export function PortalPageTree({ spaceId, selectedId }: { spaceId: string; selectedId?: string }) {
  const viewport = useViewportHeight();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const pages = usePortalSpacePages(spaceId);
  const data = useMemo(() => {
    type Node = { key: string; title: string; children: Node[] };
    const map = (list: TreeNode<PortalPageNodeDto>[]): Node[] =>
      list.map((p) => ({
        key: p.id,
        title: loc(p, 'title') || t('docs:untitled'),
        children: map(p.children),
      }));
    return map(buildTree(pages.data ?? []));
  }, [pages.data, loc, t]);
  return (
    <Card size="small" title={t('portal:docs.pages')}>
      {data.length ? (
        <Tree
          height={virtualTreeHeight(data, viewport, 220)}
          key={spaceId}
          defaultExpandAll
          selectedKeys={selectedId ? [selectedId] : []}
          treeData={data}
          onSelect={(keys) => keys[0] && navigate(`/portal/pages/${String(keys[0])}`)}
        />
      ) : (
        <Typography.Text type="secondary">{t('portal:docs.empty')}</Typography.Text>
      )}
    </Card>
  );
}
