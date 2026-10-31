import { useMemo } from 'react';
import { epcIssues, type EpcIssue } from '@processhub/shared';
import { exportGraph, type GraphInstance } from '../kit/graph-diagram';

/** EPC syntax warnings of the current diagram (D-124). */
export function useEpcIssues(instance: GraphInstance | null, changeTick: number): EpcIssue[] {
  return useMemo(() => {
    void changeTick;
    return instance ? epcIssues(exportGraph(instance, 'EPC')) : [];
  }, [instance, changeTick]);
}
