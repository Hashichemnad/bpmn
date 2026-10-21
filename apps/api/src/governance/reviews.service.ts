import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  addDays,
  addMonths,
  canTransition,
  reviewDateState,
  stepAssignees,
  stepOutcome,
  type ArchiveInput,
  type ContentStatus,
  type ContentType,
  type GovernanceInfoDto,
  type PageContentDto,
  type PublicationDto,
  type PublishInput,
  type ReviewCompareDto,
  type ReviewDecisionInput,
  type ReviewDetailDto,
  type ReviewStatus,
  type ReviewStepDto,
  type ReviewSummaryDto,
  type ReviewTaskStatus,
  type SubmitReviewInput,
  type TextDirection,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DomainEvents } from '../events/domain-events';
import { AppException, badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ContentService, itemLink, itemParams, toRef, type ContentItem } from './content.service';
import { WorkflowsService } from './workflows.service';
import { createPublication, type StepSnapshot } from './publication';

type Tx = Prisma.TransactionClient;
type ReviewRow = Prisma.ReviewGetPayload<{ include: { tasks: true } }>;

export type { StepSnapshot };

const entityName = (type: ContentType) => (type === 'PROCESS' ? 'Process' : 'Page');
const dir = (v: string): TextDirection => (v === 'rtl' ? 'rtl' : 'ltr');

export const actorParams = (actor: Pick<AuthUser, 'nameEn' | 'nameAr' | 'email'>) => ({
  actorEn: actor.nameEn || actor.nameAr || actor.email,
  actorAr: actor.nameAr || actor.nameEn || actor.email,
});

async function setNextReview(tx: Tx, type: ContentType, id: string, nextReviewAt: Date) {
  if (type === 'PROCESS') await tx.process.update({ where: { id }, data: { nextReviewAt } });
  else await tx.page.update({ where: { id }, data: { nextReviewAt } });
}

/** Moves the item only when it is still in `from` (guards against concurrent transitions). */
async function transition(
  tx: Tx,
  type: ContentType,
  id: string,
  from: ContentStatus,
  to: ContentStatus,
) {
  const where = { id, status: from };
  const res =
    type === 'PROCESS'
      ? await tx.process.updateMany({ where, data: { status: to } })
      : await tx.page.updateMany({ where, data: { status: to } });
  if (!res.count) throw conflict('INVALID_TRANSITION', 'The item changed in the meantime');
}

/**
 * Governance lifecycle of processes and pages: submit → review steps → approve → publish,
 * plus withdraw, archive / restore and periodic review confirmation. Every transition is
 * checked on the server and written to the audit log.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly content: ContentService,
    private readonly workflows: WorkflowsService,
    private readonly notifications: NotificationsService,
    private readonly events: DomainEvents,
  ) {}

  // ---------- Submit ----------

  async submit(
    type: ContentType,
    id: string,
    input: SubmitReviewInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const item = await this.content.load(type, id, actor);
    if (!item.canEdit) throw forbidden('You cannot submit this item for review');
    if (!canTransition(item.status, 'SUBMIT')) throw conflict('INVALID_TRANSITION');
    if (!item.latestVersion) throw conflict('NO_VERSION', 'Save a version first');
    if (await this.content.hasUnversionedChanges(item)) {
      throw conflict('UNVERSIONED_CHANGES', 'Save the working model as a version first');
    }
    const { workflow } = await this.workflows.resolve(item);
    if (!workflow) throw badRequest('NO_WORKFLOW', 'No approval workflow is configured');
    const resolved = await this.workflows.resolveSteps(item, workflow);
    const steps: StepSnapshot[] = [];
    for (const [i, s] of resolved.entries()) {
      const { assigneeIds, onlySubmitter } = stepAssignees(s.candidateIds, actor.id);
      const details = { step: i, nameEn: s.nameEn, nameAr: s.nameAr };
      // Four-eyes principle: nobody approves their own work.
      if (onlySubmitter) {
        throw badRequest(
          'SELF_APPROVAL_NOT_ALLOWED',
          'You are the only approver of a workflow step; assign another approver first',
          details,
        );
      }
      if (!assigneeIds.length) {
        throw badRequest('WORKFLOW_NO_ASSIGNEES', 'A workflow step has nobody to review', details);
      }
      steps.push({
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        rule: s.rule,
        assigneeIds,
        approvedBySubmitter: false,
      });
    }
    const settings = await this.workflows.settings();
    const result = await this.prisma.$transaction(async (tx) => {
      await transition(tx, type, id, 'DRAFT', 'IN_REVIEW');
      const review = await tx.review.create({
        data: {
          entityType: type,
          entityId: id,
          versionNumber: item.latestVersion!,
          workflowId: workflow.id,
          workflowNameEn: workflow.nameEn,
          workflowNameAr: workflow.nameAr,
          steps: steps as unknown as Prisma.InputJsonValue,
          autoPublish: workflow.autoPublish,
          note: input.note ?? '',
          submittedById: actor.id,
          dueAt: input.dueAt ?? addDays(new Date(), settings.reviewDueDays),
        },
      });
      await this.audit.log(
        {
          action: 'SUBMIT',
          entityType: entityName(type),
          entityId: id,
          userId: actor.id,
          summary: {
            reviewId: review.id,
            versionNumber: review.versionNumber,
            workflow: workflow.nameEn || workflow.nameAr,
            status: { from: item.status, to: 'IN_REVIEW' },
            note: input.note ?? null,
          },
          meta,
        },
        tx,
      );
      const next = await this.advance(tx, review, steps, 0, item, actor);
      return { review, next };
    });
    await this.afterAdvance(item, result.review, steps, result.next, actor);
    return this.info(type, id, actor);
  }

  /**
   * Activates the next step that needs someone (creating their tasks) or, when none is left,
   * approves the review — and publishes it when the workflow says so.
   */
  private async advance(
    tx: Tx,
    review: {
      id: string;
      versionNumber: number;
      autoPublish: boolean;
      submittedById: string | null;
    },
    steps: StepSnapshot[],
    from: number,
    item: ContentItem,
    actor: AuthUser,
  ) {
    let i = from;
    while (i < steps.length && steps[i].approvedBySubmitter) i++;
    if (i < steps.length) {
      await tx.review.update({ where: { id: review.id }, data: { currentStep: i } });
      await tx.reviewTask.createMany({
        data: steps[i].assigneeIds.map((assigneeId) => ({
          reviewId: review.id,
          stepIndex: i,
          assigneeId,
        })),
      });
      return {
        activated: { index: i, assigneeIds: steps[i].assigneeIds },
        approved: false,
        published: false,
      };
    }
    await tx.review.update({
      where: { id: review.id },
      data: {
        status: 'APPROVED',
        completedAt: new Date(),
        currentStep: Math.max(steps.length - 1, 0),
      },
    });
    await transition(tx, item.type, item.id, 'IN_REVIEW', 'APPROVED');
    await this.audit.log(
      {
        action: 'APPROVE',
        entityType: entityName(item.type),
        entityId: item.id,
        userId: actor.id,
        summary: {
          reviewId: review.id,
          versionNumber: review.versionNumber,
          final: true,
          status: { from: 'IN_REVIEW', to: 'APPROVED' },
        },
      },
      tx,
    );
    if (review.autoPublish) {
      const pub = await this.createPublication(tx, item, review.id, actor, undefined);
      await transition(tx, item.type, item.id, 'APPROVED', 'PUBLISHED');
      await this.audit.log(
        {
          action: 'PUBLISH',
          entityType: entityName(item.type),
          entityId: item.id,
          userId: actor.id,
          summary: {
            publicationId: pub.id,
            versionNumber: pub.versionNumber,
            automatic: true,
            status: { from: 'APPROVED', to: 'PUBLISHED' },
          },
        },
        tx,
      );
      return { activated: null, approved: true, published: true };
    }
    return { activated: null, approved: true, published: false };
  }

  private async afterAdvance(
    item: ContentItem,
    review: { id: string; versionNumber: number; submittedById: string | null },
    steps: StepSnapshot[],
    next: {
      activated: { index: number; assigneeIds: string[] } | null;
      approved: boolean;
      published: boolean;
    },
    actor: AuthUser,
  ) {
    const base = { entityType: item.type, entityId: item.id, actorId: actor.id };
    const params = { ...itemParams(item), ...actorParams(actor), version: review.versionNumber };
    if (next.activated) {
      const step = steps[next.activated.index];
      await this.notifications.notify({
        ...base,
        userIds: next.activated.assigneeIds,
        type: 'REVIEW_REQUESTED',
        params: { ...params, stepEn: step.nameEn, stepAr: step.nameAr },
        link: `/reviews/${review.id}`,
      });
    }
    if (next.approved) {
      await this.notifications.notify({
        ...base,
        userIds: [review.submittedById, item.ownerId],
        type: 'APPROVED',
        params,
        link: itemLink(item),
      });
    }
    if (next.published) await this.afterPublish(item, review.id, actor);
  }

  // ---------- Decisions ----------

  async decide(reviewId: string, input: ReviewDecisionInput, actor: AuthUser, meta: RequestMeta) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { tasks: true },
    });
    if (!review) throw notFound('Review');
    if (review.status !== 'IN_PROGRESS') throw conflict('REVIEW_CLOSED');
    const task = review.tasks.find(
      (t) =>
        t.assigneeId === actor.id && t.stepIndex === review.currentStep && t.status === 'PENDING',
    );
    if (!task || !actor.permissions.has(PERMISSIONS.REVIEWS_DECIDE))
      throw new AppException(HttpStatus.FORBIDDEN, 'NOT_YOUR_TASK', 'No open review task for you');
    const item = await this.content.find(review.entityType, review.entityId, actor);
    if (!item) throw notFound(entityName(review.entityType));
    const steps = review.steps as unknown as StepSnapshot[];
    const step = steps[review.currentStep];
    const taskStatus: ReviewTaskStatus =
      input.decision === 'APPROVE'
        ? 'APPROVED'
        : input.decision === 'REJECT'
          ? 'REJECTED'
          : 'CHANGES_REQUESTED';

    const result = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.reviewTask.updateMany({
        where: { id: task.id, status: 'PENDING' },
        data: { status: taskStatus, comment: input.comment ?? null, decidedAt: new Date() },
      });
      if (!upd.count) throw conflict('REVIEW_CLOSED');
      const stepTasks = await tx.reviewTask.findMany({
        where: { reviewId, stepIndex: review.currentStep },
      });
      const outcome = stepOutcome(step.rule, stepTasks);
      await this.audit.log(
        {
          action: input.decision,
          entityType: entityName(review.entityType),
          entityId: review.entityId,
          userId: actor.id,
          summary: {
            reviewId,
            versionNumber: review.versionNumber,
            step: review.currentStep,
            stepName: step.nameEn || step.nameAr,
            comment: input.comment ?? null,
          },
          meta,
        },
        tx,
      );
      if (outcome === 'PENDING') return { outcome, next: null };
      if (outcome === 'APPROVED') {
        await tx.reviewTask.updateMany({
          where: { reviewId, stepIndex: review.currentStep, status: 'PENDING' },
          data: { status: 'SKIPPED' },
        });
        const next = await this.advance(tx, review, steps, review.currentStep + 1, item, actor);
        return { outcome, next };
      }
      await tx.reviewTask.updateMany({
        where: { reviewId, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await tx.review.update({
        where: { id: reviewId },
        data: { status: outcome as ReviewStatus, completedAt: new Date() },
      });
      await transition(tx, review.entityType, review.entityId, 'IN_REVIEW', 'DRAFT');
      return { outcome, next: null };
    });

    if (result.next) await this.afterAdvance(item, review, steps, result.next, actor);
    if (result.outcome === 'CHANGES_REQUESTED' || result.outcome === 'REJECTED') {
      await this.notifications.notify({
        userIds: [review.submittedById, item.ownerId],
        type: result.outcome === 'REJECTED' ? 'REJECTED' : 'CHANGES_REQUESTED',
        entityType: item.type,
        entityId: item.id,
        actorId: actor.id,
        params: {
          ...itemParams(item),
          ...actorParams(actor),
          version: review.versionNumber,
          comment: input.comment ?? '',
        },
        link: itemLink(item),
      });
    }
    return this.detail(reviewId, actor);
  }

  // ---------- Withdraw / publish / archive / restore ----------

  private activeReview(type: ContentType, id: string) {
    return this.prisma.review.findFirst({
      where: { entityType: type, entityId: id, status: 'IN_PROGRESS' },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async withdraw(type: ContentType, id: string, actor: AuthUser, meta: RequestMeta) {
    const item = await this.content.load(type, id, actor);
    const review = await this.activeReview(type, id);
    if (!review || item.status !== 'IN_REVIEW') throw conflict('INVALID_TRANSITION');
    const allowed =
      review.submittedById === actor.id ||
      item.canEdit ||
      actor.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE);
    if (!allowed) throw forbidden('You cannot withdraw this review');
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewTask.updateMany({
        where: { reviewId: review.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await tx.review.update({
        where: { id: review.id },
        data: { status: 'WITHDRAWN', completedAt: new Date() },
      });
      await transition(tx, type, id, 'IN_REVIEW', 'DRAFT');
      await this.audit.log(
        {
          action: 'WITHDRAW',
          entityType: entityName(type),
          entityId: id,
          userId: actor.id,
          summary: { reviewId: review.id, status: { from: 'IN_REVIEW', to: 'DRAFT' } },
          meta,
        },
        tx,
      );
    });
    return this.info(type, id, actor);
  }

  async publish(
    type: ContentType,
    id: string,
    input: PublishInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const item = await this.content.load(type, id, actor);
    if (!item.canEdit && !item.canManage) throw forbidden('You cannot publish this item');
    if (!canTransition(item.status, 'PUBLISH')) throw conflict('INVALID_TRANSITION');
    const review = await this.prisma.review.findFirst({
      where: { entityType: type, entityId: id, status: 'APPROVED' },
      orderBy: { completedAt: 'desc' },
    });
    if (!review) throw conflict('NO_APPROVED_REVIEW');
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, type, id, 'APPROVED', 'PUBLISHED');
      const pub = await this.createPublication(tx, item, review.id, actor, input.versionLabel);
      await this.audit.log(
        {
          action: 'PUBLISH',
          entityType: entityName(type),
          entityId: id,
          userId: actor.id,
          summary: {
            publicationId: pub.id,
            versionNumber: pub.versionNumber,
            versionLabel: pub.versionLabel,
            status: { from: 'APPROVED', to: 'PUBLISHED' },
          },
          meta,
        },
        tx,
      );
    });
    await this.afterPublish(item, review.id, actor);
    return this.info(type, id, actor);
  }

  /** Snapshot of the approved version: becomes the one current publication of the item. */
  private async createPublication(
    tx: Tx,
    item: ContentItem,
    reviewId: string,
    actor: AuthUser,
    label: string | undefined,
  ) {
    const settings = await this.workflows.settings();
    return createPublication(tx, {
      type: item.type,
      id: item.id,
      reviewId,
      actorId: actor.id,
      label,
      nextReviewAt: addMonths(new Date(), settings.reviewIntervalMonths),
    });
  }

  private async afterPublish(item: ContentItem, reviewId: string, actor: AuthUser) {
    const pub = await this.prisma.publication.findFirst({
      where: { entityType: item.type, entityId: item.id, current: true },
    });
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    await this.notifications.notify({
      userIds: [review?.submittedById, item.ownerId, ...(pub?.approverIds ?? [])],
      type: 'PUBLISHED',
      entityType: item.type,
      entityId: item.id,
      actorId: actor.id,
      params: { ...itemParams(item), ...actorParams(actor), version: pub?.versionNumber ?? '' },
      link: itemLink(item),
    });
    this.events.emit({
      type: 'content.published',
      entityType: item.type,
      entityId: item.id,
      actorId: actor.id,
    });
  }

  async archive(
    type: ContentType,
    id: string,
    input: ArchiveInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const item = await this.content.load(type, id, actor);
    this.content.assertCanManage(item);
    if (!canTransition(item.status, 'ARCHIVE')) throw conflict('INVALID_TRANSITION');
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, type, id, item.status, 'ARCHIVED');
      await tx.publication.updateMany({
        where: { entityType: type, entityId: id, current: true },
        data: { current: false, endedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'ARCHIVE',
          entityType: entityName(type),
          entityId: id,
          userId: actor.id,
          summary: { status: { from: item.status, to: 'ARCHIVED' }, reason: input.reason ?? null },
          meta,
        },
        tx,
      );
    });
    this.events.emit({
      type: 'content.unpublished',
      entityType: type,
      entityId: id,
      actorId: actor.id,
    });
    return this.info(type, id, actor);
  }

  async restore(type: ContentType, id: string, actor: AuthUser, meta: RequestMeta) {
    const item = await this.content.load(type, id, actor);
    this.content.assertCanManage(item);
    if (!canTransition(item.status, 'RESTORE')) throw conflict('INVALID_TRANSITION');
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, type, id, 'ARCHIVED', 'DRAFT');
      await this.audit.log(
        {
          action: 'UNARCHIVE',
          entityType: entityName(type),
          entityId: id,
          userId: actor.id,
          summary: { status: { from: 'ARCHIVED', to: 'DRAFT' } },
          meta,
        },
        tx,
      );
    });
    return this.info(type, id, actor);
  }

  /** The owner confirms the published content is still correct: the next review date moves on. */
  async confirmReview(type: ContentType, id: string, actor: AuthUser, meta: RequestMeta) {
    const item = await this.content.load(type, id, actor);
    this.content.assertCanManage(item);
    const pub = await this.prisma.publication.findFirst({
      where: { entityType: type, entityId: id, current: true },
    });
    if (!pub) throw conflict('NOT_PUBLISHED');
    const settings = await this.workflows.settings();
    const nextReviewAt = addMonths(new Date(), settings.reviewIntervalMonths);
    await this.prisma.$transaction(async (tx) => {
      await setNextReview(tx, type, id, nextReviewAt);
      await this.audit.log(
        {
          action: 'REVIEW_CONFIRMED',
          entityType: entityName(type),
          entityId: id,
          userId: actor.id,
          summary: {
            versionNumber: pub.versionNumber,
            nextReviewAt: { from: item.nextReviewAt, to: nextReviewAt },
          },
          meta,
        },
        tx,
      );
    });
    return this.info(type, id, actor);
  }

  // ---------- Read models ----------

  async summaries(rows: ReviewRow[], user?: AuthUser): Promise<ReviewSummaryDto[]> {
    const refs = await this.content.refs(
      rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId })),
    );
    const users = await this.content.users(rows.map((r) => r.submittedById));
    const now = new Date();
    return rows.map((r) => {
      const steps = r.steps as unknown as StepSnapshot[];
      const step = steps[r.currentStep];
      const myTask = user
        ? r.tasks.find(
            (t) =>
              t.assigneeId === user.id && t.status === 'PENDING' && t.stepIndex === r.currentStep,
          )
        : undefined;
      return {
        id: r.id,
        item: refs.get(`${r.entityType}:${r.entityId}`) ?? {
          entityType: r.entityType,
          entityId: r.entityId,
          titleEn: '',
          titleAr: '',
        },
        versionNumber: r.versionNumber,
        status: r.status,
        currentStep: r.currentStep,
        stepCount: steps.length,
        currentStepName: step ? { nameEn: step.nameEn, nameAr: step.nameAr } : null,
        workflowName: { nameEn: r.workflowNameEn, nameAr: r.workflowNameAr },
        note: r.note,
        submittedBy: r.submittedById ? (users.get(r.submittedById) ?? null) : null,
        submittedAt: r.submittedAt.toISOString(),
        dueAt: r.dueAt?.toISOString() ?? null,
        overdue: r.status === 'IN_PROGRESS' && !!r.dueAt && r.dueAt < now,
        completedAt: r.completedAt?.toISOString() ?? null,
        ...(user ? { myTaskId: myTask?.id ?? null } : {}),
      };
    });
  }

  async publicationDto(
    pub: Prisma.PublicationGetPayload<object> | null,
  ): Promise<PublicationDto | null> {
    if (!pub) return null;
    const users = await this.content.users([pub.publishedById, ...pub.approverIds]);
    return {
      id: pub.id,
      versionNumber: pub.versionNumber,
      versionLabel: pub.versionLabel,
      publishedAt: pub.publishedAt.toISOString(),
      publishedBy: pub.publishedById ? (users.get(pub.publishedById) ?? null) : null,
      approvedAt: pub.approvedAt?.toISOString() ?? null,
      approvedBy: pub.approverIds.map((id) => users.get(id)).filter((u) => !!u),
    };
  }

  async info(type: ContentType, id: string, user: AuthUser): Promise<GovernanceInfoDto> {
    const item = await this.content.load(type, id, user);
    const [active, last, pub, resolved, unversioned, settings, owner] = await Promise.all([
      this.prisma.review.findFirst({
        where: { entityType: type, entityId: id, status: 'IN_PROGRESS' },
        include: { tasks: true },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.review.findFirst({
        where: { entityType: type, entityId: id, status: { not: 'IN_PROGRESS' } },
        include: { tasks: true },
        orderBy: { completedAt: 'desc' },
      }),
      this.prisma.publication.findFirst({
        where: { entityType: type, entityId: id, current: true },
      }),
      this.workflows.resolve(item),
      this.content.hasUnversionedChanges(item),
      this.workflows.settings(),
      this.content.users([item.ownerId]),
    ]);
    const versionLabel = item.latestVersion
      ? type === 'PROCESS'
        ? (
            await this.prisma.processVersion.findUnique({
              where: {
                processId_versionNumber: { processId: id, versionNumber: item.latestVersion },
              },
              select: { label: true },
            })
          )?.label
        : (
            await this.prisma.pageVersion.findUnique({
              where: { pageId_versionNumber: { pageId: id, versionNumber: item.latestVersion } },
              select: { label: true },
            })
          )?.label
      : null;
    const [activeDto] = active ? await this.summaries([active], user) : [null];
    const [lastDto] = last ? await this.summaries([last], user) : [null];
    const manage = item.canManage;
    const submitter = !!active && active.submittedById === user.id;
    return {
      entityType: type,
      entityId: id,
      status: item.status,
      changesRequested: item.status === 'DRAFT' && last?.status === 'CHANGES_REQUESTED',
      rejected: item.status === 'DRAFT' && last?.status === 'REJECTED',
      owner: item.ownerId ? (owner.get(item.ownerId) ?? null) : null,
      latestVersion: item.latestVersion,
      latestVersionLabel: versionLabel ?? null,
      hasUnversionedChanges: unversioned,
      activeReview: activeDto,
      lastReview: lastDto,
      publication: await this.publicationDto(pub),
      nextReviewAt: item.nextReviewAt?.toISOString() ?? null,
      reviewState: pub
        ? reviewDateState(item.nextReviewAt, new Date(), settings.reminderDays)
        : 'NONE',
      workflow: {
        source: resolved.source,
        workflow: resolved.workflow ? (await this.workflows.toDtos([resolved.workflow]))[0] : null,
      },
      can: {
        submit: item.canEdit && canTransition(item.status, 'SUBMIT') && !!item.latestVersion,
        withdraw:
          item.status === 'IN_REVIEW' &&
          (submitter || item.canEdit || user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE)),
        publish: (item.canEdit || manage) && canTransition(item.status, 'PUBLISH'),
        archive: manage && canTransition(item.status, 'ARCHIVE'),
        restore: manage && canTransition(item.status, 'RESTORE'),
        configure: manage,
        confirmReview: manage && !!pub,
        comment: user.permissions.has(PERMISSIONS.COMMENTS_WRITE),
      },
    };
  }

  async listForItem(type: ContentType, id: string, user: AuthUser) {
    await this.content.load(type, id, user);
    const rows = await this.prisma.review.findMany({
      where: { entityType: type, entityId: id },
      include: { tasks: true },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    });
    return this.summaries(rows, user);
  }

  async publicationsForItem(type: ContentType, id: string, user: AuthUser) {
    await this.content.load(type, id, user);
    const rows = await this.prisma.publication.findMany({
      where: { entityType: type, entityId: id },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
    const dtos = await Promise.all(rows.map((r) => this.publicationDto(r)));
    return dtos.map((d, i) => ({
      ...d!,
      current: rows[i].current,
      endedAt: rows[i].endedAt?.toISOString() ?? null,
    }));
  }

  /** Review page: steps, decisions and the diff against the last published version. */
  async detail(reviewId: string, user: AuthUser): Promise<ReviewDetailDto> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { tasks: true },
    });
    if (!review) throw notFound('Review');
    const item = await this.content.find(review.entityType, review.entityId, user);
    const involved =
      review.submittedById === user.id || review.tasks.some((t) => t.assigneeId === user.id);
    if (!item || (!item.canRead && !involved)) throw notFound('Review');
    const [summary] = await this.summaries([review], user);
    const steps = review.steps as unknown as StepSnapshot[];
    const users = await this.content.users([
      ...steps.flatMap((s) => s.assigneeIds),
      ...review.tasks.map((t) => t.assigneeId),
    ]);
    const stepState = (i: number): ReviewStepDto['state'] => {
      if (steps[i].approvedBySubmitter) return 'APPROVED';
      if (i < review.currentStep) return 'APPROVED';
      if (i > review.currentStep)
        return review.status === 'IN_PROGRESS'
          ? 'WAITING'
          : review.status === 'APPROVED'
            ? 'APPROVED'
            : 'CANCELLED';
      switch (review.status) {
        case 'IN_PROGRESS':
          return 'ACTIVE';
        case 'WITHDRAWN':
          return 'CANCELLED';
        default:
          return review.status;
      }
    };
    const base = await this.prisma.publication.findFirst({
      where: {
        entityType: review.entityType,
        entityId: review.entityId,
        versionNumber: { lt: review.versionNumber },
      },
      orderBy: { publishedAt: 'desc' },
    });
    let compare: ReviewCompareDto;
    let changeNote = '';
    if (review.entityType === 'PROCESS') {
      const [next, old] = await Promise.all([
        this.prisma.processVersion.findUnique({
          where: {
            processId_versionNumber: {
              processId: review.entityId,
              versionNumber: review.versionNumber,
            },
          },
        }),
        base
          ? this.prisma.processVersion.findUnique({
              where: {
                processId_versionNumber: {
                  processId: review.entityId,
                  versionNumber: base.versionNumber,
                },
              },
            })
          : null,
      ]);
      changeNote = next?.changeNote ?? '';
      compare = {
        kind: 'PROCESS',
        baseVersion: base?.versionNumber ?? null,
        baseLabel: base?.versionLabel ?? null,
        baseXml: old?.bpmnXml ?? null,
        newXml: next?.bpmnXml ?? '',
      };
    } else {
      const toContent = (v: Prisma.PageVersionGetPayload<object>): PageContentDto => ({
        titleEn: v.titleEn,
        titleAr: v.titleAr,
        contentEn: v.contentEn,
        contentAr: v.contentAr,
        dirEn: dir(v.dirEn),
        dirAr: dir(v.dirAr),
      });
      const [next, old] = await Promise.all([
        this.prisma.pageVersion.findUniqueOrThrow({
          where: {
            pageId_versionNumber: { pageId: review.entityId, versionNumber: review.versionNumber },
          },
        }),
        base
          ? this.prisma.pageVersion.findUnique({
              where: {
                pageId_versionNumber: {
                  pageId: review.entityId,
                  versionNumber: base.versionNumber,
                },
              },
            })
          : null,
      ]);
      changeNote = next.changeNote;
      compare = {
        kind: 'PAGE',
        baseVersion: base?.versionNumber ?? null,
        baseLabel: base?.versionLabel ?? null,
        base: old ? toContent(old) : null,
        next: toContent(next),
      };
    }
    return {
      ...summary,
      item: toRef(item),
      changeNote,
      steps: steps.map((s, i) => ({
        index: i,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        rule: s.rule,
        state: stepState(i),
        approvedBySubmitter: s.approvedBySubmitter,
        assignees: s.assigneeIds.map((id) => users.get(id)).filter((u) => !!u),
        tasks: review.tasks
          .filter((t) => t.stepIndex === i)
          .map((t) => ({
            id: t.id,
            stepIndex: t.stepIndex,
            assignee: users.get(t.assigneeId) ?? null,
            status: t.status,
            comment: t.comment,
            decidedAt: t.decidedAt?.toISOString() ?? null,
          })),
      })),
      compare,
      canDecide: !!summary.myTaskId,
      canWithdraw:
        review.status === 'IN_PROGRESS' &&
        (review.submittedById === user.id ||
          item.canEdit ||
          user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE)),
    };
  }
}
