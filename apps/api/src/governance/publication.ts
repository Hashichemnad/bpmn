import type { Prisma } from '@prisma/client';
import {
  extractBpmnElementIds,
  extractBpmnLabels,
  type ApprovalRule,
  type ContentType,
} from '@processhub/shared';
import { htmlToText } from '../docs/rich-text';

type Tx = Prisma.TransactionClient;

/** Review steps as frozen at submission, with the users resolved then. */
export interface StepSnapshot {
  nameEn: string;
  nameAr: string;
  rule: ApprovalRule;
  assigneeIds: string[];
  /** Only in reviews submitted before self-approval was blocked (four-eyes principle); now always false. */
  approvedBySubmitter: boolean;
}

/**
 * Publishes the version approved by `reviewId`: ends the item's current publication and
 * stores a snapshot (title, description, search text and, for processes, the object links of
 * the published BPMN elements). Also sets the next periodic review date. Used by the workflow
 * and by the demo seed.
 */
export async function createPublication(
  tx: Tx,
  input: {
    type: ContentType;
    id: string;
    reviewId: string;
    actorId: string | null;
    label?: string;
    nextReviewAt: Date;
    publishedAt?: Date;
  },
) {
  const review = await tx.review.findUniqueOrThrow({
    where: { id: input.reviewId },
    include: { tasks: true },
  });
  const versionNumber = review.versionNumber;
  const now = input.publishedAt ?? new Date();
  await tx.publication.updateMany({
    where: { entityType: input.type, entityId: input.id, current: true },
    data: { current: false, endedAt: now },
  });
  const approverIds = review.tasks.filter((t) => t.status === 'APPROVED').map((t) => t.assigneeId);
  const steps = review.steps as unknown as StepSnapshot[];
  if (review.submittedById && steps.some((s) => s.approvedBySubmitter)) {
    approverIds.push(review.submittedById);
  }
  const common = {
    entityType: input.type,
    entityId: input.id,
    versionNumber,
    reviewId: review.id,
    approvedAt: review.completedAt,
    approverIds: [...new Set(approverIds)],
    publishedAt: now,
    publishedById: input.actorId,
  };
  const { label, nextReviewAt } = input;
  if (input.type === 'PROCESS') {
    const [p, v] = await Promise.all([
      tx.process.findUniqueOrThrow({ where: { id: input.id } }),
      tx.processVersion.findUniqueOrThrow({
        where: { processId_versionNumber: { processId: input.id, versionNumber } },
      }),
    ]);
    if (label) await tx.processVersion.update({ where: { id: v.id }, data: { label } });
    const labels = [...extractBpmnLabels(v.bpmnXml).values()];
    const ids = [...extractBpmnElementIds(v.bpmnXml)];
    const links = await tx.objectLink.findMany({
      where: { processId: input.id, bpmnElementId: { in: ids }, repoObject: { deletedAt: null } },
    });
    await tx.process.update({ where: { id: input.id }, data: { nextReviewAt } });
    return tx.publication.create({
      data: {
        ...common,
        versionLabel: label || v.label,
        code: p.code,
        titleEn: p.nameEn,
        titleAr: p.nameAr,
        descriptionEn: p.descriptionEn,
        descriptionAr: p.descriptionAr,
        textEn: labels.map((l) => [l.nameEn || l.name, l.descriptionEn].join(' ')).join('\n'),
        textAr: labels.map((l) => [l.nameAr, l.descriptionAr].join(' ')).join('\n'),
        links: {
          create: links.map((l) => ({
            bpmnElementId: l.bpmnElementId,
            repoObjectId: l.repoObjectId,
            relation: l.relation,
          })),
        },
      },
    });
  }
  const v = await tx.pageVersion.findUniqueOrThrow({
    where: { pageId_versionNumber: { pageId: input.id, versionNumber } },
  });
  if (label) await tx.pageVersion.update({ where: { id: v.id }, data: { label } });
  await tx.page.update({ where: { id: input.id }, data: { nextReviewAt } });
  return tx.publication.create({
    data: {
      ...common,
      versionLabel: label || v.label,
      titleEn: v.titleEn,
      titleAr: v.titleAr,
      textEn: htmlToText(v.contentEn),
      textAr: htmlToText(v.contentAr),
    },
  });
}
