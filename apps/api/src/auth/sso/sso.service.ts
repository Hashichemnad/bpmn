import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as oidc from 'openid-client';
import {
  DEFAULT_LOCALE,
  SETTING_KEYS,
  SSO_CALLBACK_PATH,
  type AuthTestResultDto,
  type AuthSettingsInput,
  type CurrentUser,
  type SsoErrorCode,
  type SystemRoleKey,
} from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { RequestMeta } from '../../common/auth-user';
import { OutboundBlockedError } from '../../common/outbound';
import { SecretBox } from '../../integrations/secret-box';
import { AuthService, type IssuedTokens } from '../auth.service';
import { AuthSettingsService, issuerOf, type StoredAuthSettings } from '../auth-settings.service';
import { OidcClient, type AuthorizationChecks } from './oidc-client';
import {
  domainAllowed,
  idpMfaPerformed,
  identityFromClaims,
  mapGroups,
  safeReturnTo,
  type SsoIdentity,
} from './sso-claims';

/** How long a started sign-in may take at the identity provider. */
export const SSO_FLOW_TTL_SECONDS = 600;

interface FlowState extends AuthorizationChecks {
  returnTo: string;
  exp: number;
}

export class SsoFailure extends Error {
  constructor(
    readonly code: SsoErrorCode,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export type SsoCallbackResult =
  | ({ ok: true; returnTo: string; user: CurrentUser } & IssuedTokens)
  | { ok: false; code: SsoErrorCode };

/** Single sign-on with OpenID Connect: start, callback, just-in-time users, group mapping. */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AuthSettingsService,
    private readonly auth: AuthService,
    private readonly oidc: OidcClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  /** Builds the provider URL; the checks travel in an encrypted cookie (returned as `flow`). */
  async start(returnTo: unknown): Promise<{ url: string; flow: string }> {
    const s = await this.settings.get();
    if (!this.settings.ssoUsable(s) || !this.box) throw new SsoFailure('SSO_DISABLED');
    let url: string;
    const checks = this.oidc.newChecks();
    try {
      const config = await this.oidc.discover(this.clientSettings(s));
      url = await this.oidc.authorizationUrl(config, this.settings.redirectUri, checks);
    } catch (err) {
      this.logger.warn(`SSO discovery failed: ${(err as Error).message}`);
      throw new SsoFailure('SSO_PROVIDER_ERROR');
    }
    const state: FlowState = {
      ...checks,
      returnTo: safeReturnTo(returnTo),
      exp: Date.now() + SSO_FLOW_TTL_SECONDS * 1000,
    };
    return { url, flow: this.box.encrypt(JSON.stringify(state)) };
  }

  /** Handles the redirect back from the provider. Failures are audited and returned as a code. */
  async callback(
    query: Record<string, unknown>,
    flowCookie: string | undefined,
    meta: RequestMeta,
  ): Promise<SsoCallbackResult> {
    try {
      return { ok: true, ...(await this.handleCallback(query, flowCookie, meta)) };
    } catch (err) {
      const failure =
        err instanceof SsoFailure
          ? err
          : new SsoFailure('SSO_PROVIDER_ERROR', { error: 'internal' });
      if (!(err instanceof SsoFailure)) {
        this.logger.error(`SSO callback failed: ${(err as Error).message}`);
      }
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        entityId: (failure.detail?.userId as string | undefined) ?? null,
        userId: (failure.detail?.userId as string | undefined) ?? null,
        summary: { method: 'SSO', reason: failure.code, ...failure.detail },
        meta,
      });
      return { ok: false, code: failure.code };
    }
  }

  private async handleCallback(
    query: Record<string, unknown>,
    flowCookie: string | undefined,
    meta: RequestMeta,
  ) {
    const s = await this.settings.get();
    if (!this.settings.ssoUsable(s)) throw new SsoFailure('SSO_DISABLED');
    const flow = this.readFlow(flowCookie);
    if (!flow || typeof query.state !== 'string' || query.state !== flow.state) {
      throw new SsoFailure('SSO_STATE_INVALID');
    }
    if (typeof query.error === 'string') {
      const cancelled = query.error === 'access_denied';
      throw new SsoFailure(cancelled ? 'SSO_CANCELLED' : 'SSO_PROVIDER_ERROR', {
        error: query.error.slice(0, 100),
      });
    }
    // Rebuilt from APP_URL and the known parameters only (never from the Host header).
    const callbackUrl = new URL(`${this.config.APP_URL}${SSO_CALLBACK_PATH}`);
    for (const key of ['code', 'state', 'iss', 'session_state']) {
      if (typeof query[key] === 'string') callbackUrl.searchParams.set(key, query[key]);
    }
    let claims: Record<string, unknown>;
    try {
      const config = await this.oidc.discover(this.clientSettings(s));
      claims = await this.oidc.exchange(config, callbackUrl, flow);
    } catch (err) {
      throw new SsoFailure('SSO_PROVIDER_ERROR', { error: describe(err) });
    }
    const issuer = issuerOf(s);
    const identity = identityFromClaims(claims, s.provider, s.groupsClaim);
    if (!identity.subject) throw new SsoFailure('SSO_PROVIDER_ERROR', { error: 'no subject' });
    if (!identity.email || identity.emailUnverified) throw new SsoFailure('SSO_EMAIL_MISSING');
    if (!domainAllowed(identity.email, s.allowedDomains)) {
      throw new SsoFailure('SSO_DOMAIN_NOT_ALLOWED', { email: identity.email });
    }
    // Checked before any account is created or linked; the audit entry lists what was sent.
    if (s.requireIdpMfa && !idpMfaPerformed(identity.amr)) {
      throw new SsoFailure('SSO_MFA_REQUIRED', { email: identity.email, amr: identity.amr });
    }
    const userId = await this.provision(s, issuer, identity, meta);
    const result = await this.auth.completeLogin(userId, meta, {
      method: 'SSO',
      issuer,
      ...(identity.amr.length ? { amr: identity.amr } : {}),
      ...(identity.groupsOverage ? { groupsOverage: true } : {}),
    });
    return { ...result, returnTo: flow.returnTo };
  }

  /** Finds, links or creates the user; applies group mappings. Returns the user ID. */
  private async provision(
    s: StoredAuthSettings,
    issuer: string,
    identity: SsoIdentity,
    meta: RequestMeta,
  ): Promise<string> {
    const email = identity.email!;
    const bySubject = await this.prisma.user.findFirst({
      where: { ssoIssuer: issuer, ssoSubject: identity.subject },
      include: { roles: { include: { role: true } } },
    });
    let user =
      bySubject ??
      (await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: { roles: { include: { role: true } } },
      }));

    if (!user) {
      if (!s.autoCreateUsers) throw new SsoFailure('SSO_USER_NOT_FOUND', { email });
      return this.createUser(s, issuer, identity, meta);
    }
    const detail = { userId: user.id };
    if (user.deletedAt || user.status !== 'ACTIVE')
      throw new SsoFailure('SSO_USER_INACTIVE', detail);
    if (!bySubject) {
      // Linked to another identity of the same provider: refuse instead of taking the account over.
      if (user.ssoIssuer === issuer && user.ssoSubject && user.ssoSubject !== identity.subject) {
        throw new SsoFailure('SSO_ACCOUNT_CONFLICT', detail);
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { ssoIssuer: issuer, ssoSubject: identity.subject },
      });
      await this.audit.log({
        action: 'UPDATE',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        summary: { source: 'SSO', ssoLinked: true, issuer },
        meta,
      });
      user = { ...user, ssoIssuer: issuer, ssoSubject: identity.subject };
    }
    if (s.syncRolesOnLogin && s.groupMappings.length && !identity.groupsOverage) {
      await this.syncRoles(s, user, identity, meta);
    }
    return user.id;
  }

  private async createUser(
    s: StoredAuthSettings,
    issuer: string,
    identity: SsoIdentity,
    meta: RequestMeta,
  ): Promise<string> {
    const mapped = identity.groupsOverage
      ? { matched: false, roles: [], departmentId: null }
      : mapGroups(identity.groups, s.groupMappings);
    const roles: SystemRoleKey[] = mapped.roles.length ? mapped.roles : [s.defaultRole];
    const departmentId = mapped.departmentId ?? s.defaultDepartmentId;
    const roleRows = await this.prisma.role.findMany({ where: { key: { in: roles } } });
    const localeRow = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DEFAULT_LOCALE },
    });
    const locale = localeRow?.value === 'ar' ? 'ar' : DEFAULT_LOCALE;
    const department = departmentId
      ? await this.prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } })
      : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: identity.email!,
            nameEn: identity.name || identity.email!,
            nameAr: '',
            passwordHash: '',
            locale,
            departmentId: department?.id ?? null,
            ssoIssuer: issuer,
            ssoSubject: identity.subject,
            roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
          },
        });
        await this.audit.log(
          {
            action: 'CREATE',
            entityType: 'User',
            entityId: user.id,
            userId: user.id,
            summary: {
              source: 'SSO',
              email: user.email,
              roles,
              departmentId: user.departmentId,
              groupsMatched: mapped.matched,
              ...(identity.groupsOverage ? { groupsOverage: true } : {}),
            },
            meta,
          },
          tx,
        );
        return user.id;
      });
    } catch (err) {
      // Two first sign-ins at the same moment: the other request created the user.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new SsoFailure('SSO_ACCOUNT_CONFLICT', { email: identity.email });
      }
      throw err;
    }
  }

  /** Directory groups manage roles (and department when a mapping sets one). */
  private async syncRoles(
    s: StoredAuthSettings,
    user: { id: string; departmentId: string | null; roles: { role: { key: string } }[] },
    identity: SsoIdentity,
    meta: RequestMeta,
  ) {
    const mapped = mapGroups(identity.groups, s.groupMappings);
    const before = user.roles.map((r) => r.role.key as SystemRoleKey).sort();
    let after = (mapped.matched && mapped.roles.length ? mapped.roles : [s.defaultRole]).slice();
    // Never lock the organisation out: the break-glass account and the last Super Admin keep the role.
    if (before.includes('SUPER_ADMIN') && !after.includes('SUPER_ADMIN')) {
      const others = await this.prisma.user.count({
        where: {
          id: { not: user.id },
          deletedAt: null,
          status: 'ACTIVE',
          roles: { some: { role: { key: 'SUPER_ADMIN' } } },
        },
      });
      if (s.breakGlassUserId === user.id || others === 0) after.push('SUPER_ADMIN');
    }
    after = [...new Set(after)].sort();
    const departmentId = mapped.departmentId ?? user.departmentId;
    const rolesChanged = before.join() !== after.join();
    if (!rolesChanged && departmentId === user.departmentId) return;
    const roleRows = await this.prisma.role.findMany({ where: { key: { in: after } } });
    await this.prisma.$transaction(async (tx) => {
      if (rolesChanged) {
        await tx.userRole.deleteMany({ where: { userId: user.id } });
        await tx.userRole.createMany({
          data: roleRows.map((r) => ({ userId: user.id, roleId: r.id })),
        });
      }
      await tx.user.update({ where: { id: user.id }, data: { departmentId } });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'User',
          entityId: user.id,
          userId: user.id,
          summary: {
            source: 'SSO_GROUPS',
            before: { roles: before, departmentId: user.departmentId },
            after: { roles: after, departmentId },
          },
          meta,
        },
        tx,
      );
    });
  }

  /** Settings → Authentication → Test: reads the provider's discovery document. */
  async test(input: AuthSettingsInput): Promise<AuthTestResultDto> {
    const s = this.settings.merge(await this.settings.get(), input);
    const issuer = issuerOf(s);
    if (!issuer || !s.clientId) return { ok: false, errorCode: 'SSO_INCOMPLETE' };
    let secret = '';
    try {
      secret = s.clientSecretSealed ? this.settings.clientSecret(s) : '';
    } catch {
      return { ok: false, errorCode: 'ENCRYPTION_KEY_MISSING' };
    }
    try {
      const config = await this.oidc.discover(
        { issuer, clientId: s.clientId, clientSecret: secret, secretVersion: 'test' },
        true,
      );
      const md = config.serverMetadata();
      return { ok: true, issuer: md.issuer, authorizationEndpoint: md.authorization_endpoint };
    } catch (err) {
      const blocked = err instanceof OutboundBlockedError || hasCause(err, OutboundBlockedError);
      return {
        ok: false,
        errorCode: blocked ? 'SSO_HOST_BLOCKED' : 'SSO_PROVIDER_ERROR',
        message: describe(err),
      };
    }
  }

  private clientSettings(s: StoredAuthSettings) {
    return {
      issuer: issuerOf(s),
      clientId: s.clientId,
      clientSecret: this.settings.clientSecret(s),
      secretVersion: createHash('sha256').update(s.clientSecretSealed!).digest('hex').slice(0, 16),
    };
  }

  private readFlow(cookie: string | undefined): FlowState | null {
    if (!cookie || !this.box) return null;
    try {
      const flow = JSON.parse(this.box.decrypt(cookie)) as FlowState;
      return flow.exp > Date.now() ? flow : null;
    } catch {
      return null;
    }
  }
}

function hasCause(err: unknown, type: new (...args: never[]) => Error): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    if (cur instanceof type) return true;
    cur = (cur as Error).cause;
  }
  return false;
}

/** Short, secret-free description of a provider error for the audit log and the test result. */
function describe(err: unknown): string {
  if (err instanceof oidc.AuthorizationResponseError || err instanceof oidc.ResponseBodyError) {
    return `${err.error}${err.error_description ? `: ${err.error_description}` : ''}`.slice(0, 300);
  }
  const e = err as Error & { code?: string; cause?: unknown };
  const cause = e.cause instanceof Error ? ` (${e.cause.message})` : '';
  return `${e.code ? `${e.code}: ` : ''}${e.message}${cause}`.slice(0, 300);
}
