import { useMemo, useState, type Key } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Input, Tree, Typography, type TreeDataNode, type TreeProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  PROCESS_CATEGORIES,
  buildTree,
  type ProcessSummaryDto,
  type TreeNode,
} from '@processhub/shared';
import { useMoveProcess, useProcessTree } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { CATEGORY_COLORS } from '@/components/colors';
import { LoadingState, ErrorState } from '@/components/states';
import { categoryNodeKey, computeDrop, parseCategoryKey } from './tree-dnd';

function ancestorsOf(items: ProcessSummaryDto[], id: string): string[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  const result: string[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current) {
    result.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return result;
}

export function ProcessTree({ selectedId }: { selectedId?: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const tree = useProcessTree();
  const move = useMoveProcess();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Key[] | null>(null);
  const items = useMemo(() => tree.data ?? [], [tree.data]);
  const canDrag = can(PERMISSIONS.PROCESSES_EDIT) && !search;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set(
      items
        .filter((p) => [p.code, p.nameEn, p.nameAr].some((v) => v.toLowerCase().includes(q)))
        .map((p) => p.id),
    );
    // Keep ancestors of hits visible.
    const visible = new Set(hit);
    hit.forEach((id) => ancestorsOf(items, id).forEach((a) => visible.add(a)));
    return { hit, visible };
  }, [items, search]);

  const treeData = useMemo<TreeDataNode[]>(() => {
    const roots = buildTree(items);
    const toNode = (n: TreeNode<ProcessSummaryDto>): TreeDataNode | null => {
      if (matches && !matches.visible.has(n.id)) return null;
      return {
        key: n.id,
        title: (
          <span className={matches?.hit.has(n.id) ? 'ph-tree-hit' : undefined}>
            <span className="ph-tree-code" dir="ltr">
              {n.code}
            </span>{' '}
            {loc(n)}
          </span>
        ),
        children: n.children.map(toNode).filter((x): x is TreeDataNode => !!x),
      };
    };
    return PROCESS_CATEGORIES.map((c) => ({
      key: categoryNodeKey(c),
      selectable: false,
      draggable: false,
      title: (
        <Typography.Text strong style={{ color: CATEGORY_COLORS[c] }}>
          {t(`processes:category.${c}`)}
        </Typography.Text>
      ),
      children: roots
        .filter((r) => r.category === c)
        .map(toNode)
        .filter((x): x is TreeDataNode => !!x),
    }));
  }, [items, matches, loc, t]);

  const defaultExpanded = useMemo<Key[]>(
    () => [
      ...PROCESS_CATEGORIES.map(categoryNodeKey),
      ...(selectedId ? ancestorsOf(items, selectedId) : []),
    ],
    [items, selectedId],
  );
  const expandedKeys = matches
    ? [...PROCESS_CATEGORIES.map(categoryNodeKey), ...matches.visible]
    : (expanded ?? defaultExpanded);

  const onDrop: TreeProps['onDrop'] = (info) => {
    const dragId = String(info.dragNode.key);
    const targetKey = String(info.node.key);
    const pos = info.node.pos.split('-');
    const relative = (info.dropPosition - Number(pos[pos.length - 1])) as -1 | 0 | 1;
    const body = computeDrop(items, dragId, targetKey, info.dropToGap, relative);
    if (!body) return;
    move.mutate(
      { id: dragId, body },
      {
        onSuccess: () => message.success(t('processes:moved')),
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  };

  if (tree.isLoading) return <LoadingState />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;

  return (
    <div className="ph-tree">
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={t('processes:tree.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
        aria-label={t('processes:tree.search')}
      />
      {canDrag && (
        <Typography.Text type="secondary" className="ph-tree-hint">
          {t('processes:tree.dragHint')}
        </Typography.Text>
      )}
      {matches && matches.hit.size === 0 ? (
        <Typography.Text type="secondary">{t('processes:tree.noMatches')}</Typography.Text>
      ) : (
        <Tree
          blockNode
          showLine={{ showLeafIcon: false }}
          draggable={
            canDrag
              ? { icon: false, nodeDraggable: (n) => !parseCategoryKey(String(n.key)) }
              : false
          }
          allowDrop={({ dropNode, dropPosition }) =>
            !(parseCategoryKey(String(dropNode.key)) && dropPosition !== 0)
          }
          treeData={treeData}
          selectedKeys={selectedId ? [selectedId] : []}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpanded(keys)}
          onSelect={(keys) => keys[0] && navigate(`/processes/${String(keys[0])}`)}
          onDrop={onDrop}
          disabled={move.isPending}
        />
      )}
    </div>
  );
}
