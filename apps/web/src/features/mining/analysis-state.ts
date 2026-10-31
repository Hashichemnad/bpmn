import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MiningFilter } from '@processhub/shared';

/**
 * Analysis state of one log page, shared by the map, variants, statistics and bottlenecks tabs:
 * the filter stack, the activity slider (server side) and a variant highlighted on the map.
 */
export interface AnalysisState {
  filters: MiningFilter[];
  setFilters: (f: MiningFilter[]) => void;
  activityLevel: number;
  setActivityLevel: (v: number) => void;
  highlight: string[] | null;
  setHighlight: (acts: string[] | null) => void;
}

const Ctx = createContext<AnalysisState | null>(null);

export function AnalysisStateProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<MiningFilter[]>([]);
  const [activityLevel, setActivityLevel] = useState(1);
  const [highlight, setHighlight] = useState<string[] | null>(null);
  const value = useMemo(
    () => ({ filters, setFilters, activityLevel, setActivityLevel, highlight, setHighlight }),
    [filters, activityLevel, highlight],
  );
  return createElement(Ctx.Provider, { value }, children);
}

export function useAnalysisState(): AnalysisState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AnalysisStateProvider missing');
  return v;
}
