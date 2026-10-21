import { useMemo } from 'react';
import { buildTree, type DepartmentDto, type TreeNode } from '@processhub/shared';
import { useDepartments } from '@/api/hooks';
import { useLocalized } from '@/components/i18n-helpers';

/** Departments as TreeSelect data in the active language. */
export function useDepartmentTreeData() {
  const departments = useDepartments();
  const loc = useLocalized();
  return useMemo(() => {
    type Node = { title: string; value: string; children: Node[] };
    const map = (nodes: TreeNode<DepartmentDto>[]): Node[] =>
      nodes.map((d) => ({ title: loc(d), value: d.id, children: map(d.children) }));
    return map(buildTree(departments.data ?? []));
  }, [departments.data, loc]);
}
