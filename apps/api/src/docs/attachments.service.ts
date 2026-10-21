import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_MAX_BYTES,
  attachmentUrl,
  type AttachmentDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { DocsAccessService } from './docs-access.service';
import { detectAttachmentType, safeFileName } from './attachment-type';

const isImage = (type: string) => (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(type);

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly access: DocsAccessService,
  ) {}

  async list(pageId: string, user: AuthUser): Promise<AttachmentDto[]> {
    await this.access.page(pageId, user);
    const rows = await this.prisma.attachment.findMany({
      where: { pageId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.createdById).filter((v): v is string => !!v) } },
      select: { id: true, email: true, nameEn: true, nameAr: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      contentType: r.contentType,
      size: r.size,
      isImage: isImage(r.contentType),
      url: attachmentUrl(r.id),
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdById ? (byId.get(r.createdById) ?? null) : null,
    }));
  }

  async upload(
    pageId: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<AttachmentDto> {
    await this.access.page(pageId, actor, 'edit');
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
    if (file.size > ATTACHMENT_MAX_BYTES) throw badRequest('FILE_TOO_LARGE');
    // Multer decodes the name as latin1; browsers send UTF-8.
    const fileName = safeFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    const contentType = detectAttachmentType(file.buffer, fileName);
    if (!contentType) throw badRequest('UNSUPPORTED_FILE_TYPE');
    const id = randomUUID();
    const storageKey = `attachments/${pageId}/${id}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    const row = await this.prisma.$transaction(async (tx) => {
      const a = await tx.attachment.create({
        data: {
          id,
          pageId,
          fileName,
          contentType,
          size: file.size,
          storageKey,
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Attachment',
          entityId: id,
          userId: actor.id,
          summary: { pageId, fileName, contentType, size: file.size },
          meta,
        },
        tx,
      );
      return a;
    });
    return {
      id: row.id,
      fileName,
      contentType,
      size: row.size,
      isImage: isImage(contentType),
      url: attachmentUrl(row.id),
      createdAt: row.createdAt.toISOString(),
      createdBy: { id: actor.id, email: actor.email, nameEn: actor.nameEn, nameAr: actor.nameAr },
    };
  }

  /**
   * Content of an attachment. Removed attachments stay readable because older page
   * versions may still show them; they disappear only when the page is purged.
   */
  async content(id: string, user: AuthUser) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) throw notFound('Attachment');
    await this.access.page(a.pageId, user);
    return {
      stream: await this.storage.get(a.storageKey),
      contentType: a.contentType,
      fileName: a.fileName,
      isImage: isImage(a.contentType),
      size: a.size,
    };
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const a = await this.prisma.attachment.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw notFound('Attachment');
    await this.access.page(a.pageId, actor, 'edit');
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Attachment',
          entityId: id,
          userId: actor.id,
          summary: { pageId: a.pageId, fileName: a.fileName },
          meta,
        },
        tx,
      );
    });
  }
}
