import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialPanelState, panelReducer, type PanelState } from './panel-state';
import {
  DEFAULT_WORKSPACE_PREFS,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  loadWorkspacePrefs,
  saveWorkspacePrefs,
} from './workspace-prefs';

const run = (state: PanelState, ...actions: Parameters<typeof panelReducer>[1][]) =>
  actions.reduce(panelReducer, state);

describe('modeler side panel state', () => {
  const start = initialPanelState(DEFAULT_WORKSPACE_PREFS);

  it('is closed while nothing is selected and opens on selection', () => {
    expect(start.visible).toBe(false);
    const selected = run(start, { type: 'select', hasSelection: true });
    expect(selected.visible).toBe(true);
    expect(run(selected, { type: 'select', hasSelection: false }).visible).toBe(false);
  });

  it('stays closed on selection after the user closed it, until opened again', () => {
    const closed = run(
      start,
      { type: 'select', hasSelection: true },
      { type: 'toggle' },
      { type: 'select', hasSelection: true },
    );
    expect(closed).toMatchObject({ visible: false, auto: false });
    const reopened = run(closed, { type: 'toggle' }, { type: 'select', hasSelection: false });
    expect(reopened).toMatchObject({ visible: true, auto: true, pinned: true });
  });

  it('stays open when opened from the toolbar and the selection is cleared', () => {
    const shown = run(start, { type: 'show' }, { type: 'select', hasSelection: false });
    expect(shown.visible).toBe(true);
    expect(run(shown, { type: 'close' })).toMatchObject({ visible: false, auto: false });
  });

  it('keeps the width within limits', () => {
    expect(run(start, { type: 'resize', width: 10 }).width).toBe(PANEL_MIN_WIDTH);
    expect(run(start, { type: 'resize', width: 5000 }).width).toBe(PANEL_MAX_WIDTH);
    expect(run(start, { type: 'resize', width: 401.6 }).width).toBe(402);
  });
});

describe('workspace preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('are remembered per user', () => {
    saveWorkspacePrefs('u1', { ...DEFAULT_WORKSPACE_PREFS, panelAuto: false, panelWidth: 420 });
    expect(loadWorkspacePrefs('u1')).toMatchObject({ panelAuto: false, panelWidth: 420 });
    expect(loadWorkspacePrefs('u2')).toEqual(DEFAULT_WORKSPACE_PREFS);
  });

  it('ignore invalid stored values', () => {
    localStorage.setItem(
      'ph.modeler.prefs.u1',
      JSON.stringify({ minimap: 'yes', panelWidth: 99999, grid: false }),
    );
    expect(loadWorkspacePrefs('u1')).toMatchObject({
      minimap: true,
      grid: false,
      panelWidth: PANEL_MAX_WIDTH,
    });
    localStorage.setItem('ph.modeler.prefs.u1', '{not json');
    expect(loadWorkspacePrefs('u1')).toEqual(DEFAULT_WORKSPACE_PREFS);
  });

  it('fall back to the defaults when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveWorkspacePrefs('u1', DEFAULT_WORKSPACE_PREFS)).not.toThrow();
    expect(loadWorkspacePrefs('u1')).toEqual(DEFAULT_WORKSPACE_PREFS);
  });
});
