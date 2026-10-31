import { useEffect, useMemo, useState, type Key } from 'react';
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
import { useAllDiagrams } from '@/api/diagrams';
import { DiagramTypeIcon } from '@/features/diagrams/DiagramTypeIcon';
import { NewItemMenu } from '@/features/diagrams/NewItemMenu';
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

/** Tree keys of diagrams and of the group of diagrams without a parent process (D-120). */
export const DIAGRAM_NODE_PREFIX = 'diagram:';
const DIAGRAM_GROUP_KEY = 'group:diagrams';
const isFixedNode = (key: string) =>
  !!parseCategoryKey(key) || key.startsWith(DIAGRAM_NODE_PREFIX) || key === DIAGRAM_GROUP_KEY;

export function ProcessTree({ selectedId }: { selectedId?: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const tree = useProcessTree();
  const diagrams = useAllDiagrams();
  const move = useMoveProcess();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Key[] | null>(null);
  const items = useMemo(() => tree.data ?? [], [tree.data]);
  const canDrag = can(PERMISSIONS.PROCESSES_EDIT) && !search;

  const diagramList = useMemo(() => diagrams.data ?? [], [diagrams.data]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const isHit = (v: { code: string; nameEn: string; nameAr: string }) =>
      [v.code, v.nameEn, v.nameAr].some((x) => x.toLowerCase().includes(q));
    const hit = new Set(items.filter(isHit).map((p) => p.id));
    // Keep ancestors of hits visible.
    const visible = new Set(hit);
    hit.forEach((id) => ancestorsOf(items, id).forEach((a) => visible.add(a)));
    for (const d of diagramList.filter(isHit)) {
      const key = `${DIAGRAM_NODE_PREFIX}${d.id}`;
      hit.add(key);
      visible.add(key);
      visible.add(DIAGRAM_GROUP_KEY);
      if (d.processId) {
        visible.add(d.processId);
        ancestorsOf(items, d.processId).forEach((a) => visible.add(a));
      }
    }
    return { hit, visible };
  }, [items, diagramList, search]);

  const treeData = useMemo<TreeDataNode[]>(() => {
    const roots = buildTree(items);
    const processIds = new Set(items.map((p) => p.id));
    const diagramNode = (d: (typeof diagramList)[number]): TreeDataNode | null => {
      const key = `${DIAGRAM_NODE_PREFIX}${d.id}`;
      if (matches && !matches.visible.has(key)) return null;
      return {
        key,
        isLeaf: true,
        title: (
          <span
            className={matches?.hit.has(key) ? 'ph-tree-hit' : undefined}
            data-diagram-type={d.type}
          >
            <DiagramTypeIcon type={d.type} style={{ marginInlineEnd: 6 }} />
            <span className="ph-tree-code" dir="ltr">
              {d.code}
            </span>{' '}
            {loc(d)}
          </span>
        ),
      };
    };
    const diagramsOf = (processId: string | null) =>
      diagramList
        .filter((d) =>
          processId ? d.processId === processId : !d.processId || !processIds.has(d.processId),
        )
        .map(diagramNode)
        .filter((x): x is TreeDataNode => !!x);
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
        children: [
          ...n.children.map(toNode).filter((x): x is TreeDataNode => !!x),
          ...diagramsOf(n.id),
        ],
      };
    };
    const loose = diagramsOf(null);
    const groups: TreeDataNode[] = PROCESS_CATEGORIES.map((c) => ({
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
    if (loose.length)
      groups.push({
        key: DIAGRAM_GROUP_KEY,
        selectable: false,
        title: <Typography.Text strong>{t('diagrams:tree.group')}</Typography.Text>,
        children: loose,
      });
    return groups;
  }, [items, diagramList, matches, loc, t]);

  // Keep the selected process and its ancestors expanded as the user navigates.
  useEffect(() => {
    if (!selectedId || !items.length) return;
    const diagram = selectedId.startsWith(DIAGRAM_NODE_PREFIX)
      ? diagramList.find((d) => `${DIAGRAM_NODE_PREFIX}${d.id}` === selectedId)
      : undefined;
    const anchor = diagram ? diagram.processId : selectedId;
    setExpanded((prev) => [
      ...new Set([
        ...(prev ?? [...PROCESS_CATEGORIES.map(categoryNodeKey), DIAGRAM_GROUP_KEY]),
        selectedId,
        ...(anchor ? [anchor, ...ancestorsOf(items, anchor)] : [DIAGRAM_GROUP_KEY]),
      ]),
    ]);
  }, [selectedId, items, diagramList]);

  const expandedKeys = matches
    ? [...PROCESS_CATEGORIES.map(categoryNodeKey), ...matches.visible]
    : (expanded ?? [...PROCESS_CATEGORIES.map(categoryNodeKey), DIAGRAM_GROUP_KEY]);

  const onDrop: TreeProps['onDrop'] = (info) => {
    const dragId = String(info.dragNode.key);
    const targetKey = String(info.node.key);
    if (targetKey.startsWith(DIAGRAM_NODE_PREFIX) || targetKey === DIAGRAM_GROUP_KEY) return;
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
      <NewItemMenu />
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
            canDrag ? { icon: false, nodeDraggable: (n) => !isFixedNode(String(n.key)) } : false
          }
          allowDrop={({ dropNode, dropPosition }) =>
            !(parseCategoryKey(String(dropNode.key)) && dropPosition !== 0) &&
            !String(dropNode.key).startsWith(DIAGRAM_NODE_PREFIX) &&
            String(dropNode.key) !== DIAGRAM_GROUP_KEY
          }
          treeData={treeData}
          selectedKeys={selectedId ? [selectedId] : []}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpanded(keys)}
          onSelect={(keys) => {
            const key = keys[0] ? String(keys[0]) : '';
            if (!key) return;
            if (key.startsWith(DIAGRAM_NODE_PREFIX))
              navigate(`/diagrams/${key.slice(DIAGRAM_NODE_PREFIX.length)}`);
            else navigate(`/processes/${key}`);
          }}
          onDrop={onDrop}
          disabled={move.isPending}
        />
      )}
    </div>
  );
}
