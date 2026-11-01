import type { NextFunction, Response } from 'express';
import type { ApiKeysService } from './api-keys.service';
import type { ApiRequest } from './api-key.guard';

export const PUBLIC_API_PREFIX = '/api/public/v1';

/**
 * Call log of the public API: every call of a known key (also refused ones: revoked, expired,
 * wrong address, rate limit, missing scope) with route template, status and duration. Query
 * strings and ids are never stored.
 */
export function apiUsageMiddleware(keys: ApiKeysService) {
  return (req: ApiRequest, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const keyId = req.apiKey?.id ?? req.apiKeyId;
      if (!keyId) return;
      const route = (req.route as { path?: string } | undefined)?.path;
      const path = route ? route.replace(PUBLIC_API_PREFIX, '') || '/' : '(unknown route)';
      keys.record({
        keyId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        ip: req.ip ?? null,
      });
    });
    next();
  };
}
