import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ATTACHMENT_MAX_BYTES, assuranceFileUrl, type AssuranceFileDto } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { detectAttachmentType, safeFileName } from '../docs/attachment-type';

export type FileOwnerType =
  'CONTROL_TEST' | 'ISSUE' | 'ISSUE_ACTION' | 'AUDIT_ITEM' | 'AUDIT_FINDING' | 'SURVEY_RESPONSE';

/** Who may read / add / remove the files of an owner record (registered by each feature). */
export interface FileAccess {
  canRead(ownerId: string, user: AuthUser): Promise<boolean>;
  canWrite(ownerId: string, user: AuthUser): Promise<boolean>;
}

const userRef = { id: true, email: true, nameEn: true, nameAr: true } as const;

/**
 * Evidence files of assurance records in the S3-compatible storage: the same allow-list, content
 * check (magic bytes) and size limit as page attachments; never executed, served as downloads.
 */
@Injectable()
export class AssuranceFilesService {
  private readonly access = new Map<FileOwnerType, FileAccess>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  register(type: FileOwnerType, access: FileAccess) {
    this.access.set(type, access);
  }

  async list(ownerType: FileOwnerType, ownerIds: string[]): Promise<AssuranceFileDto[]> {
    const rows = await this.prisma.assuranceFile.findMany({
      where: { ownerType, ownerId: { in: ownerIds }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.createdById).filter((v): v is string => !!v) } },
      select: userRef,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      fileName: r.fileName,
      contentType: r.contentType,
      size: r.size,
      url: assuranceFileUrl(r.id),
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdById ? (byId.get(r.createdById) ?? null) : null,
    }));
  }

  async upload(
    ownerType: FileOwnerType,
    ownerId: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
    entityType: string,
  ): Promise<AssuranceFileDto> {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
    if (file.size > ATTACHMENT_MAX_BYTES) throw badRequest('FILE_TOO_LARGE');
    // Multer decodes the name as latin1; browsers send UTF-8.
    const fileName = safeFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    const contentType = detectAttachmentType(file.buffer, fileName);
    if (!contentType) throw badRequest('UNSUPPORTED_FILE_TYPE');
    const id = randomUUID();
    const storageKey = `assurance/${ownerType.toLowerCase()}/${ownerId}/${id}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    await this.prisma.$transaction(async (tx) => {
      await tx.assuranceFile.create({
        data: {
          id,
          ownerType,
          ownerId,
          fileName,
          contentType,
          size: file.size,
          storageKey,
          createdById: actor.id,
        },
      });
      await tx.assuranceEvent.create({
        data: {
          entityType,
          entityId: ownerId,
          kind: 'FILE',
          changes: { file: { from: null, to: fileName } },
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: entityType as never,
          entityId: ownerId,
          userId: actor.id,
          summary: { file: { id, fileName, contentType, size: file.size } },
          meta,
        },
        tx,
      );
    });
    return (await this.list(ownerType, [ownerId])).find((f) => f.id === id)!;
  }

  private async load(id: string) {
    const f = await this.prisma.assuranceFile.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw notFound('File');
    return f;
  }

  /** The file for download, when the caller may read its owner record (404 otherwise). */
  async open(id: string, user: AuthUser) {
    const f = await this.load(id);
    const access = this.access.get(f.ownerType as FileOwnerType);
    if (!access || !(await access.canRead(f.ownerId, user))) throw notFound('File');
    return { file: f, stream: await this.storage.get(f.storageKey) };
  }

  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const f = await this.load(id);
    const access = this.access.get(f.ownerType as FileOwnerType);
    if (!access || !(await access.canRead(f.ownerId, user))) throw notFound('File');
    if (!(await access.canWrite(f.ownerId, user))) throw notFound('File');
    await this.prisma.$transaction(async (tx) => {
      await tx.assuranceFile.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Attachment',
          entityId: id,
          userId: user.id,
          summary: { ownerType: f.ownerType, ownerId: f.ownerId, fileName: f.fileName },
          meta,
        },
        tx,
      );
    });
  }
}
