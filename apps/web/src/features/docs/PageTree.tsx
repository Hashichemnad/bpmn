import { useEffect, useMemo, useState, type Key } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Input, Tooltip, Tree, Typography, type TreeDataNode, type TreeProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { buildTree, type PageSummaryDto, type TreeNode } from '@processhub/shared';
import { useMovePage, usePageTree } from '@/api/docs';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocale } from '@/app/LocaleProvider';
import { computePageDrop } from './page-tree-dnd';

function ancestorsOf(items: PageSummaryDto[], id: string): string[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  const result: string[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current) {
    result.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return result;
}

/** Page tree of a space: search, drag-and-drop re-order / re-parent for editors. */
export function PageTree({
  spaceId,
  selectedId,
  canEdit,
}: {
  spaceId: string;
  selectedId?: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const tree = usePageTree(spaceId);
  const move = useMovePage(spaceId);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Key[]>([]);
  const items = useMemo(() => tree.data ?? [], [tree.data]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set(
      items
        .filter((p) => [p.titleEn, p.titleAr].some((v) => v.toLowerCase().includes(q)))
        .map((p) => p.id),
    );
    const visible = new Set(hit);
    hit.forEach((id) => ancestorsOf(items, id).forEach((a) => visible.add(a)));
    return { hit, visible };
  }, [items, search]);

  const treeData = useMemo<TreeDataNode[]>(() => {
    const toNode = (n: TreeNode<PageSummaryDto>): TreeDataNode | null => {
      if (matches && !matches.visible.has(n.id)) return null;
      const missing = locale === 'ar' ? !n.hasAr : !n.hasEn;
      return {
        key: n.id,
        title: (
          <span className={matches?.hit.has(n.id) ? 'ph-tree-hit' : undefined}>
            {loc(n, 'title') || t('docs:untitled')}
            {missing && (
              <Tooltip title={t('docs:notInYourLanguage')}>
                <span className="ph-lang-missing">{locale === 'ar' ? 'EN' : 'ع'}</span>
              </Tooltip>
            )}
          </span>
        ),
        children: n.children.map(toNode).filter((x): x is TreeDataNode => !!x),
      };
    };
    return buildTree(items)
      .map(toNode)
      .filter((x): x is TreeDataNode => !!x);
  }, [items, matches, loc, locale, t]);

  useEffect(() => {
    if (!selectedId || !items.length) return;
    setExpanded((prev) => [...new Set([...prev, ...ancestorsOf(items, selectedId)])]);
  }, [selectedId, items]);

  const onDrop: TreeProps['onDrop'] = (info) => {
    const dragId = String(info.dragNode.key);
    const pos = info.node.pos.split('-');
    const relative = (info.dropPosition - Number(pos[pos.length - 1])) as -1 | 0 | 1;
    const body = computePageDrop(items, dragId, String(info.node.key), info.dropToGap, relative);
    if (!body) return;
    move.mutate(
      { id: dragId, body },
      {
        onSuccess: () => message.success(t('docs:pages.moved')),
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  };

  if (tree.isLoading) return <LoadingState />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;
  const canDrag = canEdit && !search;

  return (
    <div className="ph-tree">
      <Input
        allowClear
        size="small"
        prefix={<SearchOutlined />}
        placeholder={t('docs:pages.filter')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
        aria-label={t('docs:pages.filter')}
      />
      {canDrag && items.length > 1 && (
        <Typography.Text type="secondary" className="ph-tree-hint">
          {t('docs:pages.dragHint')}
        </Typography.Text>
      )}
      {!items.length ? (
        <Typography.Text type="secondary">{t('docs:pages.none')}</Typography.Text>
      ) : matches && matches.hit.size === 0 ? (
        <Typography.Text type="secondary">{t('processes:tree.noMatches')}</Typography.Text>
      ) : (
        <Tree
          blockNode
          showLine={{ showLeafIcon: false }}
          draggable={canDrag ? { icon: false } : false}
          treeData={treeData}
          selectedKeys={selectedId ? [selectedId] : []}
          expandedKeys={matches ? [...matches.visible] : expanded}
          onExpand={(keys) => setExpanded(keys)}
          onSelect={(keys) => keys[0] && navigate(`/docs/${spaceId}/pages/${String(keys[0])}`)}
          onDrop={onDrop}
          disabled={move.isPending}
        />
      )}
    </div>
  );
}
