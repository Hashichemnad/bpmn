import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PageTemplateDto, TemplateInput } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { sanitizeRichText } from './rich-text';

const toDto = (t: Prisma.PageTemplateGetPayload<object>): PageTemplateDto => ({
  id: t.id,
  key: t.key,
  nameEn: t.nameEn,
  nameAr: t.nameAr,
  descriptionEn: t.descriptionEn,
  descriptionAr: t.descriptionAr,
  contentEn: t.contentEn,
  contentAr: t.contentAr,
  isSystem: t.isSystem,
  updatedAt: t.updatedAt.toISOString(),
});

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PageTemplateDto[]> {
    const rows = await this.prisma.pageTemplate.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  private async find(id: string) {
    const t = await this.prisma.pageTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw notFound('Template');
    return t;
  }

  async get(id: string) {
    return toDto(await this.find(id));
  }

  private data(input: TemplateInput) {
    return {
      nameEn: input.nameEn ?? '',
      nameAr: input.nameAr ?? '',
      descriptionEn: input.descriptionEn ?? '',
      descriptionAr: input.descriptionAr ?? '',
      contentEn: sanitizeRichText(input.contentEn),
      contentAr: sanitizeRichText(input.contentAr),
    };
  }

  async create(input: TemplateInput, actor: AuthUser, meta: RequestMeta) {
    const max = await this.prisma.pageTemplate.aggregate({ _max: { sortOrder: true } });
    const t = await this.prisma.$transaction(async (tx) => {
      const row = await tx.pageTemplate.create({
        data: {
          ...this.data(input),
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'PageTemplate',
          entityId: row.id,
          userId: actor.id,
          summary: { after: { nameEn: row.nameEn, nameAr: row.nameAr } },
          meta,
        },
        tx,
      );
      return row;
    });
    return toDto(t);
  }

  async update(id: string, input: TemplateInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.find(id);
    const t = await this.prisma.$transaction(async (tx) => {
      const row = await tx.pageTemplate.update({
        where: { id },
        data: { ...this.data(input), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'PageTemplate',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { nameEn: before.nameEn, nameAr: before.nameAr },
            after: { nameEn: row.nameEn, nameAr: row.nameAr },
            contentChanged:
              before.contentEn !== row.contentEn || before.contentAr !== row.contentAr,
          },
          meta,
        },
        tx,
      );
      return row;
    });
    return toDto(t);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const t = await this.find(id);
    if (t.isSystem) throw badRequest('TEMPLATE_SYSTEM', 'Built-in templates cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.pageTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'PageTemplate',
          entityId: id,
          userId: actor.id,
          summary: { before: { nameEn: t.nameEn, nameAr: t.nameAr } },
          meta,
        },
        tx,
      );
    });
  }
}
