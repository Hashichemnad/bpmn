import { useMemo } from 'react';
import { buildTree, type ProcessSummaryDto, type TreeNode } from '@processhub/shared';
import { useProcessTree } from '@/api/hooks';
import { useLocalized } from '@/components/i18n-helpers';

export interface ProcessTreeOption {
  title: string;
  value: string;
  disabled: boolean;
  children: ProcessTreeOption[];
}

/** Repository processes as TreeSelect options ("code name"); `excludeId` cannot be chosen. */
export function useProcessTreeOptions(excludeId: string) {
  const tree = useProcessTree();
  const loc = useLocalized();
  const options = useMemo(() => {
    const map = (nodes: TreeNode<ProcessSummaryDto>[]): ProcessTreeOption[] =>
      nodes.map((p) => ({
        title: `${p.code} ${loc(p)}`,
        value: p.id,
        disabled: p.id === excludeId,
        children: map(p.children),
      }));
    return map(buildTree(tree.data ?? []));
  }, [tree.data, loc, excludeId]);
  return { options, processes: tree.data ?? [], loading: tree.isLoading };
}
