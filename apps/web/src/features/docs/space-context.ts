import { createContext, useContext } from 'react';
import type { SpaceDto } from '@processhub/shared';

export interface SpaceContextValue {
  space: SpaceDto;
  /** Opens the "new page" dialog, optionally under a parent page. */
  newPage: (parentId?: string | null) => void;
}

export const SpaceContext = createContext<SpaceContextValue | null>(null);

export function useSpaceContext() {
  const ctx = useContext(SpaceContext);
  if (!ctx) throw new Error('useSpaceContext outside SpaceLayout');
  return ctx;
}
