import { isLocked, registerFailure } from './lockout';

const policy = { maxAttempts: 3, lockoutMinutes: 10 };
const now = new Date('2026-01-01T10:00:00Z');

describe('lockout', () => {
  it('counts failures until the limit, then locks', () => {
    let s = { failedLoginCount: 0, lockedUntil: null as Date | null };
    s = registerFailure(s, policy, now);
    expect(s.failedLoginCount).toBe(1);
    s = registerFailure(s, policy, now);
    const locked = registerFailure(s, policy, now);
    expect(locked.justLocked).toBe(true);
    expect(locked.lockedUntil?.toISOString()).toBe('2026-01-01T10:10:00.000Z');
    expect(isLocked(locked, now)).toBe(true);
    expect(isLocked(locked, new Date('2026-01-01T10:11:00Z'))).toBe(false);
  });

  it('starts a fresh window after the lock expires', () => {
    const expired = { failedLoginCount: 0, lockedUntil: new Date('2026-01-01T09:00:00Z') };
    const s = registerFailure(expired, policy, now);
    expect(s).toEqual({ failedLoginCount: 1, lockedUntil: null, justLocked: false });
  });
});
