import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type MiningJob } from '@prisma/client';
import type { MiningJobDto, MiningJobKind } from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { PrismaService } from '../../prisma/prisma.service';
import { notFound } from '../../common/app-exception';
import { MiningSettingsService } from '../mining-settings.service';
import { MiningAbortError, runInWorker, type WorkerOptions } from './worker-runner';
import type { MiningTaskName } from '@processhub/shared';

/** What a job handler gets: progress reporting, the abort signal and a worker helper. */
export interface JobContext {
  job: MiningJob;
  signal: AbortSignal;
  /** Throttled (≤ 2 writes per second); also throws when the job was cancelled. */
  progress(value: number, message?: string): Promise<void>;
  /** Runs a shared mining task in a worker thread, forwarding progress into `[from, to]`. */
  worker<T>(task: MiningTaskName, input: unknown, range?: [number, number]): Promise<T>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export interface EnqueueInput {
  kind: MiningJobKind;
  logId?: string | null;
  scenarioId?: string | null;
  params?: unknown;
  userId?: string | null;
}

export const toJobDto = (j: MiningJob): MiningJobDto => ({
  id: j.id,
  kind: j.kind as MiningJobKind,
  status: j.status,
  progress: j.progress,
  message: j.message,
  logId: j.logId,
  scenarioId: j.scenarioId,
  result: j.result ?? null,
  error: j.error,
  createdAt: j.createdAt.toISOString(),
  startedAt: j.startedAt?.toISOString() ?? null,
  finishedAt: j.finishedAt?.toISOString() ?? null,
});

/**
 * In-process job queue for mining work (D-128): jobs are rows of `MiningJob`, executed one or two at
 * a time (Setting `mining.concurrency`) outside the HTTP request. Handlers do async I/O in chunks
 * and CPU work in worker threads. Cancel aborts the running handler; jobs interrupted by a restart
 * are marked failed at start-up.
 */
@Injectable()
export class MiningJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MiningJobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly running = new Map<string, AbortController>();
  private readonly waiters = new Map<string, (() => void)[]>();
  private pumping = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MiningSettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    await this.prisma.miningJob.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', error: 'INTERRUPTED', finishedAt: new Date() },
    });
    await this.prisma.eventLog.updateMany({
      where: { status: 'IMPORTING' },
      data: { status: 'FAILED' },
    });
  }

  onModuleDestroy() {
    this.stopped = true;
    for (const c of this.running.values()) c.abort();
  }

  register(kind: MiningJobKind, handler: JobHandler) {
    this.handlers.set(kind, handler);
  }

  async enqueue(input: EnqueueInput): Promise<MiningJob> {
    const job = await this.prisma.miningJob.create({
      data: {
        kind: input.kind,
        logId: input.logId ?? null,
        scenarioId: input.scenarioId ?? null,
        params: (input.params ?? undefined) as Prisma.InputJsonValue | undefined,
        createdById: input.userId ?? null,
      },
    });
    void this.pump();
    return job;
  }

  async get(id: string): Promise<MiningJob> {
    const job = await this.prisma.miningJob.findUnique({ where: { id } });
    if (!job) throw notFound('Job');
    return job;
  }

  /** Waits until the job has finished or `ms` passed; returns the current row. */
  async wait(id: string, ms: number): Promise<MiningJob> {
    const job = await this.get(id);
    if (['DONE', 'FAILED', 'CANCELLED'].includes(job.status) || ms <= 0) return job;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      const list = this.waiters.get(id) ?? [];
      list.push(done);
      this.waiters.set(id, list);
      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
    return this.get(id);
  }

  async cancel(id: string): Promise<MiningJob> {
    const job = await this.get(id);
    if (job.status === 'QUEUED') {
      const res = await this.prisma.miningJob.updateMany({
        where: { id, status: 'QUEUED' },
        data: { status: 'CANCELLED', finishedAt: new Date(), cancelRequested: true },
      });
      if (res.count) this.notify(id);
    } else if (job.status === 'RUNNING') {
      await this.prisma.miningJob.update({ where: { id }, data: { cancelRequested: true } });
      this.running.get(id)?.abort();
    }
    return this.get(id);
  }

  private notify(id: string) {
    for (const fn of this.waiters.get(id) ?? []) fn();
    this.waiters.delete(id);
  }

  /** Starts queued jobs while there is capacity (oldest first). */
  private async pump(): Promise<void> {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      const { concurrency } = await this.settings.get();
      while (this.running.size < concurrency && !this.stopped) {
        const next = await this.prisma.miningJob.findFirst({
          where: { status: 'QUEUED' },
          orderBy: { createdAt: 'asc' },
        });
        if (!next) break;
        const claimed = await this.prisma.miningJob.updateMany({
          where: { id: next.id, status: 'QUEUED' },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
        if (!claimed.count) continue;
        const controller = new AbortController();
        this.running.set(next.id, controller);
        void this.execute({ ...next, status: 'RUNNING' }, controller).finally(() => {
          this.running.delete(next.id);
          this.notify(next.id);
          void this.pump();
        });
      }
    } catch (e) {
      this.logger.error(`Mining job queue: ${(e as Error).message}`);
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: MiningJob, controller: AbortController) {
    const handler = this.handlers.get(job.kind);
    let last = 0;
    let lastValue = 0;
    const ctx: JobContext = {
      job,
      signal: controller.signal,
      progress: async (value, message) => {
        if (controller.signal.aborted) throw new MiningAbortError();
        lastValue = value;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        await this.prisma.miningJob.update({
          where: { id: job.id },
          data: { progress: Math.max(0, Math.min(1, value)), message: message ?? '' },
        });
      },
      worker: (task, input, range = [lastValue, 1]) =>
        runInWorker(task, input, {
          signal: controller.signal,
          useWorker: this.config.MINING_WORKERS,
          onProgress: (v, m) =>
            void ctx.progress(range[0] + (range[1] - range[0]) * v, m).catch(() => undefined),
        } satisfies WorkerOptions),
    };
    try {
      if (!handler) throw new Error(`No handler for mining job ${job.kind}`);
      const result = await handler(ctx);
      await this.prisma.miningJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          progress: 1,
          result: (result ?? undefined) as Prisma.InputJsonValue | undefined,
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      const cancelled = e instanceof MiningAbortError || controller.signal.aborted;
      if (!cancelled)
        this.logger.warn(`Mining job ${job.kind} ${job.id} failed: ${(e as Error).message}`);
      await this.prisma.miningJob
        .update({
          where: { id: job.id },
          data: {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            error: cancelled ? null : ((e as Error).message || 'FAILED').slice(0, 2000),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }
}
