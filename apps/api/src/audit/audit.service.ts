import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAction, AuditEntityType, AuditListQuery, AuditLogDto } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../common/auth-user';
import { orderBy, pageArgs, paginated } from '../common/pagination';

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  userId?: string | null;
  summary?: Record<string, unknown> | null;
  meta?: RequestMeta;
}

type Client = PrismaService | Prisma.TransactionClient;

const SECRET_KEYS = /password|token|secret|hash/i;

/** Removes secret-looking keys recursively so they never reach the audit table. */
export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEYS.test(k))
        .map(([k, v]) => [k, scrubSecrets(v)]),
    );
  }
  return value;
}

/** Returns only the fields that changed between two records: { field: { from, to } }. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = before[f];
    const b = after[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[f] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes an audit entry. Pass a transaction client to make it atomic with the change. */
  async log(entry: AuditEntry, client: Client = this.prisma): Promise<void> {
    try {
      await client.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          userId: entry.userId ?? null,
          summary: entry.summary
            ? (scrubSecrets(entry.summary) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ip: entry.meta?.ip ?? null,
          userAgent: entry.meta?.userAgent ?? null,
        },
      });
    } catch (err) {
      if (client !== this.prisma) throw err;
      this.logger.error(`Failed to write audit log: ${(err as Error).message}`);
    }
  }

  async list(q: AuditListQuery) {
    const where: Prisma.AuditLogWhereInput = {
      action: q.action,
      entityType: q.entityType,
      entityId: q.entityId,
      userId: q.userId,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
      ...(q.q
        ? {
            OR: [
              { entityId: { contains: q.q, mode: 'insensitive' } },
              { user: { email: { contains: q.q, mode: 'insensitive' } } },
              { ip: { contains: q.q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, email: true, nameEn: true, nameAr: true } } },
        orderBy: q.sort ? orderBy(q, ['createdAt', 'action', 'entityType'], 'createdAt') : { createdAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const items: AuditLogDto[] = rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
    }));
    return paginated(items, total, q);
  }
}
