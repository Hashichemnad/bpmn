import type { ContentRefDto } from '@processhub/shared';

/** Workspace path of a process or page. */
export const workspaceLink = (item: Pick<ContentRefDto, 'entityType' | 'entityId' | 'spaceId'>) =>
  item.entityType === 'PROCESS'
    ? `/processes/${item.entityId}`
    : `/docs/${item.spaceId}/pages/${item.entityId}`;
