import { HttpStatus } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { editBlockedReason, type ContentStatus, type ContentType } from '@processhub/shared';
import { AppException } from '../common/app-exception';

type Client = PrismaClient | Prisma.TransactionClient;

async function statusOf(db: Client, type: ContentType, id: string): Promise<ContentStatus | null> {
  const row =
    type === 'PROCESS'
      ? await db.process.findUnique({ where: { id }, select: { status: true } })
      : await db.page.findUnique({ where: { id }, select: { status: true } });
  return (row?.status as ContentStatus | undefined) ?? null;
}

/** Throws 409 ITEM_IN_REVIEW / ITEM_ARCHIVED when the content may not be changed. */
export async function assertEditable(db: Client, type: ContentType, id: string): Promise<void> {
  const status = await statusOf(db, type, id);
  const reason = status ? editBlockedReason(status) : null;
  if (reason) {
    throw new AppException(
      HttpStatus.CONFLICT,
      reason,
      reason === 'ITEM_IN_REVIEW'
        ? 'The item is in review; withdraw the review to edit it'
        : 'The item is archived; restore it to edit it',
    );
  }
}

/**
 * After a content change: an approved or published item gets a new working copy (Draft).
 * The published version stays live in the portal until the new one is published.
 */
export async function markEdited(
  db: Client,
  type: ContentType,
  id: string,
  actorId: string,
): Promise<ContentStatus | null> {
  const status = await statusOf(db, type, id);
  if (status !== 'APPROVED' && status !== 'PUBLISHED') return status;
  if (type === 'PROCESS') await db.process.update({ where: { id }, data: { status: 'DRAFT' } });
  else await db.page.update({ where: { id }, data: { status: 'DRAFT' } });
  await db.auditLog.create({
    data: {
      action: 'UPDATE',
      entityType: type === 'PROCESS' ? 'Process' : 'Page',
      entityId: id,
      userId: actorId,
      summary: { status: { from: status, to: 'DRAFT' }, reason: 'edited' },
    },
  });
  return 'DRAFT';
}

/** Deleting items ends their open reviews (tasks disappear from "My tasks"). */
export async function withdrawReviewsOf(db: Client, type: ContentType, ids: string[]) {
  if (!ids.length) return;
  const reviews = await db.review.findMany({
    where: { entityType: type, entityId: { in: ids }, status: 'IN_PROGRESS' },
    select: { id: true },
  });
  if (!reviews.length) return;
  const reviewIds = reviews.map((r) => r.id);
  await db.reviewTask.updateMany({
    where: { reviewId: { in: reviewIds }, status: 'PENDING' },
    data: { status: 'SKIPPED' },
  });
  await db.review.updateMany({
    where: { id: { in: reviewIds } },
    data: { status: 'WITHDRAWN', completedAt: new Date() },
  });
  if (type === 'PROCESS') {
    await db.process.updateMany({
      where: { id: { in: ids }, status: 'IN_REVIEW' },
      data: { status: 'DRAFT' },
    });
  } else {
    await db.page.updateMany({
      where: { id: { in: ids }, status: 'IN_REVIEW' },
      data: { status: 'DRAFT' },
    });
  }
}
