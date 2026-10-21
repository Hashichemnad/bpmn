import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  CSRF_COOKIE,
  REFRESH_COOKIE,
  changePasswordSchema,
  loginSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type LoginInput,
  type UpdateProfileInput,
} from '@processhub/shared';
import { APP_CONFIG, type AppConfig, getConfig } from '../config/config';
import { Authenticated, CurrentUser, Public, ReqMeta } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, toCurrentUser } from './auth.service';
import { clearAuthCookies, setAuthCookies, setCsrfCookie } from './cookies';

const loginLimit = () => ({
  default: { limit: getConfig().LOGIN_RATE_LIMIT_MAX, ttl: getConfig().RATE_LIMIT_TTL_SECONDS * 1000 },
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Issues (or returns) the CSRF token the client must echo in the X-CSRF-Token header. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const csrfToken =
      typeof existing === 'string' && existing.length >= 32 ? existing : setCsrfCookie(res, this.config);
    return { csrfToken };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle(loginLimit())
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, ...tokens } = await this.auth.login(body, meta);
    setAuthCookies(res, tokens, this.config);
    setCsrfCookie(res, this.config); // rotate CSRF token on privilege change
    return { user };
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle(loginLimit())
  async refresh(
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined, meta);
      setAuthCookies(res, tokens, this.config);
      return { ok: true };
    } catch (err) {
      clearAuthCookies(res, this.config);
      throw err;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(
    @Req() req: Request & { user?: AuthUser },
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined, req.user, meta);
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentUser() user: AuthUser) {
    return toCurrentUser(user);
  }

  @Patch('me')
  @Authenticated()
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.updateProfile(user, body, meta);
  }

  @Post('change-password')
  @Authenticated()
  @HttpCode(204)
  @Throttle(loginLimit())
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.changePassword(user, body, meta);
    setAuthCookies(res, tokens, this.config);
  }
}
