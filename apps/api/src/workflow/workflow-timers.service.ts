import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  MAX_TIMER_REPEAT,
  MIN_TIMER_CYCLE_MINUTES,
  MIN_TIMER_DURATION_MINUTES,
  parseCycle,
  parseIsoDurationMinutes,
  timerStarts,
  type WfNode,
  type WorkflowModel,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowSettingsService } from './workflow-settings.service';

type Client = PrismaService | Prisma.TransactionClient;

export interface TimerSchedule {
  dueAt: Date;
  /** Cycle timers: repetitions left after this one (null = unlimited). */
  cycle: { minutes: number; left: number | null } | null;
}

/**
 * Due times of timer events (ISO 8601 duration / date / cycle; durations in working time when the
 * event says so) and the jobs of timer start events (D-148).
 */
@Injectable()
export class WorkflowTimersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WorkflowSettingsService,
  ) {}

  async schedule(node: WfNode, from: Date): Promise<TimerSchedule | null> {
    const t = node.timer;
    if (!t) return null;
    if (t.kind === 'date') {
      const d = Date.parse(t.value);
      return Number.isNaN(d) ? null : { dueAt: new Date(Math.max(d, from.getTime())), cycle: null };
    }
    if (t.kind === 'duration') {
      const minutes = parseIsoDurationMinutes(t.value);
      if (minutes === null) return null;
      return {
        dueAt: await this.add(
          from,
          Math.max(minutes, MIN_TIMER_DURATION_MINUTES),
          node.exec.workingTime,
        ),
        cycle: null,
      };
    }
    const parsed = parseCycle(t.value);
    if (!parsed) return null;
    // Deployed models from before the deploy check existed are clamped too (SEC-29).
    const c = {
      ...parsed,
      minutes: Math.max(parsed.minutes, MIN_TIMER_CYCLE_MINUTES),
      repeat: parsed.repeat === null ? null : Math.min(parsed.repeat, MAX_TIMER_REPEAT),
    };
    let due =
      c.start && c.start > from ? c.start : await this.add(from, c.minutes, node.exec.workingTime);
    if (c.start && c.start <= from) {
      // Next occurrence after now on the cycle that began at `start`.
      const step = c.minutes * 60_000;
      const n = Math.ceil((from.getTime() - c.start.getTime()) / step);
      due = new Date(c.start.getTime() + Math.max(1, n) * step);
    }
    return {
      dueAt: due,
      cycle: { minutes: c.minutes, left: c.repeat === null ? null : c.repeat - 1 },
    };
  }

  async add(from: Date, minutes: number, working: boolean): Promise<Date> {
    if (!working) return new Date(from.getTime() + minutes * 60_000);
    return (await this.settings.calendar()).addWorkingMinutes(from, minutes);
  }

  /** One pending START_TIMER job per timer start event of the active deployment. */
  async scheduleStartTimers(
    definitionId: string,
    model: WorkflowModel,
    client: Client = this.prisma,
  ) {
    const def = await client.workflowDefinition.findUniqueOrThrow({
      where: { id: definitionId },
      select: { processId: true },
    });
    for (const n of timerStarts(model)) {
      const exists = await client.workflowJob.findFirst({
        where: {
          kind: 'START_TIMER',
          definitionId,
          elementId: n.id,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        select: { id: true },
      });
      if (exists) continue;
      const s = await this.schedule(n, new Date());
      if (!s) continue;
      await client.workflowJob.create({
        data: {
          kind: 'START_TIMER',
          definitionId,
          elementId: n.id,
          dueAt: s.dueAt,
          data: { processId: def.processId, cycle: s.cycle } as Prisma.InputJsonValue,
        },
      });
    }
  }

  async cancelStartTimers(processId: string, client: Client = this.prisma) {
    const defs = await client.workflowDefinition.findMany({
      where: { processId },
      select: { id: true },
    });
    await client.workflowJob.updateMany({
      where: {
        kind: 'START_TIMER',
        definitionId: { in: defs.map((d) => d.id) },
        status: 'PENDING',
      },
      data: { status: 'CANCELLED' },
    });
  }
}
