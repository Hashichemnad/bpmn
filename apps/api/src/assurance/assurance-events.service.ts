import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AssuranceEventDto } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaClient;
const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;

/** History (status changes, updates, files) and comments of assurance records. */
@Injectable()
export class AssuranceEventsService {
  constructor(private readonly prisma: PrismaService) {}

  add(
    tx: Tx,
    entityType: string,
    entityId: string,
    kind: AssuranceEventDto['kind'],
    changes: object,
    comment: string | undefined,
    actorId: string | null,
  ) {
    return tx.assuranceEvent.create({
      data: {
        entityType,
        entityId,
        kind,
        changes: changes as Prisma.InputJsonValue,
        comment: comment ?? '',
        createdById: actorId,
      },
    });
  }

  async list(entityType: string, entityId: string): Promise<AssuranceEventDto[]> {
    const rows = await this.prisma.assuranceEvent.findMany({
      where: { entityType, entityId },
      include: { createdBy: userRef },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as AssuranceEventDto['kind'],
      changes: (r.changes ?? {}) as AssuranceEventDto['changes'],
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      author: r.createdBy ?? null,
    }));
  }
}
