import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, type Permission } from '@processhub/shared';
import { AppException } from './app-exception';
import type { AuthUser } from './auth-user';
import {
  ANY_PERMISSION_KEY,
  AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from './decorators';
import { AuthUserLoader } from '../auth/auth-user.loader';

type AuthRequest = Request & { user?: AuthUser };

interface AccessPayload {
  sub: string;
  typ: string;
  iat: number;
}

const unauthenticated = () =>
  new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');

/** Verifies the access-token cookie and attaches the user (freshly loaded) to the request. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly loader: AuthUserLoader,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || !token) {
      if (isPublic) return true;
      throw unauthenticated();
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, { algorithms: ['HS256'] });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      const user = await this.loader.load(payload.sub, payload.iat);
      if (!user) throw new Error('user not active');
      req.user = user;
    } catch {
      if (!isPublic) throw unauthenticated();
    }
    return true;
  }
}

/**
 * Deny-by-default authorisation: every non-public route must declare
 * @RequirePermissions, @RequireAnyPermission or @Authenticated.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
    if (!user) throw unauthenticated();

    const all = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const any = this.reflector.getAllAndOverride<Permission[] | undefined>(
      ANY_PERMISSION_KEY,
      targets,
    );
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets);

    if (all) return all.every((p) => user.permissions.has(p)) || this.deny();
    if (any) return any.some((p) => user.permissions.has(p)) || this.deny();
    if (authenticatedOnly) return true;
    return this.deny();
  }

  private deny(): never {
    throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Insufficient permissions');
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit-cookie CSRF protection for every state-changing request. */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER];
    if (typeof cookie !== 'string' || typeof header !== 'string' || !safeEqual(cookie, header)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'CSRF_INVALID', 'Invalid CSRF token');
    }
    return true;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
