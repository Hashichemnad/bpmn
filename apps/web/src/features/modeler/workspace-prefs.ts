import { useCallback, useState } from 'react';

/**
 * Modeler workspace preferences, remembered per user in this browser (localStorage). Storage can
 * be unavailable (private windows, blocked site data): every access is wrapped and the workspace
 * falls back to the defaults.
 */
export interface WorkspacePrefs {
  /** The side panel opens when an element is selected (off after the user closes it). */
  panelAuto: boolean;
  panelWidth: number;
  minimap: boolean;
  badges: boolean;
  grid: boolean;
  /** Palette shows icons only. */
  paletteCollapsed: boolean;
}

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 640;

export const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  panelAuto: true,
  panelWidth: 340,
  minimap: true,
  badges: true,
  grid: true,
  paletteCollapsed: false,
};

export const clampPanelWidth = (w: number) =>
  Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number.isFinite(w) ? w : 340)));

const key = (userId: string | undefined) => `ph.modeler.prefs.${userId ?? 'anonymous'}`;

export function loadWorkspacePrefs(userId: string | undefined): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return { ...DEFAULT_WORKSPACE_PREFS };
    const stored = JSON.parse(raw) as Partial<Record<keyof WorkspacePrefs, unknown>>;
    const prefs = { ...DEFAULT_WORKSPACE_PREFS };
    for (const k of Object.keys(DEFAULT_WORKSPACE_PREFS) as (keyof WorkspacePrefs)[]) {
      const v = stored[k];
      if (typeof v === typeof DEFAULT_WORKSPACE_PREFS[k]) (prefs as Record<string, unknown>)[k] = v;
    }
    prefs.panelWidth = clampPanelWidth(prefs.panelWidth);
    return prefs;
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFS };
  }
}

export function saveWorkspacePrefs(userId: string | undefined, prefs: WorkspacePrefs): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(prefs));
  } catch {
    // Not remembered: storage is unavailable in this browser.
  }
}

/** Preferences of the signed-in user; `update` stores the change at once. */
export function useWorkspacePrefs(userId: string | undefined) {
  const [prefs, setPrefs] = useState(() => loadWorkspacePrefs(userId));
  const update = useCallback(
    (patch: Partial<WorkspacePrefs>) =>
      setPrefs((current) => {
        const next = { ...current, ...patch };
        saveWorkspacePrefs(userId, next);
        return next;
      }),
    [userId],
  );
  return [prefs, update] as const;
}
