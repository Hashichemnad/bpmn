import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  ChangePasswordInput,
  CurrentUser,
  LoginInput,
  LoginMfaStep,
  MfaSetupDto,
  MfaVerifyInput,
  UpdateProfileInput,
} from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException, badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { PasswordService } from './password.service';
import { AuthUserLoader } from './auth-user.loader';
import { isLocked } from './lockout';
import { AuthSettingsService } from './auth-settings.service';
import { MfaService } from './mfa.service';

export interface IssuedTokens {
  accessToken: string;
  /** Access-token lifetime in seconds (shorter than the configured one near the session limit). */
  accessTtlSeconds: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const invalidCredentials = () =>
  new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');
const invalidSession = () =>
  new AppException(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'Session expired');
const challengeExpired = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    'MFA_CHALLENGE_EXPIRED',
    'Sign in again with your password',
  );

/** Lifetime of the "password was correct, second factor pending" challenge. */
export const MFA_CHALLENGE_TTL_SECONDS = 300;

interface MfaChallengePayload {
  sub: string;
  typ: 'mfa';
  step: LoginMfaStep;
}

/** Result of the password step: signed in, or a second step is needed (challenge token). */
export type LoginResult =
  ({ user: CurrentUser } & IssuedTokens) | { mfa: LoginMfaStep; challenge: string };

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function toCurrentUser(u: AuthUser): CurrentUser {
  return {
    id: u.id,
    email: u.email,
    nameEn: u.nameEn,
    nameAr: u.nameAr,
    locale: u.locale,
    departmentId: u.departmentId,
    roles: u.roles,
    permissions: [...u.permissions].sort(),
    hasPassword: u.hasPassword,
    ssoLinked: u.ssoLinked,
    mfaEnabled: u.mfaEnabled,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly loader: AuthUserLoader,
    private readonly authSettings: AuthSettingsService,
    private readonly mfa: MfaService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
    });
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        summary: { email: input.email, reason: 'UNKNOWN_USER' },
        meta,
      });
      throw invalidCredentials();
    }
    if (isLocked(user)) {
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        entityId: user.id,
        userId: user.id,
        summary: { reason: 'LOCKED' },
        meta,
      });
      throw new AppException(HttpStatus.UNAUTHORIZED, 'ACCOUNT_LOCKED', 'Account is locked', {
        lockedUntil: user.lockedUntil,
      });
    }

    // The attempt is counted before the (slow) password check, atomically: parallel requests cannot
    // all read the same counter and so exceed the lockout limit (SEC-36).
    if (!(await this.reserveAttempt(user.id, meta))) throw this.lockedError(user.id, meta);
    const valid = await this.passwords.verify(user.passwordHash, input.password);
    // A correct password gives its reservation back; the counter is reset only after every factor.
    if (valid) await this.releaseAttempt(user.id);
    if (!valid || user.status !== 'ACTIVE') {
      if (!valid) await this.lockIfExhausted(user.id, meta);
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        entityId: user.id,
        userId: user.id,
        summary: { reason: valid ? 'INACTIVE' : 'BAD_PASSWORD' },
        meta,
      });
      throw invalidCredentials();
    }

    // Checked after the password so the answer does not reveal the break-glass account.
    if (!this.authSettings.localLoginAllowed(await this.authSettings.get(), user.id)) {
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        entityId: user.id,
        userId: user.id,
        summary: { reason: 'LOCAL_LOGIN_DISABLED' },
        meta,
      });
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'LOCAL_LOGIN_DISABLED',
        'Password sign-in is turned off; use single sign-on',
      );
    }

    const authUser = await this.loader.load(user.id);
    if (!authUser) throw invalidCredentials();
    // The failure counter is only reset once every factor is correct (no endless code guessing).
    if (user.totpEnabledAt) return this.challenge(user.id, 'VERIFY');
    if (await this.mfa.isRequired(authUser)) return this.challenge(user.id, 'SETUP');
    return this.completeLogin(user.id, meta, { method: 'PASSWORD' });
  }

  /** Second step: TOTP or recovery code after a correct password. */
  async loginMfa(challenge: string | undefined, input: MfaVerifyInput, meta: RequestMeta) {
    const user = await this.challengedUser(challenge, 'VERIFY', meta);
    let method: 'TOTP' | 'RECOVERY_CODE';
    if (!(await this.reserveAttempt(user.id, meta))) throw this.lockedError(user.id, meta);
    try {
      method = await this.mfa.verifyLogin(user, input);
    } catch (err) {
      await this.registerMfaFailure(user, meta);
      throw err;
    }
    return this.completeLogin(user.id, meta, { method: 'PASSWORD', mfa: method });
  }

  /** 2FA is required for the user's role but not set up yet: start enrolment during sign-in. */
  async loginMfaSetup(challenge: string | undefined, meta: RequestMeta): Promise<MfaSetupDto> {
    const user = await this.challengedUser(challenge, 'SETUP', meta);
    // Enrolment during sign-in only while 2FA is still off (SEC-38): a SETUP challenge kept from
    // before cannot replace a secret the user has set up in the meantime.
    if (user.totpEnabledAt) throw challengeExpired();
    return this.mfa.startSetup(user);
  }

  async loginMfaSetupConfirm(challenge: string | undefined, code: string, meta: RequestMeta) {
    const user = await this.challengedUser(challenge, 'SETUP', meta);
    if (user.totpEnabledAt) throw challengeExpired();
    if (!(await this.reserveAttempt(user.id, meta))) throw this.lockedError(user.id, meta);
    let recoveryCodes: string[];
    try {
      ({ recoveryCodes } = await this.mfa.confirmSetup(user.id, code, meta));
    } catch (err) {
      if (err instanceof AppException && err.code === 'MFA_CODE_INVALID') {
        await this.registerMfaFailure(user, meta);
      } else await this.releaseAttempt(user.id);
      throw err;
    }
    const result = await this.completeLogin(user.id, meta, { method: 'PASSWORD', mfa: 'TOTP' });
    return { ...result, recoveryCodes };
  }

  /** Every sign-in method ends here: counters reset, LOGIN audited, tokens issued. */
  async completeLogin(
    userId: string,
    meta: RequestMeta,
    summary: Record<string, unknown>,
  ): Promise<{ user: CurrentUser } & IssuedTokens> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log({
      action: 'LOGIN',
      entityType: 'Auth',
      entityId: userId,
      userId,
      summary,
      meta,
    });
    const authUser = await this.loader.load(userId);
    if (!authUser) throw invalidCredentials();
    const tokens = await this.issueTokens(userId, randomUUID(), meta, new Date());
    return { user: toCurrentUser(authUser), ...tokens };
  }

  private async challenge(userId: string, step: LoginMfaStep): Promise<LoginResult> {
    const challenge = await this.jwt.signAsync(
      { sub: userId, typ: 'mfa', step } satisfies MfaChallengePayload,
      { expiresIn: MFA_CHALLENGE_TTL_SECONDS, algorithm: 'HS256' },
    );
    return { mfa: step, challenge };
  }

  /** The user behind a valid challenge of the given kind (still active, not locked). */
  private async challengedUser(token: string | undefined, step: LoginMfaStep, meta: RequestMeta) {
    if (!token) throw challengeExpired();
    let payload: MfaChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<MfaChallengePayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw challengeExpired();
    }
    if (payload.typ !== 'mfa' || payload.step !== step) throw challengeExpired();
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: 'ACTIVE' },
    });
    if (!user) throw challengeExpired();
    if (isLocked(user)) {
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        entityId: user.id,
        userId: user.id,
        summary: { reason: 'LOCKED' },
        meta,
      });
      throw new AppException(HttpStatus.UNAUTHORIZED, 'ACCOUNT_LOCKED', 'Account is locked', {
        lockedUntil: user.lockedUntil,
      });
    }
    return user;
  }

  /** A wrong second factor counts towards the same lockout as a wrong password. */
  /**
   * Counts one sign-in attempt atomically (SEC-36). False when the account is locked or the attempt
   * exceeds the limit (it is then locked). An expired lock starts a fresh counting window.
   */
  private async reserveAttempt(userId: string, meta: RequestMeta): Promise<boolean> {
    const now = new Date();
    await this.prisma.user.updateMany({
      where: { id: userId, lockedUntil: { lte: now } },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    const u = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true, lockedUntil: true },
    });
    if (isLocked(u, now)) return false;
    if (u.failedLoginCount > this.config.LOGIN_MAX_ATTEMPTS) {
      await this.lockIfExhausted(userId, meta);
      return false;
    }
    return true;
  }

  private async releaseAttempt(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId, failedLoginCount: { gt: 0 } },
      data: { failedLoginCount: { decrement: 1 } },
    });
  }

  /** After a failed attempt: locks the account once the counted attempts reach the limit. */
  private async lockIfExhausted(userId: string, meta: RequestMeta) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + this.config.LOGIN_LOCKOUT_MINUTES * 60_000);
    const res = await this.prisma.user.updateMany({
      where: {
        id: userId,
        failedLoginCount: { gte: this.config.LOGIN_MAX_ATTEMPTS },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: { failedLoginCount: 0, lockedUntil },
    });
    if (res.count)
      await this.audit.log({
        action: 'LOCKOUT',
        entityType: 'User',
        entityId: userId,
        userId,
        summary: { lockedUntil },
        meta,
      });
  }

  private lockedError(userId: string, meta: RequestMeta) {
    void this.audit.log({
      action: 'LOGIN_FAILED',
      entityType: 'Auth',
      entityId: userId,
      userId,
      summary: { reason: 'LOCKED' },
      meta,
    });
    return new AppException(HttpStatus.UNAUTHORIZED, 'ACCOUNT_LOCKED', 'Account is locked');
  }

  private async registerMfaFailure(
    user: { id: string; failedLoginCount: number; lockedUntil: Date | null },
    meta: RequestMeta,
  ) {
    await this.lockIfExhausted(user.id, meta);
    await this.audit.log({
      action: 'LOGIN_FAILED',
      entityType: 'Auth',
      entityId: user.id,
      userId: user.id,
      summary: { reason: 'BAD_MFA_CODE' },
      meta,
    });
  }

  /** Rotates a refresh token. Reuse of an already-rotated token revokes the whole family. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!refreshToken) throw invalidSession();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!record) throw invalidSession();
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalidSession();
    }
    if (record.expiresAt.getTime() <= Date.now()) throw invalidSession();
    // Absolute limit: activity cannot keep a session alive past SESSION_MAX_HOURS after sign-in.
    if (this.sessionEndsAt(record.sessionStartedAt).getTime() <= Date.now()) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalidSession();
    }
    const user = await this.loader.load(record.userId);
    if (!user) throw invalidSession();

    // Atomic claim: only one concurrent request can rotate a given token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalidSession();
    return this.issueTokens(record.userId, record.familyId, meta, record.sessionStartedAt);
  }

  async logout(refreshToken: string | undefined, user: AuthUser | undefined, meta: RequestMeta) {
    let userId = user?.id ?? null;
    if (refreshToken) {
      const record = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
      });
      if (record) {
        userId ??= record.userId;
        await this.prisma.refreshToken.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }
    if (userId) {
      await this.audit.log({
        action: 'LOGOUT',
        entityType: 'Auth',
        entityId: userId,
        userId,
        meta,
      });
    }
  }

  async updateProfile(user: AuthUser, input: UpdateProfileInput, meta: RequestMeta) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { locale: input.locale, nameEn, nameAr, updatedById: user.id },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      summary: {
        profile: true,
        before: { locale: before.locale, nameEn: before.nameEn, nameAr: before.nameAr },
        after: { locale: updated.locale, nameEn: updated.nameEn, nameAr: updated.nameAr },
      },
      meta,
    });
    const fresh = await this.loader.load(user.id);
    return toCurrentUser(fresh!);
  }

  /** Changes the caller's password, revokes all sessions and issues fresh tokens. */
  async changePassword(
    user: AuthUser,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.passwordHash === '') throw badRequest('NO_LOCAL_PASSWORD');
    if (!(await this.passwords.verify(record.passwordHash, input.currentPassword))) {
      throw badRequest('INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }
    if (input.currentPassword === input.newPassword) {
      throw badRequest('PASSWORD_UNCHANGED', 'New password must differ from the current one');
    }
    this.passwords.assertPolicy(input.newPassword);
    const passwordHash = await this.passwords.hash(input.newPassword);
    // Round down to whole seconds so tokens issued right after remain valid (JWT iat is in seconds).
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: changedAt, updatedById: user.id },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'PASSWORD_CHANGE',
          entityType: 'User',
          entityId: user.id,
          userId: user.id,
          meta,
        },
        tx,
      );
    });
    // A new password starts a new session (and a new absolute limit).
    return this.issueTokens(user.id, randomUUID(), meta, new Date());
  }

  /** Absolute end of a session that started at `startedAt` (SESSION_MAX_HOURS, D-165). */
  sessionEndsAt(startedAt: Date): Date {
    return new Date(startedAt.getTime() + this.config.SESSION_MAX_HOURS * 3600 * 1000);
  }

  /**
   * Refresh tokens expire after the idle limit (REFRESH_TOKEN_TTL_HOURS) or at the absolute
   * session limit, whichever comes first; the access token never outlives the session either.
   */
  private async issueTokens(
    userId: string,
    familyId: string,
    meta: RequestMeta,
    sessionStartedAt: Date,
  ): Promise<IssuedTokens> {
    const now = Date.now();
    const sessionEnd = this.sessionEndsAt(sessionStartedAt).getTime();
    const refreshExpiresAt = new Date(
      Math.min(now + this.config.REFRESH_TOKEN_TTL_HOURS * 3600 * 1000, sessionEnd),
    );
    const accessTtlSeconds = Math.max(
      1,
      Math.min(this.config.JWT_ACCESS_TTL_SECONDS, Math.floor((sessionEnd - now) / 1000)),
    );
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: 'access' },
      { expiresIn: accessTtlSeconds, algorithm: 'HS256' },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        sessionStartedAt,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { accessToken, accessTtlSeconds, refreshToken, refreshExpiresAt };
  }
}
