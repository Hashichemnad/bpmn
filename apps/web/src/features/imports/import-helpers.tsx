import { useMemo } from 'react';
import { Tag, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ImportBatchStatus, ProcessSummaryDto, PageSummaryDto } from '@processhub/shared';
import { useProcessTree } from '@/api/hooks';
import { usePageTree } from '@/api/docs';
import { useLocalized } from '@/components/i18n-helpers';

const STATUS_COLORS: Record<ImportBatchStatus, string> = {
  UPLOADED: 'default',
  PARSING: 'processing',
  READY: 'blue',
  APPLYING: 'processing',
  APPLIED: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
  UNDONE: 'default',
};

export function ImportStatusTag({ status }: { status: ImportBatchStatus }) {
  const { t } = useTranslation();
  return (
    <Tag color={STATUS_COLORS[status]} data-testid="import-status">
      {t(`imports:status.${status}`)}
    </Tag>
  );
}

interface TreeNode {
  value: string;
  title: string;
  children: TreeNode[];
  disabled?: boolean;
}

function buildTree<T extends { id: string; parentId: string | null }>(
  rows: T[],
  label: (r: T) => string,
  disabled?: (r: T) => boolean,
): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const r of rows)
    nodes.set(r.id, { value: r.id, title: label(r), children: [], disabled: disabled?.(r) });
  const roots: TreeNode[] = [];
  for (const r of rows) {
    const n = nodes.get(r.id)!;
    const parent = r.parentId ? nodes.get(r.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

/** Process tree picker (parent of imported processes). */
export function ProcessTreeSelect({
  value,
  onChange,
  id,
  placeholder,
  ownerId,
}: {
  value?: string | null;
  onChange?: (v: string | null) => void;
  id?: string;
  placeholder?: string;
  /** Only processes of this owner can be picked (Process Owner imports, D-164). */
  ownerId?: string;
}) {
  const loc = useLocalized();
  const tree = useProcessTree();
  const data = useMemo(
    () =>
      buildTree<ProcessSummaryDto>(
        tree.data ?? [],
        (p) => `${p.code} ${loc(p)}`,
        ownerId ? (p) => p.ownerId !== ownerId : undefined,
      ),
    [tree.data, loc, ownerId],
  );
  return (
    <TreeSelect
      id={id}
      allowClear
      showSearch
      treeNodeFilterProp="title"
      loading={tree.isLoading}
      value={value ?? undefined}
      onChange={(v) => onChange?.((v as string | undefined) ?? null)}
      treeData={data}
      placeholder={placeholder}
      style={{ width: '100%' }}
    />
  );
}

/** Page picker of one space (parent of imported pages). */
export function PageTreeSelect({
  spaceId,
  value,
  onChange,
  id,
}: {
  spaceId: string | null | undefined;
  value?: string | null;
  onChange?: (v: string | null) => void;
  id?: string;
}) {
  const loc = useLocalized();
  const pages = usePageTree(spaceId ?? undefined);
  const data = useMemo(
    () => buildTree<PageSummaryDto>(pages.data ?? [], (p) => loc(p, 'title') || '—'),
    [pages.data, loc],
  );
  return (
    <TreeSelect
      id={id}
      allowClear
      showSearch
      disabled={!spaceId}
      treeNodeFilterProp="title"
      loading={pages.isLoading}
      value={value ?? undefined}
      onChange={(v) => onChange?.((v as string | undefined) ?? null)}
      treeData={data}
      style={{ width: '100%' }}
    />
  );
}
