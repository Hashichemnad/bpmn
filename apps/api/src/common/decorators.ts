import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiScope, Permission } from '@processhub/shared';
import type { AuthUser, RequestMeta } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSION_KEY = 'anyPermission';
export const AUTHENTICATED_KEY = 'authenticated';
export const API_SCOPE_KEY = 'apiScope';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** User must hold ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** User must hold AT LEAST ONE of the listed permissions (finer checks happen in the service). */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

/**
 * Public API route (`/api/public/v1`, Phase 4.4): authenticated with an API key that carries this
 * scope — never with the session cookie. `null`: any valid key (key information).
 */
export const RequireApiScope = (scope: ApiScope | null) => SetMetadata(API_SCOPE_KEY, scope);

/** Any signed-in user (e.g. own profile). Routes must opt in explicitly: deny by default. */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);

export const ReqMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMeta => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ua = req.headers['user-agent'];
    return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null };
  },
);
