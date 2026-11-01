import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { AppException } from './app-exception';

/**
 * Per-user rate limit for expensive routes (final session part B, SEC-15): mining analyses,
 * simulations, imports, exports, AI and report e-mails. The global throttler counts per IP address
 * — staff behind one company proxy share it — and runs before authentication; this guard runs
 * after it and counts per signed-in user in a sliding window. In memory (one API instance, as the
 * other limits — Redis in BACKLOG before scaling out).
 */
export function UserRateLimit(name: string, perWindow: number, windowMs = 60_000) {
  // USER_RATE_LIMIT_SCALE multiplies every limit (e.g. 10 for a load test, large in the e2e suite).
  const limit = Math.max(
    1,
    Math.round(perWindow * (Number(process.env.USER_RATE_LIMIT_SCALE) || 1)),
  );
  const hits = new Map<string, number[]>();
  let sweepAt = 0;

  @Injectable()
  class UserRateLimitGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<{ user?: AuthUser; ip?: string }>();
      const key = req.user?.id ?? `ip:${req.ip ?? ''}`;
      const now = Date.now();
      if (now > sweepAt) {
        // Drop idle users now and then so the map does not grow without bound.
        for (const [k, list] of hits)
          if (!list.length || list[list.length - 1] < now - windowMs) hits.delete(k);
        sweepAt = now + windowMs;
      }
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_REQUESTS',
          `Too many ${name} requests — wait a moment`,
        );
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    }
  }
  return UserRateLimitGuard;
}
