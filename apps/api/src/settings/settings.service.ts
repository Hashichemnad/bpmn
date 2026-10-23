import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_LOCALE,
  LOGO_MAX_BYTES,
  resolveDiagramTheme,
  SETTING_KEYS,
  type DiagramThemeInput,
  type Locale,
  type PublicSettingsDto,
  type SettingsDto,
  type UpdateSettingsInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { sanitizeSvg, sniffImageType } from './image-sniff';

interface LogoValue {
  key: string;
  contentType: string;
  version: string;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async values(): Promise<Map<string, unknown>> {
    const rows = await this.prisma.setting.findMany();
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  async getPublic(): Promise<PublicSettingsDto> {
    const v = await this.values();
    const logo = v.get(SETTING_KEYS.LOGO) as LogoValue | undefined;
    const str = (key: string) => (typeof v.get(key) === 'string' ? (v.get(key) as string) : '');
    const locale = v.get(SETTING_KEYS.DEFAULT_LOCALE);
    return {
      orgNameEn: str(SETTING_KEYS.ORG_NAME_EN),
      orgNameAr: str(SETTING_KEYS.ORG_NAME_AR),
      defaultLocale: locale === 'ar' || locale === 'en' ? (locale as Locale) : DEFAULT_LOCALE,
      hasLogo: !!logo,
      logoVersion: logo?.version ?? null,
      diagramTheme: resolveDiagramTheme(v.get(SETTING_KEYS.DIAGRAM_THEME)),
      diagramThemeCustomised: v.has(SETTING_KEYS.DIAGRAM_THEME),
    };
  }

  /** Colour theme of BPMN diagrams (Settings → Branding). */
  async setDiagramTheme(input: DiagramThemeInput, actor: AuthUser, meta: RequestMeta) {
    const key = SETTING_KEYS.DIAGRAM_THEME;
    const before = (await this.getPublic()).diagramTheme;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key },
        create: { key, value: { ...input }, updatedById: actor.id },
        update: { value: { ...input }, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: key,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.getAll();
  }

  /** Back to the shipped default theme. */
  async resetDiagramTheme(actor: AuthUser, meta: RequestMeta) {
    const key = SETTING_KEYS.DIAGRAM_THEME;
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (row) {
      await this.prisma.$transaction(async (tx) => {
        await tx.setting.delete({ where: { key } });
        await this.audit.log(
          {
            action: 'DELETE',
            entityType: 'Setting',
            entityId: key,
            userId: actor.id,
            summary: { before: row.value, after: 'default' },
            meta,
          },
          tx,
        );
      });
    }
    return this.getAll();
  }

  async getAll(): Promise<SettingsDto> {
    const git = (
      await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.GIT_INTEGRATION } })
    )?.value as { enabled?: boolean; provider?: string } | undefined;
    return {
      ...(await this.getPublic()),
      integrations: {
        git: {
          enabled: !!git?.enabled,
          provider: git?.provider === 'gitlab' ? 'gitlab' : 'github',
        },
      },
    };
  }

  async update(input: UpdateSettingsInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.getPublic();
    const entries: [string, unknown][] = [];
    if (input.orgNameEn !== undefined) entries.push([SETTING_KEYS.ORG_NAME_EN, input.orgNameEn]);
    if (input.orgNameAr !== undefined) entries.push([SETTING_KEYS.ORG_NAME_AR, input.orgNameAr]);
    if (input.defaultLocale) entries.push([SETTING_KEYS.DEFAULT_LOCALE, input.defaultLocale]);
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.setting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.id },
          update: { value: value as Prisma.InputJsonValue, updatedById: actor.id },
        });
      }
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: 'organisation',
          userId: actor.id,
          summary: {
            before: {
              orgNameEn: before.orgNameEn,
              orgNameAr: before.orgNameAr,
              defaultLocale: before.defaultLocale,
            },
            after: Object.fromEntries(entries),
          },
          meta,
        },
        tx,
      );
    });
    return this.getAll();
  }

  async uploadLogo(file: Express.Multer.File | undefined, actor: AuthUser, meta: RequestMeta) {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
    if (file.size > LOGO_MAX_BYTES) throw badRequest('FILE_TOO_LARGE');
    const type = sniffImageType(file.buffer);
    if (!type) throw badRequest('UNSUPPORTED_FILE_TYPE');
    const data =
      type === 'image/svg+xml'
        ? Buffer.from(sanitizeSvg(file.buffer.toString('utf8')))
        : file.buffer;
    const version = Date.now().toString(36);
    const key = `branding/logo-${version}`;
    const previous = (await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.LOGO } }))
      ?.value as LogoValue | undefined;
    await this.storage.put(key, data, type);
    const value: LogoValue = { key, contentType: type, version };
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEYS.LOGO },
      create: { key: SETTING_KEYS.LOGO, value: { ...value }, updatedById: actor.id },
      update: { value: { ...value }, updatedById: actor.id },
    });
    if (previous?.key) await this.storage.remove(previous.key).catch(() => undefined);
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'Setting',
      entityId: SETTING_KEYS.LOGO,
      userId: actor.id,
      summary: { logo: { contentType: type, size: data.length } },
      meta,
    });
    return this.getAll();
  }

  async removeLogo(actor: AuthUser, meta: RequestMeta) {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.LOGO } });
    if (row) {
      const value = row.value as unknown as LogoValue;
      await this.prisma.setting.delete({ where: { key: SETTING_KEYS.LOGO } });
      await this.storage.remove(value.key).catch(() => undefined);
      await this.audit.log({
        action: 'DELETE',
        entityType: 'Setting',
        entityId: SETTING_KEYS.LOGO,
        userId: actor.id,
        meta,
      });
    }
    return this.getAll();
  }

  async getLogo() {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.LOGO } });
    if (!row) throw notFound('Logo');
    const value = row.value as unknown as LogoValue;
    return { stream: await this.storage.get(value.key), contentType: value.contentType };
  }
}
