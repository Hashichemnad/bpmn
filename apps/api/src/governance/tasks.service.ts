import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CONTENT_STATUSES,
  addDays,
  reviewDateState,
  type ContentStatus,
  type GovernanceDashboardDto,
  type GovernedItemDto,
  type MyTasksDto,
  type PublishedItemDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../common/auth-user';
import { ContentService } from './content.service';
import { ReviewsService } from './reviews.service';
import { WorkflowsService } from './workflows.service';
import { FeedbackService } from './feedback.service';

const processSelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  status: true,
  ownerId: true,
  nextReviewAt: true,
  updatedAt: true,
} satisfies Prisma.ProcessSelect;

const pageSelect = {
  id: true,
  spaceId: true,
  titleEn: true,
  titleAr: true,
  status: true,
  ownerId: true,
  nextReviewAt: true,
  updatedAt: true,
  space: { select: { ownerId: true } },
} satisfies Prisma.PageSelect;

type ProcessRow = Prisma.ProcessGetPayload<{ select: typeof processSelect }>;
type PageRow = Prisma.PageGetPayload<{ select: typeof pageSelect }>;

/** "My tasks" and the governance dashboard. */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly reviews: ReviewsService,
    private readonly workflows: WorkflowsService,
    private readonly notifications: NotificationsService,
    private readonly feedback: FeedbackService,
  ) {}

  private async items(processes: ProcessRow[], pages: PageRow[]): Promise<GovernedItemDto[]> {
    const settings = await this.workflows.settings();
    const now = new Date();
    const owners = await this.content.users([
      ...processes.map((p) => p.ownerId),
      ...pages.map((p) => p.ownerId ?? p.space.ownerId),
    ]);
    const published = await this.prisma.publication.findMany({
      where: {
        current: true,
        OR: [
          { entityType: 'PROCESS', entityId: { in: processes.map((p) => p.id) } },
          { entityType: 'PAGE', entityId: { in: pages.map((p) => p.id) } },
        ],
      },
      select: { entityType: true, entityId: true },
    });
    const live = new Set(published.map((p) => `${p.entityType}:${p.entityId}`));
    const state = (key: string, at: Date | null) =>
      live.has(key) ? reviewDateState(at, now, settings.reminderDays) : 'NONE';
    return [
      ...processes.map((p) => ({
        entityType: 'PROCESS' as const,
        entityId: p.id,
        titleEn: p.nameEn,
        titleAr: p.nameAr,
        code: p.code,
        status: p.status as ContentStatus,
        owner: p.ownerId ? (owners.get(p.ownerId) ?? null) : null,
        nextReviewAt: p.nextReviewAt?.toISOString() ?? null,
        reviewState: state(`PROCESS:${p.id}`, p.nextReviewAt),
        updatedAt: p.updatedAt.toISOString(),
      })),
      ...pages.map((p) => {
        const ownerId = p.ownerId ?? p.space.ownerId;
        return {
          entityType: 'PAGE' as const,
          entityId: p.id,
          titleEn: p.titleEn,
          titleAr: p.titleAr,
          spaceId: p.spaceId,
          status: p.status as ContentStatus,
          owner: ownerId ? (owners.get(ownerId) ?? null) : null,
          nextReviewAt: p.nextReviewAt?.toISOString() ?? null,
          reviewState: state(`PAGE:${p.id}`, p.nextReviewAt),
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
    ];
  }

  /** Published items whose next review date is before `until` (optionally owned by one user). */
  private async reviewDue(until: Date, from: Date | null, user: AuthUser, ownerId?: string) {
    const pubs = await this.prisma.publication.findMany({
      where: { current: true },
      select: { entityType: true, entityId: true },
    });
    const ids = (t: 'PROCESS' | 'PAGE') =>
      pubs.filter((p) => p.entityType === t).map((p) => p.entityId);
    const date = { lte: until, ...(from ? { gt: from } : {}) };
    const { spaceIds } = await this.content.readablePageFilter(user);
    const [processes, pages] = await Promise.all([
      this.prisma.process.findMany({
        where: {
          id: { in: ids('PROCESS') },
          deletedAt: null,
          status: { not: 'ARCHIVED' },
          nextReviewAt: date,
          ...(ownerId ? { ownerId } : {}),
        },
        select: processSelect,
        orderBy: { nextReviewAt: 'asc' },
      }),
      this.prisma.page.findMany({
        where: {
          id: { in: ids('PAGE') },
          deletedAt: null,
          status: { not: 'ARCHIVED' },
          nextReviewAt: date,
          space: { deletedAt: null },
          ...(ownerId
            ? { OR: [{ ownerId }, { ownerId: null, space: { ownerId } }] }
            : { spaceId: { in: spaceIds } }),
        },
        select: pageSelect,
        orderBy: { nextReviewAt: 'asc' },
      }),
    ]);
    return this.items(processes, pages);
  }

  async myTasks(user: AuthUser): Promise<MyTasksDto> {
    const settings = await this.workflows.settings();
    const now = new Date();
    const [taskRows, approvedProcesses, approvedPages, returnedRows, mentions, feedback] =
      await Promise.all([
        this.prisma.review.findMany({
          where: {
            status: 'IN_PROGRESS',
            tasks: { some: { assigneeId: user.id, status: 'PENDING' } },
          },
          include: { tasks: true },
          orderBy: { dueAt: 'asc' },
        }),
        this.prisma.process.findMany({
          where: { status: 'APPROVED', deletedAt: null },
          select: processSelect,
        }),
        this.prisma.page.findMany({
          where: { status: 'APPROVED', deletedAt: null, space: { deletedAt: null } },
          select: pageSelect,
        }),
        this.prisma.review.findMany({
          where: {
            submittedById: user.id,
            status: { in: ['CHANGES_REQUESTED', 'REJECTED'] },
            completedAt: { gte: addDays(now, -90) },
          },
          include: { tasks: true },
          orderBy: { completedAt: 'desc' },
        }),
        this.prisma.notification.findMany({
          where: { userId: user.id, type: 'MENTIONED', readAt: null, inApp: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.feedback.listAssigned(user),
      ]);

    const mine = taskRows.filter((r) =>
      r.tasks.some(
        (t) => t.assigneeId === user.id && t.status === 'PENDING' && t.stepIndex === r.currentStep,
      ),
    );

    // Approved items the user may publish (editors and managers of the item).
    const publishable: { process: ProcessRow[]; page: PageRow[] } = { process: [], page: [] };
    for (const p of approvedProcesses) {
      const item = await this.content.find('PROCESS', p.id, user);
      if (item && item.canRead && (item.canEdit || item.canManage)) publishable.process.push(p);
    }
    for (const p of approvedPages) {
      const item = await this.content.find('PAGE', p.id, user);
      if (item && item.canRead && (item.canEdit || item.canManage)) publishable.page.push(p);
    }

    // Returned submissions: only while that review is the item's latest and it is still a draft.
    const returned = [];
    for (const r of returnedRows) {
      const latest = await this.prisma.review.findFirst({
        where: { entityType: r.entityType, entityId: r.entityId },
        orderBy: { submittedAt: 'desc' },
        select: { id: true },
      });
      if (latest?.id !== r.id) continue;
      const item = await this.content.find(r.entityType, r.entityId, user);
      if (item?.status === 'DRAFT') returned.push(r);
    }

    return {
      reviews: await this.reviews.summaries(mine, user),
      toPublish: await this.items(publishable.process, publishable.page),
      returned: await this.reviews.summaries(returned, user),
      dueReviews: await this.reviewDue(addDays(now, settings.reminderDays), null, user, user.id),
      mentions: await this.notifications.toDtos(mentions),
      feedback,
    };
  }

  async dashboard(user: AuthUser): Promise<GovernanceDashboardDto> {
    const settings = await this.workflows.settings();
    const now = new Date();
    const { spaceIds } = await this.content.readablePageFilter(user);
    const [processCounts, pageCounts, inReview, recent, openFeedback] = await Promise.all([
      this.prisma.process.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.page.groupBy({
        by: ['status'],
        where: { deletedAt: null, space: { deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.review.findMany({
        where: { status: 'IN_PROGRESS' },
        include: { tasks: true },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.publication.findMany({
        where: { current: true },
        orderBy: { publishedAt: 'desc' },
        take: 30,
      }),
      this.prisma.feedback.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);
    const empty = () =>
      Object.fromEntries(CONTENT_STATUSES.map((s) => [s, 0])) as Record<ContentStatus, number>;
    const counts = { PROCESS: empty(), PAGE: empty() };
    for (const c of processCounts) counts.PROCESS[c.status as ContentStatus] = c._count._all;
    for (const c of pageCounts) counts.PAGE[c.status as ContentStatus] = c._count._all;

    const visibleSpaces = new Set(spaceIds);
    const pageSpace = new Map(
      (
        await this.prisma.page.findMany({
          where: {
            id: {
              in: [...inReview, ...recent]
                .filter((r) => r.entityType === 'PAGE')
                .map((r) => r.entityId),
            },
            deletedAt: null,
          },
          select: { id: true, spaceId: true },
        })
      ).map((p) => [p.id, p.spaceId]),
    );
    const liveProcesses = new Set(
      (
        await this.prisma.process.findMany({
          where: {
            id: {
              in: [...inReview, ...recent]
                .filter((r) => r.entityType === 'PROCESS')
                .map((r) => r.entityId),
            },
            deletedAt: null,
          },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const readable = (r: { entityType: string; entityId: string }) =>
      r.entityType === 'PROCESS'
        ? liveProcesses.has(r.entityId)
        : visibleSpaces.has(pageSpace.get(r.entityId) ?? '');

    const reviews = await this.reviews.summaries(inReview.filter(readable));
    const recentItems = recent.filter(readable).slice(0, 10);
    const recentDtos = await this.items(
      await this.prisma.process.findMany({
        where: {
          id: { in: recentItems.filter((r) => r.entityType === 'PROCESS').map((r) => r.entityId) },
        },
        select: processSelect,
      }),
      await this.prisma.page.findMany({
        where: {
          id: { in: recentItems.filter((r) => r.entityType === 'PAGE').map((r) => r.entityId) },
        },
        select: pageSelect,
      }),
    );
    const byKey = new Map(recentDtos.map((d) => [`${d.entityType}:${d.entityId}`, d]));
    const recentlyPublished: PublishedItemDto[] = recentItems.flatMap((r) => {
      const d = byKey.get(`${r.entityType}:${r.entityId}`);
      return d
        ? [
            {
              ...d,
              versionNumber: r.versionNumber,
              versionLabel: r.versionLabel,
              publishedAt: r.publishedAt.toISOString(),
            },
          ]
        : [];
    });

    return {
      counts,
      inReview: reviews.map((r) => ({
        ...r,
        days: Math.floor((now.getTime() - new Date(r.submittedAt).getTime()) / 86_400_000),
      })),
      overdueReviews: await this.reviewDue(now, null, user),
      dueSoon: await this.reviewDue(addDays(now, settings.reminderDays), now, user),
      recentlyPublished,
      openFeedback,
    };
  }
}
