/**
 * Chromium sandbox mode of the renderer (D-180).
 *
 * - `on`: Chromium's own sandbox is required; the renderer does not start a browser without it.
 * - `auto` (default): try the sandbox first; if Chromium cannot start with it (the host blocks the
 *   user namespaces it needs, e.g. Docker without deploy/renderer-seccomp.json or an AppArmor
 *   restriction), fall back to `--no-sandbox` and log a warning. The container hardening applies
 *   either way (non-root, read-only, no capabilities, no network, limits).
 * - `off`: always `--no-sandbox` (accepted risk, docs/SECURITY.md).
 */
export type SandboxMode = 'on' | 'auto' | 'off';

export function parseSandboxMode(raw: string | undefined): SandboxMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'auto';
  if (value === 'on' || value === 'auto' || value === 'off') return value;
  throw new Error(`RENDERER_SANDBOX must be on, auto or off (got "${raw}")`);
}

/** The launch attempts for a mode, in order: `true` = with Chromium's sandbox. */
export function sandboxAttempts(mode: SandboxMode): boolean[] {
  if (mode === 'on') return [true];
  if (mode === 'off') return [false];
  return [true, false];
}

/**
 * Launches with the first attempt that works. `launch(true)` must start Chromium with its sandbox,
 * `launch(false)` with `--no-sandbox`. Returns the result and whether the sandbox is active.
 */
export async function launchWithSandbox<T>(
  mode: SandboxMode,
  launch: (sandbox: boolean) => Promise<T>,
  warn: (message: string) => void = console.warn,
): Promise<{ value: T; sandbox: boolean }> {
  const attempts = sandboxAttempts(mode);
  let lastError: unknown;
  for (const sandbox of attempts) {
    try {
      return { value: await launch(sandbox), sandbox };
    } catch (err) {
      lastError = err;
      if (sandbox && attempts.length > 1) {
        const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
        warn(
          `Chromium could not start with its sandbox (${reason}); continuing with --no-sandbox ` +
            'inside the hardened container. Use deploy/renderer-seccomp.json, or set ' +
            'RENDERER_SANDBOX=off to silence this warning (docs/SECURITY.md).',
        );
      }
    }
  }
  throw lastError;
}
