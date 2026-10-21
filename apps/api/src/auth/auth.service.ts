import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  ChangePasswordInput,
  CurrentUser,
  LoginInput,
  UpdateProfileInput,
} from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException, badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { PasswordService } from './password.service';
import { AuthUserLoader } from './auth-user.loader';
import { isLocked, registerFailure } from './lockout';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const invalidCredentials = () =>
  new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');
const invalidSession = () =>
  new AppException(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'Session expired');

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
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<{ user: CurrentUser } & IssuedTokens> {
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

    const valid = await this.passwords.verify(user.passwordHash, input.password);
    if (!valid || user.status !== 'ACTIVE') {
      if (!valid) {
        const next = registerFailure(user, {
          maxAttempts: this.config.LOGIN_MAX_ATTEMPTS,
          lockoutMinutes: this.config.LOGIN_LOCKOUT_MINUTES,
        });
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: next.failedLoginCount, lockedUntil: next.lockedUntil },
        });
        if (next.justLocked) {
          await this.audit.log({
            action: 'LOCKOUT',
            entityType: 'User',
            entityId: user.id,
            userId: user.id,
            summary: { lockedUntil: next.lockedUntil },
            meta,
          });
        }
      }
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log({
      action: 'LOGIN',
      entityType: 'Auth',
      entityId: user.id,
      userId: user.id,
      meta,
    });
    const authUser = await this.loader.load(user.id);
    if (!authUser) throw invalidCredentials();
    const tokens = await this.issueTokens(user.id, randomUUID(), meta);
    return { user: toCurrentUser(authUser), ...tokens };
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
    const user = await this.loader.load(record.userId);
    if (!user) throw invalidSession();

    // Atomic claim: only one concurrent request can rotate a given token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalidSession();
    return this.issueTokens(record.userId, record.familyId, meta);
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
      await this.audit.log({ action: 'LOGOUT', entityType: 'Auth', entityId: userId, userId, meta });
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
    return this.issueTokens(user.id, randomUUID(), meta);
  }

  private async issueTokens(
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: 'access' },
      { expiresIn: this.config.JWT_ACCESS_TTL_SECONDS, algorithm: 'HS256' },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }
}
