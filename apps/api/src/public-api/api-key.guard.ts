import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { API_KEY_HEADER, type ApiScope } from '@processhub/shared';
import { API_SCOPE_KEY } from '../common/decorators';
import { AppException } from '../common/app-exception';
import { ApiKeysService, type ApiKeyPrincipal } from './api-keys.service';

export type ApiRequest = Request & { apiKey?: ApiKeyPrincipal; apiKeyId?: string };

/** The key from `X-API-Key: <key>` or `Authorization: Bearer <key>` (never from the query string). */
export function keyFromHeaders(req: Request): string | undefined {
  const header = req.headers[API_KEY_HEADER];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '');
  return undefined;
}

/**
 * Authenticates public API routes (`@RequireApiScope`): valid, active, not expired key of an
 * active owner, allowed address, per-key rate limit, then the route's scope. Other routes pass.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ApiScope | null | undefined>(API_SCOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (scope === undefined) return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = await this.keys.authenticate(keyFromHeaders(req), req.ip ?? null, (id) => {
      req.apiKeyId = id;
    });
    const rate = this.keys.hit(key);
    res.setHeader('X-RateLimit-Limit', String(key.rateLimitPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    res.setHeader('X-RateLimit-Reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.resetSeconds));
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many requests for this API key',
      );
    }
    if (scope !== null && !key.scopes.has(scope)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'API_SCOPE_MISSING',
        `This API key lacks the scope ${scope}`,
        { scope },
      );
    }
    req.apiKey = key;
    return true;
  }
}
