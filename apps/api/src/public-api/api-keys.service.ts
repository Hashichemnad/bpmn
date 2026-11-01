import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type ApiKey } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import {
  API_KEY_DEFAULT_DAYS,
  API_KEY_PATTERN,
  API_SCOPES,
  DEFAULT_API_SETTINGS,
  SETTING_KEYS,
  apiSettingsSchema,
  type ApiKeyCreateInput,
  type ApiKeyDto,
  type ApiKeySecretDto,
  type ApiKeyStatus,
  type ApiKeyUpdateInput,
  type ApiKeyUsageDto,
  type ApiScope,
  type ApiSettings,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AppException, badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { startPeriodic, type Periodic } from '../common/periodic';

/** What a public API request knows about its key (attached as `req.apiKey`). */
export interface ApiKeyPrincipal {
  id: string;
  name: string;
  scopes: Set<ApiScope>;
  content: 'PUBLISHED' | 'WORKSPACE';
  /** Empty: every department. */
  departmentIds: string[];
  rateLimitPerMinute: number;
}

export interface UsageRecord {
  keyId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
}

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DAY_MS = 86_400_000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** 12 random characters [A-Za-z0-9] (rejection sampling, no modulo bias). */
function randomId(length = 12): string {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += ALPHANUM[b % 62];
    }
  }
  return out;
}

/** A new key: `phk_<id>_<secret>` with 256 bits of secret. */
export function generateApiKey(): { prefix: string; secret: string; hash: string } {
  const prefix = randomId();
  const secret = `phk_${prefix}_${randomBytes(32).toString('base64url')}`;
  return { prefix, secret, hash: sha256(secret) };
}

/** Whether an address matches an allow-list of IP addresses / CIDR ranges (empty list: any). */
export function ipAllowed(ip: string | null | undefined, list: string[]): boolean {
  if (!list.length) return true;
  if (!ip) return false;
  const bare = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  const family = isIP(bare);
  if (!family) return false;
  const block = new BlockList();
  for (const entry of list) {
    const [addr, prefix] = entry.split('/');
    const f = isIP(addr);
    if (!f) continue;
    const type = f === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) block.addAddress(addr, type);
    else block.addSubnet(addr, Number(prefix), type);
  }
  return block.check(bare, family === 4 ? 'ipv4' : 'ipv6');
}

export const keyStatus = (
  k: Pick<ApiKey, 'revokedAt' | 'expiresAt'>,
  now = new Date(),
): ApiKeyStatus => (k.revokedAt ? 'REVOKED' : k.expiresAt <= now ? 'EXPIRED' : 'ACTIVE');

const apiError = (status: HttpStatus, code: string, message: string) =>
  new AppException(status, code, message);

/**
 * API keys of the public REST API (Phase 4.4, D-173): create / rotate / revoke (Super Admin),
 * authentication of incoming calls, per-key rate limit and the call log.
 */
@Injectable()
export class ApiKeysService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeysService.name);
  /** Fixed one-minute windows per key (single API instance; Redis in BACKLOG). */
  private readonly windows = new Map<string, { start: number; count: number }>();
  private buffer: UsageRecord[] = [];
  private lastUse = new Map<string, { at: Date; ip: string | null }>();
  private flushTimer?: NodeJS.Timeout;
  private purge?: Periodic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.flushTimer = setInterval(() => void this.flush(), 2000);
    this.flushTimer.unref();
    const minutes = this.config.SCHEDULER_INTERVAL_MINUTES;
    if (minutes && this.config.NODE_ENV !== 'test') {
      this.purge = startPeriodic(
        'API call log retention',
        () => this.purgeUsage(),
        120_000,
        Math.max(minutes, 60) * 60_000,
        this.logger,
      );
    }
  }

  async onModuleDestroy() {
    clearInterval(this.flushTimer);
    this.purge?.stop();
    await this.flush();
  }

  // ---------- Settings ----------

  async settings(): Promise<ApiSettings> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.INTEGRATIONS_API },
    });
    const parsed = apiSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_API_SETTINGS;
  }

  async updateSettings(input: ApiSettings, actor: AuthUser, meta: RequestMeta) {
    const before = await this.settings();
    const value = input as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.INTEGRATIONS_API },
        create: { key: SETTING_KEYS.INTEGRATIONS_API, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.INTEGRATIONS_API,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.settings();
  }

  // ---------- Management ----------

  async list(): Promise<ApiKeyDto[]> {
    const keys = await this.prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return this.toDtos(keys);
  }

  async get(id: string): Promise<ApiKeyDto> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw notFound('API key');
    return (await this.toDtos([key]))[0];
  }

  async create(
    input: ApiKeyCreateInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<ApiKeySecretDto> {
    await this.checkRefs(input.ownerId, input.departmentIds);
    const expiresAt = await this.expiry(input.expiresAt);
    const gen = generateApiKey();
    const key = await this.prisma.$transaction(async (tx) => {
      const k = await tx.apiKey.create({
        data: {
          name: input.name,
          description: input.description,
          prefix: gen.prefix,
          secretHash: gen.hash,
          ownerId: input.ownerId,
          scopes: [...new Set(input.scopes)],
          content: input.content,
          departmentIds: [...new Set(input.departmentIds)],
          ipAllowList: [...new Set(input.ipAllowList)],
          rateLimitPerMinute: input.rateLimitPerMinute,
          expiresAt,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'ApiKey',
          entityId: k.id,
          userId: actor.id,
          summary: { after: this.auditView(k) },
          meta,
        },
        tx,
      );
      return k;
    });
    return { key: (await this.toDtos([key]))[0], secret: gen.secret };
  }

  async update(
    id: string,
    input: ApiKeyUpdateInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<ApiKeyDto> {
    const before = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!before) throw notFound('API key');
    if (before.revokedAt) throw badRequest('API_KEY_REVOKED', 'A revoked key cannot be changed');
    await this.checkRefs(input.ownerId, input.departmentIds);
    const data: Prisma.ApiKeyUpdateInput = { updatedById: actor.id };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.ownerId !== undefined) data.ownerId = input.ownerId;
    if (input.scopes !== undefined) data.scopes = [...new Set(input.scopes)];
    if (input.content !== undefined) data.content = input.content;
    if (input.departmentIds !== undefined) data.departmentIds = [...new Set(input.departmentIds)];
    if (input.ipAllowList !== undefined) data.ipAllowList = [...new Set(input.ipAllowList)];
    if (input.rateLimitPerMinute !== undefined) data.rateLimitPerMinute = input.rateLimitPerMinute;
    if (input.expiresAt !== undefined) data.expiresAt = await this.expiry(input.expiresAt);
    const after = await this.prisma.$transaction(async (tx) => {
      const k = await tx.apiKey.update({ where: { id }, data });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'ApiKey',
          entityId: id,
          userId: actor.id,
          summary: { before: this.auditView(before), after: this.auditView(k) },
          meta,
        },
        tx,
      );
      return k;
    });
    return (await this.toDtos([after]))[0];
  }

  /** New secret (and id); the old key stops working at once. */
  async rotate(id: string, actor: AuthUser, meta: RequestMeta): Promise<ApiKeySecretDto> {
    const before = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!before) throw notFound('API key');
    if (before.revokedAt) throw badRequest('API_KEY_REVOKED', 'A revoked key cannot be rotated');
    const gen = generateApiKey();
    const key = await this.prisma.$transaction(async (tx) => {
      const k = await tx.apiKey.update({
        where: { id },
        data: {
          prefix: gen.prefix,
          secretHash: gen.hash,
          rotatedAt: new Date(),
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'ROTATE',
          entityType: 'ApiKey',
          entityId: id,
          userId: actor.id,
          summary: { name: k.name, before: { prefix: before.prefix }, after: { prefix: k.prefix } },
          meta,
        },
        tx,
      );
      return k;
    });
    return { key: (await this.toDtos([key]))[0], secret: gen.secret };
  }

  async revoke(id: string, actor: AuthUser, meta: RequestMeta): Promise<ApiKeyDto> {
    const before = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!before) throw notFound('API key');
    if (before.revokedAt) return (await this.toDtos([before]))[0];
    const key = await this.prisma.$transaction(async (tx) => {
      const k = await tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: actor.id, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'REVOKE',
          entityType: 'ApiKey',
          entityId: id,
          userId: actor.id,
          summary: { name: k.name, prefix: k.prefix },
          meta,
        },
        tx,
      );
      return k;
    });
    return (await this.toDtos([key]))[0];
  }

  async usage(id: string, errorsOnly = false): Promise<ApiKeyUsageDto> {
    await this.get(id);
    await this.flush();
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [days, endpoints, recent] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; calls: bigint; errors: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS calls,
               count(*) FILTER (WHERE status >= 400) AS errors
        FROM "ApiKeyUsage" WHERE "keyId" = ${id}::uuid AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<
        { method: string; path: string; calls: bigint; errors: bigint; avg: number }[]
      >`
        SELECT method, path, count(*) AS calls, count(*) FILTER (WHERE status >= 400) AS errors,
               avg("durationMs")::float AS avg
        FROM "ApiKeyUsage" WHERE "keyId" = ${id}::uuid AND "createdAt" >= ${since}
        GROUP BY method, path ORDER BY calls DESC LIMIT 50`,
      this.prisma.apiKeyUsage.findMany({
        where: { keyId: id, ...(errorsOnly ? { status: { gte: 400 } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      days: days.map((d) => ({
        day: d.day.toISOString().slice(0, 10),
        calls: Number(d.calls),
        errors: Number(d.errors),
      })),
      endpoints: endpoints.map((e) => ({
        method: e.method,
        path: e.path,
        calls: Number(e.calls),
        errors: Number(e.errors),
        avgMs: Math.round(e.avg),
      })),
      recent: recent.map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ---------- Authentication of public API calls ----------

  /**
   * Checks the key of a call. `onKnown` receives the key's id as soon as the secret matched, so
   * refused calls of a real key (revoked, expired, wrong address) still appear in its call log.
   */
  async authenticate(
    raw: string | undefined,
    ip: string | null,
    onKnown?: (keyId: string) => void,
  ): Promise<ApiKeyPrincipal> {
    const token = raw?.trim() ?? '';
    const match = API_KEY_PATTERN.exec(token);
    if (!match) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'API_KEY_INVALID', 'A valid API key is required');
    }
    const key = await this.prisma.apiKey.findUnique({ where: { prefix: match[1] } });
    const given = Buffer.from(sha256(token), 'hex');
    if (!key || !timingSafeEqual(given, Buffer.from(key.secretHash, 'hex'))) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'API_KEY_INVALID', 'A valid API key is required');
    }
    onKnown?.(key.id);
    const fail = apiError;
    if (key.revokedAt)
      throw fail(HttpStatus.UNAUTHORIZED, 'API_KEY_REVOKED', 'This API key was revoked');
    if (key.expiresAt <= new Date())
      throw fail(HttpStatus.UNAUTHORIZED, 'API_KEY_EXPIRED', 'This API key has expired');
    const owner = await this.prisma.user.findUnique({
      where: { id: key.ownerId },
      select: { status: true, deletedAt: true },
    });
    if (!owner || owner.deletedAt || owner.status !== 'ACTIVE') {
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'API_KEY_OWNER_INACTIVE',
        'The owner of this API key is not active',
      );
    }
    if (!ipAllowed(ip, key.ipAllowList)) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'API_KEY_IP_NOT_ALLOWED',
        'Calls from this address are not allowed',
      );
    }
    return {
      id: key.id,
      name: key.name,
      scopes: new Set(
        key.scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s)),
      ),
      content: key.content,
      departmentIds: key.departmentIds,
      rateLimitPerMinute: key.rateLimitPerMinute,
    };
  }

  /** Counts a call in the key's current minute; false when the limit is reached. */
  hit(
    key: ApiKeyPrincipal,
    now = Date.now(),
  ): { allowed: boolean; remaining: number; resetSeconds: number } {
    const start = now - (now % 60_000);
    let w = this.windows.get(key.id);
    if (!w || w.start !== start) {
      w = { start, count: 0 };
      this.windows.set(key.id, w);
    }
    const resetSeconds = Math.ceil((start + 60_000 - now) / 1000);
    if (w.count >= key.rateLimitPerMinute) return { allowed: false, remaining: 0, resetSeconds };
    w.count++;
    if (this.windows.size > 10_000) {
      for (const [id, win] of this.windows) if (win.start !== start) this.windows.delete(id);
    }
    return { allowed: true, remaining: key.rateLimitPerMinute - w.count, resetSeconds };
  }

  /** Queues a call for the log (written in batches every 2 s). */
  record(entry: UsageRecord): void {
    this.buffer.push(entry);
    if (entry.status < 400) this.lastUse.set(entry.keyId, { at: new Date(), ip: entry.ip });
    if (this.buffer.length >= 500) void this.flush();
  }

  async flush(): Promise<void> {
    const batch = this.buffer;
    const uses = this.lastUse;
    this.buffer = [];
    this.lastUse = new Map();
    const rows = batch.map((b) => ({
      keyId: b.keyId,
      method: b.method.slice(0, 10),
      path: b.path.slice(0, 300),
      status: b.status,
      durationMs: Math.max(0, Math.round(b.durationMs)),
      ip: b.ip?.slice(0, 64) ?? null,
    }));
    try {
      if (rows.length) {
        try {
          await this.prisma.apiKeyUsage.createMany({ data: rows });
        } catch {
          // A key deleted in between (foreign key): keep the rows of the keys that still exist.
          const existing = new Set(
            (
              await this.prisma.apiKey.findMany({
                where: { id: { in: [...new Set(rows.map((r) => r.keyId))] } },
                select: { id: true },
              })
            ).map((k) => k.id),
          );
          const kept = rows.filter((r) => existing.has(r.keyId));
          if (kept.length) await this.prisma.apiKeyUsage.createMany({ data: kept });
        }
      }
      for (const [keyId, use] of uses) {
        await this.prisma.apiKey.updateMany({
          where: { id: keyId },
          data: { lastUsedAt: use.at, lastUsedIp: use.ip?.slice(0, 64) ?? null },
        });
      }
    } catch (err) {
      this.logger.warn(`API call log write failed: ${(err as Error).message}`);
    }
  }

  async purgeUsage(): Promise<number> {
    const { usageRetentionDays } = await this.settings();
    const { count } = await this.prisma.apiKeyUsage.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - usageRetentionDays * DAY_MS) } },
    });
    return count;
  }

  // ---------- helpers ----------

  private async expiry(requested: string | undefined): Promise<Date> {
    const { maxKeyDays } = await this.settings();
    const now = Date.now();
    const max = now + maxKeyDays * DAY_MS;
    const value = requested
      ? new Date(requested).getTime()
      : now + Math.min(API_KEY_DEFAULT_DAYS, maxKeyDays) * DAY_MS;
    if (value <= now)
      throw badRequest('API_KEY_EXPIRY_PAST', 'The expiry date must be in the future');
    if (value > max + DAY_MS) {
      throw badRequest('API_KEY_EXPIRY_TOO_LONG', `Keys expire after at most ${maxKeyDays} days`, {
        maxKeyDays,
      });
    }
    return new Date(Math.min(value, max + DAY_MS));
  }

  private async checkRefs(ownerId: string | undefined, departmentIds: string[] | undefined) {
    if (ownerId) {
      const owner = await this.prisma.user.findFirst({
        where: { id: ownerId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!owner) throw badRequest('USER_NOT_FOUND', 'The owner must be an active user');
    }
    if (departmentIds?.length) {
      const n = await this.prisma.department.count({
        where: { id: { in: departmentIds }, deletedAt: null },
      });
      if (n !== new Set(departmentIds).size) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
  }

  private auditView(k: ApiKey) {
    return {
      name: k.name,
      prefix: k.prefix,
      ownerId: k.ownerId,
      scopes: k.scopes,
      content: k.content,
      departmentIds: k.departmentIds,
      ipAllowList: k.ipAllowList,
      rateLimitPerMinute: k.rateLimitPerMinute,
      expiresAt: k.expiresAt.toISOString(),
    };
  }

  private async toDtos(keys: ApiKey[]): Promise<ApiKeyDto[]> {
    const ids = [
      ...new Set(keys.flatMap((k) => [k.ownerId, k.createdById]).filter((v): v is string => !!v)),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameEn: true, nameAr: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const now = new Date();
    return keys.map((k) => {
      const owner = byId.get(k.ownerId) ?? null;
      const creator = k.createdById ? byId.get(k.createdById) : undefined;
      return {
        id: k.id,
        name: k.name,
        description: k.description,
        prefix: `phk_${k.prefix}`,
        owner,
        scopes: k.scopes as ApiScope[],
        content: k.content,
        departmentIds: k.departmentIds,
        ipAllowList: k.ipAllowList,
        rateLimitPerMinute: k.rateLimitPerMinute,
        expiresAt: k.expiresAt.toISOString(),
        revokedAt: k.revokedAt?.toISOString() ?? null,
        rotatedAt: k.rotatedAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        lastUsedIp: k.lastUsedIp,
        status: keyStatus(k, now),
        createdAt: k.createdAt.toISOString(),
        createdBy: creator
          ? { id: creator.id, nameEn: creator.nameEn, nameAr: creator.nameAr }
          : null,
      };
    });
  }
}
