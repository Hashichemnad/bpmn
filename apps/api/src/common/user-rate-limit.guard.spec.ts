import type { ExecutionContext } from '@nestjs/common';
import { UserRateLimit } from './user-rate-limit.guard';

const ctx = (id: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { id }, ip: '10.0.0.1' }) }),
  }) as unknown as ExecutionContext;

describe('UserRateLimit (SEC-15)', () => {
  it('counts per user in a sliding window', () => {
    const scale = process.env.USER_RATE_LIMIT_SCALE;
    delete process.env.USER_RATE_LIMIT_SCALE;
    const Guard = UserRateLimit('test', 2, 60_000);
    const guard = new Guard();
    expect(guard.canActivate(ctx('a'))).toBe(true);
    expect(guard.canActivate(ctx('a'))).toBe(true);
    expect(() => guard.canActivate(ctx('a'))).toThrow(/Too many test requests/);
    // Another user behind the same IP address is not affected.
    expect(guard.canActivate(ctx('b'))).toBe(true);
    process.env.USER_RATE_LIMIT_SCALE = scale;
  });
});
