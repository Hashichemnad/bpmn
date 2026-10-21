import type { SearchHitDto } from '@processhub/shared';

export const hitLink = (h: SearchHitDto) =>
  h.type === 'page' ? `/docs/${h.space?.id}/pages/${h.id}` : `/processes/${h.id}`;
