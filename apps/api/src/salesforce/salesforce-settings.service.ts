import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_SALESFORCE_MAPPING,
  SETTING_KEYS,
  salesforceSettingsSchema,
  type SalesforceRunDto,
  type SalesforceSettingsDto,
  type SalesforceSettingsInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from '../integrations/secret-box';
import type { SalesforceSecrets } from './salesforce-client';

/** Setting `integrations.salesforce`; secrets only as AES-256-GCM ciphertext (D-114). */
export type StoredSalesforceSettings = Omit<
  SalesforceSettingsInput,
  'clientSecret' | 'privateKey'
> & {
  clientSecretSealed: string | null;
  privateKeySealed: string | null;
  /** Last scheduled run (UTC), so a restart does not run it twice. */
  lastScheduledAt: string | null;
};

const DEFAULTS: StoredSalesforceSettings = {
  ...salesforceSettingsSchema.parse({ mapping: DEFAULT_SALESFORCE_MAPPING }),
  clientSecretSealed: null,
  privateKeySealed: null,
  lastScheduledAt: null,
};

const userRef = { id: true, email: true, nameEn: true, nameAr: true } as const;

@Injectable()
export class SalesforceSettingsService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  async get(): Promise<StoredSalesforceSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.SALESFORCE } });
    const stored = (row?.value ?? {}) as Partial<StoredSalesforceSettings>;
    return {
      ...DEFAULTS,
      ...stored,
      mapping: {
        objectives: { ...DEFAULTS.mapping.objectives, ...stored.mapping?.objectives },
        kpis: { ...DEFAULTS.mapping.kpis, ...stored.mapping?.kpis },
        results: { ...DEFAULTS.mapping.results, ...stored.mapping?.results },
        processMap: { ...DEFAULTS.mapping.processMap, ...stored.mapping?.processMap },
      },
    };
  }

  secrets(s: StoredSalesforceSettings): SalesforceSecrets {
    const open = (v: string | null) => {
      if (!v || !this.box) return null;
      try {
        return this.box.decrypt(v);
      } catch {
        return null;
      }
    };
    return { clientSecret: open(s.clientSecretSealed), privateKey: open(s.privateKeySealed) };
  }

  async lastRun(): Promise<SalesforceRunDto | null> {
    const r = await this.prisma.salesforceSyncRun.findFirst({ orderBy: { startedAt: 'desc' } });
    return r ? (await this.toRunDtos([r]))[0] : null;
  }

  async toRunDtos(
    rows: {
      id: string;
      trigger: string;
      status: string;
      startedAt: Date;
      finishedAt: Date | null;
      counts: unknown;
      warnings: unknown;
      error: string | null;
      userId: string | null;
    }[],
  ): Promise<SalesforceRunDto[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId).filter((v): v is string => !!v) } },
      select: userRef,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      trigger: r.trigger as SalesforceRunDto['trigger'],
      status: r.status as SalesforceRunDto['status'],
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      counts: (r.counts ?? {}) as Record<string, number>,
      error: r.error,
      warnings: Array.isArray(r.warnings) ? r.warnings.length : 0,
      user: (r.userId && byId.get(r.userId)) || null,
    }));
  }

  async toDto(s: StoredSalesforceSettings): Promise<SalesforceSettingsDto> {
    const { clientSecretSealed, privateKeySealed, lastScheduledAt: _l, ...rest } = s;
    return {
      ...rest,
      hasClientSecret: !!clientSecretSealed,
      hasPrivateKey: !!privateKeySealed,
      encryptionReady: !!this.box,
      lastSync: await this.lastRun(),
    };
  }

  async save(
    input: SalesforceSettingsInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<SalesforceSettingsDto> {
    const before = await this.get();
    const seal = (v: string | undefined, current: string | null) => {
      if (v === undefined || v === '') return current;
      if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
      return this.box.encrypt(v);
    };
    const { clientSecret, privateKey, ...rest } = input;
    if (privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey))
      throw badRequest('INVALID_PRIVATE_KEY');
    const next: StoredSalesforceSettings = {
      ...rest,
      clientSecretSealed: seal(clientSecret, before.clientSecretSealed),
      privateKeySealed: seal(privateKey, before.privateKeySealed),
      lastScheduledAt: before.lastScheduledAt,
    };
    if (next.enabled) {
      if (!next.instanceUrl || !next.clientId) throw badRequest('SALESFORCE_INCOMPLETE');
      if (next.authFlow === 'CLIENT_CREDENTIALS' && !next.clientSecretSealed)
        throw badRequest('SALESFORCE_INCOMPLETE');
      if (next.authFlow === 'JWT_BEARER' && (!next.privateKeySealed || !next.username))
        throw badRequest('SALESFORCE_INCOMPLETE');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.SALESFORCE },
        create: {
          key: SETTING_KEYS.SALESFORCE,
          value: next as unknown as Prisma.InputJsonValue,
          updatedById: actor.id,
        },
        update: { value: next as unknown as Prisma.InputJsonValue, updatedById: actor.id },
      });
      // Never the secrets: only whether they changed.
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Integration',
          entityId: 'salesforce',
          userId: actor.id,
          summary: {
            enabled: { from: before.enabled, to: next.enabled },
            instanceUrl: next.instanceUrl,
            authFlow: next.authFlow,
            schedule: next.schedule,
            clientSecretChanged: !!clientSecret,
            privateKeyChanged: !!privateKey,
            mappingChanged: JSON.stringify(before.mapping) !== JSON.stringify(next.mapping),
          },
          meta,
        },
        tx,
      );
    });
    return this.toDto(await this.get());
  }

  async markScheduled(at: Date) {
    const s = await this.get();
    await this.prisma.setting.update({
      where: { key: SETTING_KEYS.SALESFORCE },
      data: {
        value: { ...s, lastScheduledAt: at.toISOString() } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
