import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  CSRF_COOKIE,
  REFRESH_COOKIE,
  changePasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaConfirmSchema,
  mfaSetupSchema,
  mfaVerifySchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type CurrentUser as CurrentUserDto,
  type LoginInput,
  type LoginResponseDto,
  type MfaCodeInput,
  type MfaConfirmInput,
  type MfaSetupInput,
  type MfaVerifyInput,
  type UpdateProfileInput,
} from '@processhub/shared';
import { APP_CONFIG, type AppConfig, getConfig } from '../config/config';
import { Authenticated, CurrentUser, Public, ReqMeta } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, toCurrentUser, type IssuedTokens } from './auth.service';
import {
  MFA_COOKIE,
  clearAuthCookies,
  clearMfaCookie,
  setAuthCookies,
  setCsrfCookie,
  setMfaCookie,
} from './cookies';
import { MfaService } from './mfa.service';

const loginLimit = () => ({
  default: {
    limit: getConfig().LOGIN_RATE_LIMIT_MAX,
    ttl: getConfig().RATE_LIMIT_TTL_SECONDS * 1000,
  },
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Issues (or returns) the CSRF token the client must echo in the X-CSRF-Token header. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const csrfToken =
      typeof existing === 'string' && existing.length >= 32
        ? existing
        : setCsrfCookie(res, this.config);
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
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(body, meta);
    if ('mfa' in result) {
      setMfaCookie(res, result.challenge, this.config);
      return { mfa: result.mfa };
    }
    return this.signedIn(res, result);
  }

  /** Second step of password sign-in: authenticator code or recovery code. */
  @Post('login/mfa')
  @Public()
  @HttpCode(200)
  @Throttle(loginLimit())
  async loginMfa(
    @Req() req: Request,
    @Body(new ZodPipe(mfaVerifySchema)) body: MfaVerifyInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.loginMfa(mfaChallenge(req), body, meta);
    clearMfaCookie(res, this.config);
    return this.signedIn(res, result);
  }

  /** 2FA is required for the user's role: enrolment during sign-in (secret + QR code URI). */
  @Post('login/mfa/setup')
  @Public()
  @HttpCode(200)
  @Throttle(loginLimit())
  loginMfaSetup(@Req() req: Request, @ReqMeta() meta: RequestMeta) {
    return this.auth.loginMfaSetup(mfaChallenge(req), meta);
  }

  @Post('login/mfa/setup/confirm')
  @Public()
  @HttpCode(200)
  @Throttle(loginLimit())
  async loginMfaSetupConfirm(
    @Req() req: Request,
    @Body(new ZodPipe(mfaCodeSchema)) body: MfaCodeInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { recoveryCodes, ...result } = await this.auth.loginMfaSetupConfirm(
      mfaChallenge(req),
      body.code,
      meta,
    );
    clearMfaCookie(res, this.config);
    return { ...this.signedIn(res, result), recoveryCodes };
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
      const tokens = await this.auth.refresh(
        req.cookies?.[REFRESH_COOKIE] as string | undefined,
        meta,
      );
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

  /** Ends all of the user's sessions on every device, including this one (SEC-38). */
  @Post('sessions/revoke-all')
  @Authenticated()
  @HttpCode(204)
  async logoutEverywhere(
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logoutEverywhere(user, meta);
    clearAuthCookies(res, this.config);
  }

  @Get('mfa')
  @Authenticated()
  mfaStatus(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user);
  }

  /** Starts enrolment (password re-entered); 2FA is on only after `mfa/enable` with a code. */
  @Post('mfa/setup')
  @Authenticated()
  @HttpCode(200)
  @Throttle(loginLimit())
  mfaSetup(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaSetupSchema)) body: MfaSetupInput) {
    return this.mfa.setup(user, body.password);
  }

  @Post('mfa/enable')
  @Authenticated()
  @HttpCode(200)
  @Throttle(loginLimit())
  mfaEnable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(mfaCodeSchema)) body: MfaCodeInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.mfa.confirmSetup(user.id, body.code, meta);
  }

  @Post('mfa/disable')
  @Authenticated()
  @HttpCode(204)
  @Throttle(loginLimit())
  async mfaDisable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(mfaConfirmSchema)) body: MfaConfirmInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.mfa.disable(user, body, meta);
  }

  @Post('mfa/recovery-codes')
  @Authenticated()
  @HttpCode(200)
  @Throttle(loginLimit())
  mfaRecoveryCodes(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(mfaConfirmSchema)) body: MfaConfirmInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.mfa.regenerateRecoveryCodes(user, body, meta);
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

  /** Sets the session cookies and rotates the CSRF token (privilege change). */
  private signedIn(res: Response, result: { user: CurrentUserDto } & IssuedTokens) {
    const { user, ...tokens } = result;
    setAuthCookies(res, tokens, this.config);
    setCsrfCookie(res, this.config);
    return { user };
  }
}

function mfaChallenge(req: Request): string | undefined {
  const value: unknown = req.cookies?.[MFA_COOKIE];
  return typeof value === 'string' ? value : undefined;
}
