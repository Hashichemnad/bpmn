/**
 * Scheduler / job runner check on a volume database (final session, part A): runs every periodic
 * task twice and reports the time and the notifications each run created. The second run must
 * create none (dedupe keys): no duplicate reminders when runs overlap or the API restarts.
 *
 *   DATABASE_URL=… JWT_ACCESS_SECRET=… npx ts-node --transpile-only prisma/perf-schedulers.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GovernanceScheduler } from '../src/governance/scheduler.service';
import { AssuranceScheduler } from '../src/assurance/assurance-scheduler.service';
import { KpiScheduler } from '../src/kpi/kpi-scheduler.service';
import { MiningScheduler } from '../src/mining/mining-scheduler.service';
import { WorkflowJobsService } from '../src/workflow/workflow-jobs.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tasks: [string, () => Promise<unknown>][] = [
    ['Governance reminders', () => app.get(GovernanceScheduler).runOnce()],
    ['Assurance reminders', () => app.get(AssuranceScheduler).runOnce()],
    ['KPI scheduler', () => app.get(KpiScheduler).runOnce()],
    ['Mining scheduler', () => app.get(MiningScheduler).runOnce()],
    ['Workflow jobs (due timers)', () => app.get(WorkflowJobsService).runDue()],
  ];
  console.log('| Task | Run 1 ms | Notifications | Run 2 ms | Notifications |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const [label, run] of tasks) {
    const cells: string[] = [];
    for (let i = 0; i < 2; i++) {
      const before = await prisma.notification.count();
      const t = performance.now();
      await run();
      cells.push(
        `${(performance.now() - t).toFixed(0)}`,
        `${(await prisma.notification.count()) - before}`,
      );
    }
    console.log(`| ${label} | ${cells.join(' | ')} |`);
  }
  await app.close();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
