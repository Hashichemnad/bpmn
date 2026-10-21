export interface LockoutState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface LockoutPolicy {
  maxAttempts: number;
  lockoutMinutes: number;
}

export function isLocked(state: LockoutState, now: Date = new Date()): boolean {
  return !!state.lockedUntil && state.lockedUntil.getTime() > now.getTime();
}

/** Computes the next lockout state after a failed login attempt. */
export function registerFailure(
  state: LockoutState,
  policy: LockoutPolicy,
  now: Date = new Date(),
): LockoutState & { justLocked: boolean } {
  // An expired lock starts a fresh counting window.
  const base = state.lockedUntil && !isLocked(state, now) ? 0 : state.failedLoginCount;
  const count = base + 1;
  if (count >= policy.maxAttempts) {
    return {
      failedLoginCount: 0,
      lockedUntil: new Date(now.getTime() + policy.lockoutMinutes * 60_000),
      justLocked: true,
    };
  }
  return { failedLoginCount: count, lockedUntil: null, justLocked: false };
}
