import type { Logger } from '@nestjs/common';

/** A started periodic task; `stop` clears its timers (module destroy). */
export interface Periodic {
  stop(): void;
  /** True while a run is in progress (tests). */
  readonly busy: boolean;
}

/**
 * Runs `task` after `firstDelayMs` and then every `intervalMs`, never twice at the same time: a
 * tick that arrives while the previous run is still busy is skipped (and logged), so a slow run on
 * a large repository cannot pile up overlapping runs (final session A). Errors are logged; the
 * next tick runs normally.
 */
export function startPeriodic(
  name: string,
  task: () => Promise<unknown>,
  firstDelayMs: number,
  intervalMs: number,
  logger: Pick<Logger, 'error' | 'warn'>,
): Periodic {
  let busy = false;
  const tick = () => {
    if (busy) {
      logger.warn(`${name}: previous run still in progress, tick skipped`);
      return;
    }
    busy = true;
    void task()
      .catch((e: Error) => logger.error(`${name}: ${e.message}`))
      .finally(() => {
        busy = false;
      });
  };
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, intervalMs);
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
    get busy() {
      return busy;
    },
  };
}
