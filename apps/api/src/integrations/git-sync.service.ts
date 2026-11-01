import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  removalCommitMessage,
  type GitEntityType,
  type GitErrorCode,
  type GitSyncItemDto,
  type GitSyncNowInput,
  type GitSyncStatus,
  type GitSyncStatusDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DomainEvents, type DomainEvent } from '../events/domain-events';
import { notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';
import { GitSettingsService, scrubToken, type StoredGitSettings } from './git-settings.service';
import { GitProviders } from './git-providers';
import { GitExportService, type ExportItem } from './git-export.service';
import { GitError, gitBlobSha, type GitConnection, type GitUpsert } from './providers/types';

export interface SyncTarget {
  entityType: GitEntityType;
  entityId: string;
}

const key = (t: SyncTarget) => `${t.entityType}:${t.entityId}`;

/**
 * One-way sync ProcessHub → Git. Jobs run one at a time in this process; every job
 * produces at most one commit. When the integration is disabled nothing happens at all.
 */
@Injectable()
export class GitSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GitSyncService.name);
  private queue: Promise<void> = Promise.resolve();
  private running = 0;
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly settings: GitSettingsService,
    private readonly providers: GitProviders,
    private readonly exporter: GitExportService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.on((e) => this.onEvent(e));
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  /** Resolves when every queued job has finished (used by tests and graceful shutdown). */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  private targetsFor(e: DomainEvent, s: StoredGitSettings): SyncTarget[] {
    switch (e.type) {
      case 'process.versioned':
      case 'process.removed':
        return s.syncProcesses ? [{ entityType: 'PROCESS', entityId: e.processId }] : [];
      case 'page.versioned':
        return s.syncPages ? [{ entityType: 'PAGE', entityId: e.pageId }] : [];
      case 'page.removed':
      case 'page.restored':
        return s.syncPages
          ? e.pageIds.map((id) => ({ entityType: 'PAGE' as const, entityId: id }))
          : [];
      case 'content.published':
      case 'content.unpublished':
        // Diagrams are not synced to Git in this phase (BACKLOG).
        if (e.entityType === 'DIAGRAM') return [];
        return (e.entityType === 'PROCESS' ? s.syncProcesses : s.syncPages)
          ? [{ entityType: e.entityType, entityId: e.entityId }]
          : [];
      case 'integration':
        return [];
    }
  }

  async onEvent(e: DomainEvent): Promise<void> {
    if (e.type === 'integration') return;
    const s = await this.settings.get();
    if (!s.enabled) return;
    const targets = this.targetsFor(e, s);
    if (!targets.length) return;
    // Removals of items that were never synced need no commit.
    const relevant =
      e.type === 'process.removed' || e.type === 'page.removed'
        ? await this.tracked(targets)
        : targets;
    if (!relevant.length) return;
    await this.markPending(relevant);
    if (s.trigger === 'ON_VERSION') void this.enqueue(relevant, e.actorId);
  }

  private async tracked(targets: SyncTarget[]): Promise<SyncTarget[]> {
    const rows = await this.prisma.gitSyncItem.findMany({
      where: { OR: targets.map((t) => ({ entityType: t.entityType, entityId: t.entityId })) },
      select: { entityType: true, entityId: true },
    });
    return rows;
  }

  private async markPending(targets: SyncTarget[]) {
    await this.prisma.gitSyncItem.createMany({
      data: targets.map((t) => ({ ...t, status: 'PENDING' as const })),
      skipDuplicates: true,
    });
    await this.prisma.gitSyncItem.updateMany({
      where: { OR: targets.map((t) => ({ entityType: t.entityType, entityId: t.entityId })) },
      data: { status: 'PENDING' },
    });
  }

  enqueue(targets: SyncTarget[], actorId: string | null, bulk = false): Promise<void> {
    this.running++;
    const job = this.queue
      .then(() => this.run(targets, actorId, bulk))
      .catch((err: Error) => this.logger.error(`Git sync failed: ${err.message}`))
      .finally(() => this.running--);
    this.queue = job;
    return job;
  }

  /** "Sync now": reconciles every process and page (or one kind) in a single commit. */
  async syncNow(input: GitSyncNowInput, actor: AuthUser) {
    const s = await this.settings.get();
    if (!s.enabled) return { queued: 0 };
    const targets: SyncTarget[] = [];
    const processes = s.syncProcesses && input.scope !== 'pages';
    const pages = s.syncPages && input.scope !== 'processes';
    if (processes) {
      const rows = await this.prisma.process.findMany({
        where: { deletedAt: null, versions: { some: {} } },
        select: { id: true },
      });
      targets.push(...rows.map((r) => ({ entityType: 'PROCESS' as const, entityId: r.id })));
    }
    if (pages) {
      const rows = await this.prisma.page.findMany({
        where: { deletedAt: null, space: { deletedAt: null } },
        select: { id: true },
      });
      targets.push(...rows.map((r) => ({ entityType: 'PAGE' as const, entityId: r.id })));
    }
    // Items synced earlier whose entity is gone are removed from the repository.
    const known = new Set(targets.map(key));
    const tracked = await this.prisma.gitSyncItem.findMany({
      where: {
        entityType: {
          in: [...(processes ? ['PROCESS' as const] : []), ...(pages ? ['PAGE' as const] : [])],
        },
      },
      select: { entityType: true, entityId: true },
    });
    targets.push(...tracked.filter((t) => !known.has(key(t))));
    if (!targets.length) return { queued: 0 };
    await this.markPending(targets);
    void this.enqueue(targets, actor.id, true);
    return { queued: targets.length };
  }

  async retry(itemId: string, actor: AuthUser) {
    const row = await this.prisma.gitSyncItem.findUnique({ where: { id: itemId } });
    if (!row) throw notFound('Sync item');
    const target = { entityType: row.entityType, entityId: row.entityId };
    await this.markPending([target]);
    void this.enqueue([target], actor.id);
    return this.status();
  }

  private async author(actorId: string | null) {
    const u = actorId
      ? await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { email: true, nameEn: true, nameAr: true },
        })
      : null;
    return u
      ? { name: u.nameEn || u.nameAr || u.email, email: u.email }
      : { name: 'ProcessHub', email: 'processhub@localhost' };
  }

  private build(t: SyncTarget, s: StoredGitSettings): Promise<ExportItem | null> {
    return t.entityType === 'PROCESS'
      ? this.exporter.process(t.entityId, s.folder, s.publishedOnly)
      : this.exporter.page(t.entityId, s.folder, s.publishedOnly);
  }

  private async run(targets: SyncTarget[], actorId: string | null, bulk: boolean) {
    const s = await this.settings.get();
    if (!s.enabled) return;
    const attemptAt = new Date();
    let conn: GitConnection | null = null;
    try {
      conn = this.settings.connection(s);
      const rows = await this.prisma.gitSyncItem.findMany({
        where: { OR: targets.map((t) => ({ entityType: t.entityType, entityId: t.entityId })) },
      });
      const rowByKey = new Map(rows.map((r) => [key(r), r]));
      const exports = new Map<string, ExportItem | null>();
      const wanted = new Map<string, string>();
      for (const t of targets) {
        const item = await this.build(t, s);
        exports.set(key(t), item);
        for (const f of item?.files ?? []) wanted.set(f.path, f.content);
      }
      const stale = new Set<string>();
      for (const t of targets) {
        for (const p of rowByKey.get(key(t))?.paths ?? []) if (!wanted.has(p)) stale.add(p);
      }

      const client = this.providers.client(conn.provider);
      const listing = await client.listFiles(conn, s.folder);
      const upserts: GitUpsert[] = [...wanted]
        .filter(([path, content]) => listing.files.get(path) !== gitBlobSha(content))
        .map(([path, content]) => ({ path, content, exists: listing.files.has(path) }));
      const deletes = [...stale].filter((p) => !listing.complete || listing.files.has(p));

      let commit: { sha: string; url: string | null } | null = null;
      if (upserts.length || deletes.length) {
        commit = await client.commit(conn, {
          message: this.message(targets, exports, bulk),
          author: await this.author(actorId),
          upserts,
          deletes,
        });
      }

      await this.prisma.$transaction(async (tx) => {
        for (const t of targets) {
          const item = exports.get(key(t));
          if (!item) {
            await tx.gitSyncItem.deleteMany({
              where: { entityType: t.entityType, entityId: t.entityId },
            });
            continue;
          }
          const prev = rowByKey.get(key(t));
          await tx.gitSyncItem.upsert({
            where: { entityType_entityId: { entityType: t.entityType, entityId: t.entityId } },
            create: {
              ...t,
              status: 'SUCCESS',
              version: item.version,
              paths: item.files.map((f) => f.path),
              commitSha: commit?.sha ?? null,
              commitUrl: commit?.url ?? null,
              lastAttemptAt: attemptAt,
              lastSuccessAt: new Date(),
            },
            update: {
              status: 'SUCCESS',
              version: item.version,
              paths: item.files.map((f) => f.path),
              errorCode: null,
              errorMessage: null,
              commitSha: commit?.sha ?? prev?.commitSha ?? null,
              commitUrl: commit?.url ?? prev?.commitUrl ?? null,
              lastAttemptAt: attemptAt,
              lastSuccessAt: new Date(),
            },
          });
        }
        await this.audit.log(
          {
            action: 'SYNC',
            entityType: 'Integration',
            entityId: 'git',
            userId: actorId,
            summary: {
              status: 'SUCCESS',
              items: targets.length,
              filesChanged: upserts.length,
              filesRemoved: deletes.length,
              commit: commit?.sha ?? null,
            },
          },
          tx,
        );
      });
    } catch (err) {
      const code: GitErrorCode = err instanceof GitError ? err.code : 'GIT_UNKNOWN';
      const message = scrubToken((err as Error).message ?? String(err), conn?.token).slice(0, 500);
      this.logger.warn(`Git sync failed (${code}): ${message}`);
      await this.prisma.gitSyncItem.updateMany({
        where: { OR: targets.map((t) => ({ entityType: t.entityType, entityId: t.entityId })) },
        data: {
          status: 'FAILED',
          errorCode: code,
          errorMessage: message,
          lastAttemptAt: attemptAt,
        },
      });
      await this.audit.log({
        action: 'SYNC',
        entityType: 'Integration',
        entityId: 'git',
        userId: actorId,
        summary: { status: 'FAILED', items: targets.length, errorCode: code, error: message },
      });
    }
  }

  private message(targets: SyncTarget[], exports: Map<string, ExportItem | null>, bulk: boolean) {
    if (!bulk && targets.length === 1) {
      const t = targets[0];
      const item = exports.get(key(t));
      if (item) return item.message;
      return removalCommitMessage({
        kind: t.entityType === 'PROCESS' ? 'process' : 'page',
        title: t.entityId,
      });
    }
    const count = (type: GitEntityType) =>
      targets.filter((t) => t.entityType === type && exports.get(key(t))).length;
    const removed = targets.filter((t) => !exports.get(key(t))).length;
    const parts = [`${count('PROCESS')} processes`, `${count('PAGE')} pages`];
    if (removed) parts.push(`${removed} removed`);
    return `Sync from ProcessHub: ${parts.join(', ')}`;
  }

  async status(): Promise<GitSyncStatusDto> {
    const s = await this.settings.get();
    const rows = await this.prisma.gitSyncItem.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    });
    const ids = (type: GitEntityType) =>
      rows.filter((r) => r.entityType === type).map((r) => r.entityId);
    const [processes, pages, grouped, last] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: ids('PROCESS') } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.page.findMany({
        where: { id: { in: ids('PAGE') } },
        select: { id: true, titleEn: true, titleAr: true, spaceId: true },
      }),
      this.prisma.gitSyncItem.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.gitSyncItem.aggregate({ _max: { lastAttemptAt: true, lastSuccessAt: true } }),
    ]);
    const processById = new Map(processes.map((p) => [p.id, p]));
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const counts: Record<GitSyncStatus, number> = { PENDING: 0, SUCCESS: 0, FAILED: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    const items: GitSyncItemDto[] = rows.map((r) => {
      const proc = r.entityType === 'PROCESS' ? processById.get(r.entityId) : undefined;
      const page = r.entityType === 'PAGE' ? pageById.get(r.entityId) : undefined;
      return {
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        title: proc
          ? { nameEn: proc.nameEn, nameAr: proc.nameAr, code: proc.code }
          : page
            ? { nameEn: page.titleEn, nameAr: page.titleAr, spaceId: page.spaceId }
            : null,
        status: r.status,
        version: r.version,
        paths: r.paths,
        errorCode: (r.errorCode as GitErrorCode | null) ?? null,
        errorMessage: r.errorMessage,
        commitSha: r.commitSha,
        commitUrl: r.commitUrl,
        lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      };
    });
    return {
      enabled: s.enabled,
      lastSyncAt: last._max.lastAttemptAt?.toISOString() ?? null,
      lastSuccessAt: last._max.lastSuccessAt?.toISOString() ?? null,
      running: this.running > 0,
      counts,
      items,
    };
  }
}
