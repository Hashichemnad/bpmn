import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, authSettingsSchema, type AuthSettingsInput } from '@processhub/shared';
import { APP_CONFIG, type AppConfig, getConfig } from '../../config/config';
import { Public, ReqMeta, RequirePermissions } from '../../common/decorators';
import type { RequestMeta } from '../../common/auth-user';
import { ZodPipe } from '../../common/zod.pipe';
import { setAuthCookies, setCsrfCookie } from '../cookies';
import { SSO_FLOW_TTL_SECONDS, SsoFailure, SsoService } from './sso.service';

/** Encrypted state / nonce / PKCE verifier of a sign-in in progress. */
const FLOW_COOKIE = 'ph_sso';
const FLOW_COOKIE_PATH = '/api/v1/auth/sso';

const startQuerySchema = z.object({ returnTo: z.string().max(500).optional() });
const param = z.string().max(8000).optional();
const callbackQuerySchema = z.object({
  code: param,
  state: param,
  error: param,
  error_description: param,
  error_uri: param,
  iss: param,
  session_state: param,
});

const loginLimit = () => ({
  default: {
    limit: getConfig().LOGIN_RATE_LIMIT_MAX,
    ttl: getConfig().RATE_LIMIT_TTL_SECONDS * 1000,
  },
});

@ApiTags('auth')
@Controller()
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The login page's "Sign in with …" button navigates here; redirects to the identity provider. */
  @Get('auth/sso/start')
  @Public()
  @Throttle(loginLimit())
  async start(
    @Query(new ZodPipe(startQuerySchema)) query: z.infer<typeof startQuerySchema>,
    @Res() res: Response,
  ) {
    try {
      const { url, flow } = await this.sso.start(query.returnTo);
      res.cookie(FLOW_COOKIE, flow, { ...this.flowCookie(), maxAge: SSO_FLOW_TTL_SECONDS * 1000 });
      res.redirect(302, url);
    } catch (err) {
      if (!(err instanceof SsoFailure)) throw err;
      res.redirect(302, this.loginPage(err.code));
    }
  }

  /** Redirect URI registered at the identity provider. */
  @Get('auth/sso/callback')
  @Public()
  @Throttle(loginLimit())
  async callback(
    @Query(new ZodPipe(callbackQuerySchema)) query: z.infer<typeof callbackQuerySchema>,
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const flow: unknown = req.cookies?.[FLOW_COOKIE];
    const result = await this.sso.callback(
      query,
      typeof flow === 'string' ? flow : undefined,
      meta,
    );
    res.clearCookie(FLOW_COOKIE, this.flowCookie());
    if (!result.ok) {
      res.redirect(302, this.loginPage(result.code));
      return;
    }
    setAuthCookies(res, result, this.config);
    setCsrfCookie(res, this.config);
    res.redirect(302, `${this.config.APP_URL}${result.returnTo}`);
  }

  /** Settings → Authentication → Test connection (reads the discovery document). */
  @Post('settings/auth/test')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  test(@Body(new ZodPipe(authSettingsSchema)) body: AuthSettingsInput) {
    return this.sso.test(body);
  }

  /**
   * Lax, not Strict: the browser must send it on the top-level redirect back from the identity
   * provider (another site). It only holds one-time checks, never a session.
   */
  private flowCookie(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: FLOW_COOKIE_PATH,
    };
  }

  private loginPage(code: string) {
    return `${this.config.APP_URL}/login?ssoError=${encodeURIComponent(code)}`;
  }
}
