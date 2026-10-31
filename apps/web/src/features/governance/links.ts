import type { ContentRefDto } from '@processhub/shared';

/** Workspace path of a process, page or diagram. */
export const workspaceLink = (item: Pick<ContentRefDto, 'entityType' | 'entityId' | 'spaceId'>) =>
  item.entityType === 'PROCESS'
    ? `/processes/${item.entityId}`
    : item.entityType === 'DIAGRAM'
      ? `/diagrams/${item.entityId}`
      : `/docs/${item.spaceId}/pages/${item.entityId}`;

/** Portal path of a published process, page or diagram. */
export const portalLink = (item: Pick<ContentRefDto, 'entityType' | 'entityId'>) =>
  item.entityType === 'PROCESS'
    ? `/portal/processes/${item.entityId}`
    : item.entityType === 'DIAGRAM'
      ? `/portal/diagrams/${item.entityId}`
      : `/portal/pages/${item.entityId}`;
