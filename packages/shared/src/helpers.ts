import type { Locale } from './constants';

type BilingualRecord = Partial<Record<string, unknown>>;

/**
 * Returns `${field}En` / `${field}Ar` for the given locale, falling back to the
 * other language when the preferred value is empty (CLAUDE.md §5).
 */
export function localized(
  entity: BilingualRecord | null | undefined,
  field: string,
  locale: Locale,
): string {
  if (!entity) return '';
  const en = entity[`${field}En`];
  const ar = entity[`${field}Ar`];
  const primary = locale === 'ar' ? ar : en;
  const secondary = locale === 'ar' ? en : ar;
  if (typeof primary === 'string' && primary.trim()) return primary;
  if (typeof secondary === 'string' && secondary.trim()) return secondary;
  return '';
}

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
};

export type PasswordPolicyError =
  'TOO_SHORT' | 'MISSING_UPPER' | 'MISSING_LOWER' | 'MISSING_DIGIT' | 'MISSING_SYMBOL';

/** Returns a list of policy violations (empty when the password is acceptable). */
export function checkPasswordPolicy(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordPolicyError[] {
  const errors: PasswordPolicyError[] = [];
  if (password.length < policy.minLength) errors.push('TOO_SHORT');
  if (policy.requireUpper && !/\p{Lu}/u.test(password)) errors.push('MISSING_UPPER');
  if (policy.requireLower && !/\p{Ll}/u.test(password)) errors.push('MISSING_LOWER');
  if (policy.requireDigit && !/\p{Nd}/u.test(password)) errors.push('MISSING_DIGIT');
  if (policy.requireSymbol && !/[^\p{L}\p{Nd}]/u.test(password)) errors.push('MISSING_SYMBOL');
  return errors;
}

export interface TreeItem {
  id: string;
  parentId: string | null;
  sortOrder?: number;
}

export type TreeNode<T extends TreeItem> = T & { children: TreeNode<T>[] };

/** Builds a forest from a flat list, ordering siblings by sortOrder. Orphans become roots. */
export function buildTree<T extends TreeItem>(items: T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const item of items) byId.set(item.id, { ...item, children: [] });
  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** True when `candidateId` is `ancestorId` itself or one of its descendants. */
export function isSelfOrDescendant(
  items: TreeItem[],
  ancestorId: string,
  candidateId: string | null,
): boolean {
  const parentOf = new Map(items.map((i) => [i.id, i.parentId]));
  let current: string | null | undefined = candidateId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}

/** Returns ids of all descendants of `rootId` (excluding itself). */
export function descendantIds(items: TreeItem[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const i of items) {
    if (!i.parentId) continue;
    const list = childrenOf.get(i.parentId) ?? [];
    list.push(i.id);
    childrenOf.set(i.parentId, list);
  }
  const result: string[] = [];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    result.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}
