import request from 'supertest';
import { MiningJobsService } from '../src/mining/jobs/mining-jobs.service';
import { SubscriptionsService } from '../src/scheduled-reports/subscriptions.service';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

describe('Scheduled report e-mails (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;
  let perf: Client;
  let viewer: Client;
  let subs: SubscriptionsService;
  let perfId: string;
  let viewerId: string;
  let deptId: string;

  beforeAll(async () => {
    ctx = await createApp();
    subs = ctx.app.get(SubscriptionsService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.sent = [];
    deptId = (
      await ctx.prisma.department.create({ data: { nameEn: 'Strategy', nameAr: 'الاستراتيجية' } })
    ).id;
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    perfId = (
      await createUser(ctx.prisma, 'perf@test.local', ['PERFORMANCE_OFFICER'], {
        departmentId: deptId,
      })
    ).id;
    viewerId = (
      await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER'], { departmentId: deptId })
    ).id;
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
    perf = await loggedIn(ctx.app, 'perf@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await superAdmin
      .put('/settings/email')
      .send({
        enabled: true,
        host: 'mailpit',
        port: 1025,
        fromAddress: 'hub@test.local',
        fromName: 'Hub',
        username: '',
        password: '',
      })
      .expect(200);
    const kpi = await ctx.prisma.repoObject.create({
      data: {
        type: 'KPI',
        code: 'KPI-01',
        nameEn: 'Requests on time',
        nameAr: 'الطلبات في الوقت',
        kpi: {
          create: {
            unit: '%',
            target: 95,
            redThreshold: 80,
            status: 'ACTIVE',
            departmentId: deptId,
          },
        },
      },
    });
    await ctx.prisma.kpiMeasurement.create({
      data: { kpiId: kpi.id, period: '2026-09', periodStart: new Date('2026-09-01'), value: 70 },
    });
    ctx.renderer.calls = [];
  });

  const kpiSub = (over: Record<string, unknown> = {}) => ({
    name: 'Weekly KPIs',
    report: 'KPI_DASHBOARD',
    format: 'LINK',
    frequency: 'WEEKLY',
    weekday: 7,
    time: '07:00',
    ...over,
  });

  it('users subscribe themselves to reports they may see; groups need an Admin', async () => {
    const created = (await perf.post('/report-subscriptions').send(kpiSub()).expect(201)).body;
    expect(created).toMatchObject({ audience: 'SELF', canEdit: true, owner: { id: perfId } });
    // Next Sunday 07:00 Dubai = 03:00 UTC.
    expect(new Date(created.nextRunAt).getUTCDay()).toBe(0);
    expect(created.nextRunAt).toMatch(/T03:00:00\.000Z$/);
    await viewer.post('/report-subscriptions').send(kpiSub()).expect(403);
    await perf
      .post('/report-subscriptions')
      .send(kpiSub({ audience: 'DEPARTMENT', audienceDepartmentId: deptId }))
      .expect(403);
    const group = (
      await admin
        .post('/report-subscriptions')
        .send(
          kpiSub({ name: 'Strategy KPIs', audience: 'DEPARTMENT', audienceDepartmentId: deptId }),
        )
        .expect(201)
    ).body;
    // The department's members see it (not editable for them); others do not.
    const mine = (await perf.get('/report-subscriptions').expect(200)).body as {
      id: string;
      canEdit: boolean;
    }[];
    expect(mine.map((s) => s.id).sort()).toEqual([created.id, group.id].sort());
    expect(mine.find((s) => s.id === group.id)?.canEdit).toBe(false);
    await perf.put(`/report-subscriptions/${group.id}`).send(kpiSub()).expect(403);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'ReportSubscription' },
    });
    expect(audit.map((a) => a.action)).toEqual(['CREATE', 'CREATE']);
  });

  it('a run e-mails a summary and a secure link with the recipient’s permissions; unsubscribe works', async () => {
    const group = (
      await admin
        .post('/report-subscriptions')
        .send(
          kpiSub({ name: 'Strategy KPIs', audience: 'DEPARTMENT', audienceDepartmentId: deptId }),
        )
        .expect(201)
    ).body;
    // Due now: the scheduler hands it to the job runner, which sends it.
    await ctx.prisma.reportSubscription.update({
      where: { id: group.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    expect(await subs.tick()).toBe(1);
    const job = await ctx.prisma.miningJob.findFirstOrThrow({ where: { kind: 'REPORT_SEND' } });
    await ctx.app.get(MiningJobsService).wait(job.id, 20_000);
    const deliveries = await ctx.prisma.reportDelivery.findMany({
      where: { subscriptionId: group.id },
    });
    const byUser = new Map(deliveries.map((d) => [d.userId, d]));
    // The performance officer may read KPIs; the viewer may not: never more than in the app.
    expect(byUser.get(perfId)).toMatchObject({ status: 'SENT', attached: false });
    expect(byUser.get(viewerId)).toMatchObject({ status: 'SKIPPED', error: 'NO_PERMISSION' });
    expect(ctx.mail.sent).toHaveLength(1);
    const mail = ctx.mail.sent[0] as (typeof ctx.mail.sent)[number] & {
      attachments?: unknown[];
      headers?: Record<string, string>;
    };
    expect(mail.to).toBe('perf@test.local');
    expect(mail.text).toContain('1 KPIs: 1 off target');
    expect(mail.attachments).toBeUndefined();
    const link = /\/reports\/deliveries\/([0-9a-f-]{36})/.exec(mail.text)![1];
    const unsubscribe = /\/unsubscribe\/(\S+)/.exec(mail.text)![1];
    expect(mail.headers?.['List-Unsubscribe']).toContain(unsubscribe);
    // The secure link: only the recipient, signed in.
    const file = await perf.get(`/report-subscriptions/deliveries/${link}/file`).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    await viewer.get(`/report-subscriptions/deliveries/${link}/file`).expect(404);
    await request(ctx.app.getHttpServer())
      .get(`/api/v1/report-subscriptions/deliveries/${link}/file`)
      .expect(401);
    // The schedule moved on.
    const after = await ctx.prisma.reportSubscription.findUniqueOrThrow({
      where: { id: group.id },
    });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    // Unsubscribe (public link with a signed token); a tampered token is refused.
    const anon = await new (await import('./helpers')).Client(ctx.app).init();
    await anon
      .post('/report-subscriptions/unsubscribe')
      .send({ token: `${unsubscribe.slice(0, -2)}xx` })
      .expect(400);
    await anon.post('/report-subscriptions/unsubscribe').send({ token: unsubscribe }).expect(200);
    ctx.mail.sent = [];
    await subs.run(group.id);
    expect(ctx.mail.sent).toHaveLength(0);
    const list = (await perf.get('/report-subscriptions').expect(200)).body as {
      id: string;
      unsubscribed: boolean;
    }[];
    expect(list.find((s) => s.id === group.id)?.unsubscribed).toBe(true);
  });

  it('PDF through the renderer, attachments only when allowed, failures notify the owner', async () => {
    const sub = (
      await perf
        .post('/report-subscriptions')
        .send(kpiSub({ format: 'PDF', locale: 'ar' }))
        .expect(201)
    ).body;
    let res = (await perf.post(`/report-subscriptions/${sub.id}/send-now`).expect(200)).body;
    expect(res).toMatchObject({ status: 'SENT', attached: false, format: 'PDF' });
    expect(res.fileName).toMatch(/_ar\.pdf$/);
    expect(ctx.renderer.calls.at(-1)).toMatchObject({ kind: 'pdf' });
    expect(ctx.mail.sent[0].subject).toContain('لوحة مؤشرات الأداء');
    await superAdmin
      .put('/report-subscriptions/settings')
      .send({ allowAttachments: true, linkDays: 7 })
      .expect(200);
    res = (await perf.post(`/report-subscriptions/${sub.id}/send-now`).expect(200)).body;
    expect(res.attached).toBe(true);
    const mail = ctx.mail.sent.at(-1) as { attachments?: { filename: string }[] };
    expect(mail.attachments?.[0].filename).toMatch(/\.pdf$/);
    // Without the renderer the PDF falls back to Excel (noted in the log).
    ctx.renderer.on = false;
    try {
      res = (await perf.post(`/report-subscriptions/${sub.id}/send-now`).expect(200)).body;
      expect(res).toMatchObject({ status: 'SENT', error: 'RENDERER_UNAVAILABLE_EXCEL_SENT' });
      expect(res.fileName).toMatch(/\.xlsx$/);
    } finally {
      ctx.renderer.on = true;
    }
    // A failing mail server: delivery FAILED, the owner is notified (scheduled runs).
    ctx.mail.failNext = true;
    await subs.run(sub.id);
    const failed = await ctx.prisma.reportDelivery.findFirst({
      where: { subscriptionId: sub.id, status: 'FAILED' },
    });
    expect(failed?.error).toMatch(/SMTP refused/);
    const note = await ctx.prisma.notification.findFirst({
      where: { userId: perfId, type: 'INTEGRATION' },
    });
    expect(note?.params).toMatchObject({ kind: 'reportFailed', titleEn: 'Weekly KPIs' });
    const log = (await perf.get(`/report-subscriptions/${sub.id}/deliveries`).expect(200)).body;
    expect(log.length).toBe(4);
  });

  it('builds every report type for an administrator', async () => {
    const proc = await ctx.prisma.process.create({
      data: { code: 'C.01', nameEn: 'Process', nameAr: 'عملية', category: 'CORE' },
    });
    for (const report of [
      'KPI_DASHBOARD',
      'OVERDUE_REVIEWS',
      'OPEN_ISSUES',
      'WORKFLOW_SLA',
      'MIGRATION_PROGRESS',
      'PROCESS_HANDBOOK',
    ]) {
      const s = (
        await superAdmin
          .post('/report-subscriptions')
          .send(
            kpiSub({
              name: report,
              report,
              format: 'EXCEL',
              filters: report === 'PROCESS_HANDBOOK' ? { processId: proc.id } : {},
            }),
          )
          .expect(201)
      ).body;
      const d = (await superAdmin.post(`/report-subscriptions/${s.id}/send-now`).expect(200)).body;
      expect({ report, status: d.status, error: d.error }).toEqual({
        report,
        status: 'SENT',
        error: null,
      });
    }
  });
});
