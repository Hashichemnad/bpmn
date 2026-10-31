import type { PortalItemDto } from '@processhub/shared';

export const portalItemLink = (item: Pick<PortalItemDto, 'type' | 'id'>) =>
  item.type === 'PROCESS'
    ? `/portal/processes/${item.id}`
    : item.type === 'DIAGRAM'
      ? `/portal/diagrams/${item.id}`
      : `/portal/pages/${item.id}`;
