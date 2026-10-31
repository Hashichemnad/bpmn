/* eslint-disable no-console */
/**
 * Workflow execution load measurement (Phase 5.2, D-153): 500 users, N open requests (default 10,000), then
 * timings of the hot paths — start, inbox, task completion, monitor, dashboard, the job poll.
 *
 *   createdb processhub_perf
 *   DATABASE_URL=postgresql://…/processhub_perf npx prisma migrate deploy
 *   DATABASE_URL=postgresql://…/processhub_perf JWT_ACCESS_SECRET=… WORKFLOW_POLL_SECONDS=0 \
 *     SCHEDULER_INTERVAL_MINUTES=0 npx ts-node --transpile-only prisma/perf-workflow.ts 10000
 *
 * Never run it against real data: it creates users, a process and thousands of requests.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient, type Prisma } from '@prisma/client';
import { readWorkflowModel, SYSTEM_ROLES, type Permission } from '@processhub/shared';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/common/auth-user';
import { WorkflowCasesService } from '../src/workflow/workflow-cases.service';
import { WorkflowTasksService } from '../src/workflow/workflow-tasks.service';
import { WorkflowMonitorService } from '../src/workflow/workflow-monitor.service';
import { WorkflowJobsService } from '../src/workflow/workflow-jobs.service';
import { syncRolesAndPermissions } from './seed';
import { leaveRequestXml } from './workflow-demo';

const N = Number(process.argv[2] ?? 10_000);
const USERS = 500;
const prisma = new PrismaClient();

const auth = (
  u: { id: string; email: string; departmentId: string | null },
  role: 'VIEWER' | 'ADMIN',
): AuthUser => ({
  id: u.id,
  email: u.email,
  nameEn: u.email,
  nameAr: '',
  locale: 'en',
  departmentId: u.departmentId,
  roles: [role],
  permissions: new Set<Permission>(SYSTEM_ROLES[role].permissions),
  hasPassword: true,
  ssoLinked: false,
  mfaEnabled: false,
});

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = process.hrtime.bigint();
  const r = await fn();
  console.log(`${label}: ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)} ms`);
  return r;
}

async function main() {
  if ((await prisma.workflowCase.count()) > 0) throw new Error('Use an empty perf database');
  await syncRolesAndPermissions(prisma);
  const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
  // 25 departments of 20 users; the first user of each department is its manager.
  const deps = [];
  for (let d = 0; d < USERS / 20; d++)
    deps.push(await prisma.department.create({ data: { nameEn: `Dept ${d}` } }));
  const users: { id: string; email: string; departmentId: string | null }[] = [];
  for (let i = 0; i < USERS; i++) {
    const dep = deps[Math.floor(i / 20)];
    users.push(
      await prisma.user.create({
        data: {
          email: `user${i}@perf.local`,
          nameEn: `User ${i}`,
          passwordHash: '',
          departmentId: dep.id,
          roles: { create: [{ roleId: viewerRole.id }] },
        },
        select: { id: true, email: true, departmentId: true },
      }),
    );
  }
  for (let d = 0; d < deps.length; d++)
    await prisma.department.update({
      where: { id: deps[d].id },
      data: { managerId: users[d * 20].id },
    });
  const hr = await prisma.repoObject.create({ data: { type: 'ROLE', nameEn: 'HR Officer' } });
  for (let i = 0; i < 5; i++)
    await prisma.userJobRole.create({
      data: { userId: users[i * 20 + 1].id, repoObjectId: hr.id },
    });
  const xml = leaveRequestXml(hr.id);
  const proc = await prisma.process.create({
    data: {
      code: 'HR-01',
      nameEn: 'Leave request',
      category: 'SUPPORT',
      status: 'PUBLISHED',
      ownerId: users[1].id,
      departmentId: deps[0].id,
    },
  });
  await prisma.workflowProcessConfig.create({
    data: { processId: proc.id, enabled: true, casePrefix: 'LEAVE', eventLog: true },
  });
  const def = await prisma.workflowDefinition.create({
    data: {
      processId: proc.id,
      versionNumber: 1,
      bpmnXml: xml,
      model: readWorkflowModel(xml) as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.workflowProcessConfig.update({
    where: { processId: proc.id },
    data: { activeDefinitionId: def.id },
  });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const cases = app.get(WorkflowCasesService);
  const tasks = app.get(WorkflowTasksService);
  const monitor = app.get(WorkflowMonitorService);
  const jobs = app.get(WorkflowJobsService);
  const meta = { ip: null, userAgent: 'perf' };
  const data = (i: number) => ({
    leaveType: 'annual',
    firstDay: '2026-12-01',
    days: (i % 15) + 1,
    reason: 'Perf',
  });

  const requesters = users.filter((_, idx) => idx % 20 !== 0);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    // Requesters are the non-managers; their manager gets the approval task.
    const u = requesters[i % requesters.length];
    await cases.start(proc.id, data(i), [], auth(u, 'VIEWER'), meta);
    if ((i + 1) % 2000 === 0)
      console.log(
        `  started ${i + 1} (${(((Date.now() - t0) / (i + 1)) as number).toFixed(1)} ms / request)`,
      );
  }
  const startMs = (Date.now() - t0) / N;
  console.log(`start: ${startMs.toFixed(1)} ms per request (${N} requests)`);

  const manager = users[0];
  const mgr = auth(manager, 'VIEWER');
  const admin = auth(users[2], 'ADMIN');
  const open = await prisma.workflowTask.count({ where: { status: 'OPEN' } });
  console.log(
    `open tasks: ${open}; tasks of one manager: ${await prisma.workflowTask.count({ where: { status: 'OPEN', assigneeId: manager.id } })}`,
  );
  await time('inbox (manager, first page)', () =>
    tasks.list({ scope: 'mine', page: 1, pageSize: 20, order: 'asc' }, mgr),
  );
  await time('inbox counts', () => tasks.counts(mgr));
  await time('my requests (requester)', () =>
    cases.list(
      { scope: 'mine', page: 1, pageSize: 20, order: 'desc', stuck: undefined },
      auth(users[5], 'VIEWER'),
    ),
  );
  await time('monitor (admin, all processes)', () => monitor.monitor(admin));
  await time('monitor case list (admin, page 1)', () =>
    cases.list({ scope: 'monitor', page: 1, pageSize: 20, order: 'desc', stuck: undefined }, admin),
  );
  await time('dashboard (admin, 90 days)', () => monitor.dashboard({ period: 'week' }, admin));
  await time('job poll with nothing due', () => jobs.runDue());

  // 500 completions (approvals by the managers) — the hourly peak in a few seconds.
  const toDo = await prisma.workflowTask.findMany({
    where: { status: 'OPEN', elementId: 'ManagerApproval' },
    take: 500,
    include: { case: true },
  });
  const t1 = Date.now();
  for (const t of toDo) {
    const u = users.find((x) => x.id === t.assigneeId)!;
    await tasks.complete(
      t.id,
      { data: {}, decision: 'APPROVE', comment: '', version: t.version },
      auth(u, 'VIEWER'),
      meta,
    );
  }
  console.log(
    `complete: ${((Date.now() - t1) / toDo.length).toFixed(1)} ms per task (${toDo.length} approvals incl. gateway, set data, notification, live event log)`,
  );
  await time('case detail', () => cases.detail(toDo[0].caseId, admin));
  await app.close();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
