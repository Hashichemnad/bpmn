import type { Paginated, PaginationQuery } from '@processhub/shared';

export function pageArgs(q: Pick<PaginationQuery, 'page' | 'pageSize'>) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

/** Picks a safe orderBy: only whitelisted fields are accepted. */
export function orderBy<T extends string>(
  q: Pick<PaginationQuery, 'sort' | 'order'>,
  allowed: readonly T[],
  fallback: T,
): Record<string, 'asc' | 'desc'> {
  const field = (allowed as readonly string[]).includes(q.sort ?? '') ? q.sort! : fallback;
  return { [field]: q.order };
}

export function paginated<T>(items: T[], total: number, q: PaginationQuery): Paginated<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
