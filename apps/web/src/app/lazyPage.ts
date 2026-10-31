import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'ph-chunk-reload';

/**
 * A screen loaded on first use (route-based code splitting). When a chunk cannot be loaded —
 * usually because a new version was deployed and the old hashed files are gone — the page reloads
 * once to pick up the new version instead of showing an error.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(
  loader: () => Promise<M>,
  name: K,
) {
  return lazy(async () => {
    try {
      const m = await loader();
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* storage unavailable */
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { default: m[name] as ComponentType<any> };
    } catch (err) {
      let reloaded = true;
      try {
        reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
        if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
      } catch {
        /* storage unavailable: do not loop */
      }
      if (!reloaded) window.location.reload();
      throw err;
    }
  }) as unknown as M[K];
}
