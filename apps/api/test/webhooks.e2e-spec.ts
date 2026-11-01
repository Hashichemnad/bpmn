import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WEBHOOK_DISABLE_AFTER } from '@processhub/shared';
import { resetConfigCache } from '../src/config/config';
import { DomainEvents } from '../src/events/domain-events';
import { WebhookDispatcher } from '../src/webhooks/webhook-dispatcher.service';
import { verifyWebhook } from '../src/webhooks/webhook-signature';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Test receiver on localhost (allowed through OUTBOUND_ALLOWED_HOSTS for this suite only). */
class Receiver {
  server!: Server;
  received: Received[] = [];
  /** status code, 'slow' (2 s), 'redirect' or 'big' (200 KB body) */
  mode: number | 'slow' | 'redirect' | 'big' = 200;
  url = '';

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        this.received.push({ path: req.url ?? '', headers: req.headers, body });
        if (this.mode === 'slow') setTimeout(() => res.writeHead(200).end('late'), 2000);
        else if (this.mode === 'redirect')
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
        else if (this.mode === 'big') res.writeHead(200).end('x'.repeat(200 * 1024));
        else res.writeHead(this.mode).end(this.mode < 300 ? 'ok' : 'nope');
      });
    });
    await new Promise<void>((r) => this.server.listen(0, 'localhost', r));
    this.url = `http://localhost:${(this.server.address() as AddressInfo).port}`;
  }
  stop() {
    this.server.closeAllConnections();
    return new Promise((r) => this.server.close(r));
  }
}

describe('Webhooks (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;
  let dispatcher: WebhookDispatcher;
  let events: DomainEvents;
  const receiver = new Receiver();
  let deptA: string;
  let deptB: string;
  let superId: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.OUTBOUND_ALLOWED_HOSTS = 'localhost';
    process.env.WEBHOOK_TIMEOUT_MS = '1000';
    resetConfigCache();
    await receiver.start();
    ctx = await createApp();
    dispatcher = ctx.app.get(WebhookDispatcher);
    events = ctx.app.get(DomainEvents);
  });
  afterAll(async () => {
    await ctx.app.close();
    await receiver.stop();
    process.env = saved;
    resetConfigCache();
  });

  beforeEach(async () => {
    await dispatcher.whenIdle();
    await resetDb(ctx.prisma);
    await ctx.prisma.webhookDelivery.deleteMany();
    await ctx.prisma.webhook.deleteMany();
    receiver.received = [];
    receiver.mode = 200;
    deptA = (await ctx.prisma.department.create({ data: { nameEn: 'Finance', nameAr: 'المالية' } }))
      .id;
    deptB = (await ctx.prisma.department.create({ data: { nameEn: 'HR', nameAr: 'الموارد' } })).id;
    superId = (await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN'])).id;
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
  });

  const hook = async (over: Record<string, unknown> = {}) => {
    const res = await superAdmin
      .post('/integrations/webhooks')
      .send({
        name: 'Intranet',
        url: `${receiver.url}/hook`,
        events: ['process.published'],
        ...over,
      })
      .expect(201);
    return res.body as { webhook: { id: string }; secret: string };
  };

  const newProcess = async (code: string, departmentId: string, parentId?: string) =>
    (
      await ctx.prisma.process.create({
        data: {
          code,
          nameEn: `P ${code}`,
          nameAr: 'عملية',
          category: 'CORE',
          departmentId,
          parentId,
        },
      })
    ).id;

  const published = async (processId: string) => {
    await ctx.prisma.publication.create({
      data: {
        entityType: 'PROCESS',
        entityId: processId,
        versionNumber: 3,
        versionLabel: '2.0',
        titleEn: 'Published name',
        titleAr: 'الاسم المنشور',
        code: 'C.01',
      },
    });
    events.emit({
      type: 'content.published',
      entityType: 'PROCESS',
      entityId: processId,
      actorId: superId,
    });
    await dispatcher.whenIdle();
  };

  it('Super Admins manage webhooks (secret shown once, URL encrypted); Admins only read', async () => {
    const { webhook, secret } = await hook();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const row = await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: webhook.id } });
    expect(row.urlSealed).not.toContain('localhost');
    expect(row.secretSealed).not.toContain(secret);
    const list = (await admin.get('/integrations/webhooks').expect(200)).body;
    expect(list[0]).toMatchObject({ name: 'Intranet', hasSecret: true, kind: 'WEBHOOK' });
    expect(JSON.stringify(list)).not.toContain(secret);
    await admin
      .post('/integrations/webhooks')
      .send({ name: 'x', url: 'https://example.com', events: ['kpi.red'] })
      .expect(403);
    await admin.post(`/integrations/webhooks/${webhook.id}/test`).expect(403);
    const rotated = (
      await superAdmin.post(`/integrations/webhooks/${webhook.id}/secret`).expect(200)
    ).body;
    expect(rotated.secret).not.toBe(secret);
    await superAdmin.delete(`/integrations/webhooks/${webhook.id}`).expect(204);
    expect((await admin.get('/integrations/webhooks').expect(200)).body).toHaveLength(0);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { entityType: 'Webhook' } })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(['CREATE', 'DELETE', 'ROTATE']);
  });

  it('a published process is delivered once, signed, with links and minimal data', async () => {
    const { webhook, secret } = await hook();
    const p = await newProcess('C.01', deptA);
    await published(p);
    expect(receiver.received).toHaveLength(1);
    const r = receiver.received[0];
    expect(r.path).toBe('/hook');
    expect(r.headers['x-processhub-event']).toBe('process.published');
    expect(
      verifyWebhook(
        secret,
        r.headers['x-processhub-timestamp'] as string,
        r.headers['x-processhub-signature'] as string,
        r.body,
      ),
    ).toBe(true);
    // Tampered body or old timestamp: refused by the receiver-side check.
    expect(
      verifyWebhook(
        secret,
        r.headers['x-processhub-timestamp'] as string,
        r.headers['x-processhub-signature'] as string,
        `${r.body} `,
      ),
    ).toBe(false);
    expect(
      verifyWebhook(
        secret,
        r.headers['x-processhub-timestamp'] as string,
        r.headers['x-processhub-signature'] as string,
        r.body,
        300,
        Date.now() + 600_000,
      ),
    ).toBe(false);
    const payload = JSON.parse(r.body);
    expect(payload).toMatchObject({
      type: 'process.published',
      entity: {
        type: 'PROCESS',
        id: p,
        code: 'C.01',
        nameEn: 'Published name',
        nameAr: 'الاسم المنشور',
      },
      data: { version: '3 (2.0)' },
    });
    expect(payload.links.portal).toMatch(new RegExp(`/portal/processes/${p}$`));
    expect(payload.links.api).toMatch(new RegExp(`/api/public/v1/processes/${p}$`));
    expect(r.headers['x-processhub-delivery']).toBe(payload.id);

    const log = (await admin.get(`/integrations/webhooks/${webhook.id}/deliveries`).expect(200))
      .body;
    expect(log.items[0]).toMatchObject({
      status: 'SUCCEEDED',
      attempts: 1,
      lastStatusCode: 200,
      eventType: 'process.published',
    });
    // Not subscribed: archived.
    events.emit({
      type: 'content.unpublished',
      entityType: 'PROCESS',
      entityId: p,
      actorId: superId,
    });
    await dispatcher.whenIdle();
    expect(receiver.received).toHaveLength(1);
  });

  it('filters by department and process-house branch', async () => {
    const root = await newProcess('C', deptA);
    const child = await newProcess('C.01', deptA, root);
    const other = await newProcess('S.01', deptB);
    await hook({ name: 'Finance only', departmentIds: [deptA] });
    await hook({ name: 'Branch', processBranchId: root });
    await published(child);
    expect(receiver.received).toHaveLength(2);
    receiver.received = [];
    await published(other);
    expect(receiver.received).toHaveLength(0);
  });

  it('retries with backoff, then switches the destination off and tells the Super Admins', async () => {
    const { webhook } = await hook();
    receiver.mode = 500;
    const p = await newProcess('C.01', deptA);
    await published(p);
    let d = await ctx.prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: webhook.id } });
    expect(d).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastStatusCode: 500,
      lastError: 'HTTP 500',
    });
    expect(d.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(50_000);
    // Not due yet: nothing is sent.
    expect(await dispatcher.runOnce()).toBe(0);
    // A restart loses nothing: the next run (in the future) picks the row up again.
    expect(await dispatcher.runOnce(new Date(Date.now() + 2 * 60_000))).toBe(1);
    d = await ctx.prisma.webhookDelivery.findFirstOrThrow({ where: { id: d.id } });
    expect(d.attempts).toBe(2);
    // More failing events until the switch-off threshold.
    for (let i = 2; i < WEBHOOK_DISABLE_AFTER; i++) {
      events.emit({
        type: 'content.published',
        entityType: 'PROCESS',
        entityId: p,
        actorId: superId,
      });
      await dispatcher.whenIdle();
    }
    const w = await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: webhook.id } });
    expect(w.disabledAt).not.toBeNull();
    expect(w.disabledReason).toBe('HTTP 500');
    expect(
      await ctx.prisma.webhookDelivery.count({
        where: { webhookId: webhook.id, status: 'PENDING' },
      }),
    ).toBe(0);
    const note = await ctx.prisma.notification.findFirst({
      where: { userId: superId, type: 'INTEGRATION' },
    });
    expect(note?.params).toMatchObject({ kind: 'webhookDisabled', titleEn: 'Intranet' });
    // Switched off: new events create no deliveries; switching on again resets the counter.
    const before = await ctx.prisma.webhookDelivery.count();
    events.emit({
      type: 'content.published',
      entityType: 'PROCESS',
      entityId: p,
      actorId: superId,
    });
    await dispatcher.whenIdle();
    expect(await ctx.prisma.webhookDelivery.count()).toBe(before);
    receiver.mode = 200;
    await superAdmin
      .patch(`/integrations/webhooks/${webhook.id}`)
      .send({ active: true })
      .expect(200);
    const on = await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: webhook.id } });
    expect(on).toMatchObject({ disabledAt: null, consecutiveFailures: 0 });
    // Resend of a logged delivery and a test event work immediately.
    const resent = (
      await superAdmin
        .post(`/integrations/webhooks/${webhook.id}/deliveries/${d.id}/resend`)
        .expect(200)
    ).body;
    expect(resent).toMatchObject({ status: 'SUCCEEDED', eventId: d.eventId });
    const test = (await superAdmin.post(`/integrations/webhooks/${webhook.id}/test`).expect(200))
      .body;
    expect(test).toMatchObject({ status: 'SUCCEEDED', eventType: 'test', test: true });
  });

  it('never follows redirects, limits time and response size', async () => {
    const { webhook } = await hook();
    for (const mode of ['redirect', 'slow', 'big'] as const) {
      receiver.mode = mode;
      receiver.received = [];
      const res = (await superAdmin.post(`/integrations/webhooks/${webhook.id}/test`).expect(200))
        .body;
      expect(res.status).toBe('GAVE_UP');
      expect(receiver.received).toHaveLength(1);
      if (mode === 'redirect') expect(res.lastError).toBe('REDIRECT_NOT_FOLLOWED (302)');
      if (mode === 'slow') expect(res.lastError).toMatch(/timeout|aborted/i);
      if (mode === 'big') expect(res.lastError).toMatch(/too large/);
    }
  });

  it('refuses internal, non-HTTPS and not allowed destinations (SSRF)', async () => {
    const bad = async (url: string, code: string, kind = 'WEBHOOK') =>
      expect(
        (
          await superAdmin
            .post('/integrations/webhooks')
            .send({ kind, name: 'x', url, events: ['kpi.red'] })
            .expect(400)
        ).body.code,
      ).toBe(code);
    await bad('https://127.0.0.1/hook', 'WEBHOOK_HOST_BLOCKED');
    await bad('https://169.254.169.254/latest/meta-data', 'WEBHOOK_HOST_BLOCKED');
    await bad('https://10.0.0.5/hook', 'WEBHOOK_HOST_BLOCKED');
    await bad('https://[::1]/hook', 'WEBHOOK_HOST_BLOCKED');
    await bad('https://[::ffff:127.0.0.1]/hook', 'WEBHOOK_HOST_BLOCKED');
    await bad('https://0x7f000001/hook', 'WEBHOOK_HOST_BLOCKED');
    await bad('http://203.0.113.10/hook', 'HTTPS_URL_REQUIRED');
    // Teams destinations: Power Automate hosts only (by default).
    await bad('https://example.com/hook', 'WEBHOOK_HOST_NOT_ALLOWED', 'TEAMS');
    expect(
      (
        await superAdmin
          .post('/integrations/webhooks')
          .send({ name: 'x', url: 'https://u:p@example.com', events: ['kpi.red'] })
          .expect(400)
      ).body.code,
    ).toBe('VALIDATION_ERROR');
    // Allow-list for generic webhooks.
    await superAdmin
      .put('/integrations/webhook-settings')
      .send({ allowedHosts: ['*.example.org'], teamsHosts: [], retentionDays: 30 })
      .expect(200);
    await bad('https://203.0.113.10/hook', 'WEBHOOK_HOST_NOT_ALLOWED');
    // A destination saved earlier is checked again before every delivery.
    await ctx.prisma.setting.deleteMany({ where: { key: 'integrations.webhooks' } });
    const { webhook } = await hook();
    await superAdmin
      .put('/integrations/webhook-settings')
      .send({ allowedHosts: ['hooks.example.org'], teamsHosts: [], retentionDays: 30 })
      .expect(200);
    receiver.received = [];
    const res = (await superAdmin.post(`/integrations/webhooks/${webhook.id}/test`).expect(200))
      .body;
    // localhost is an OUTBOUND_ALLOWED_HOSTS entry (test receiver), so the list does not apply to it.
    expect(res.status).toBe('SUCCEEDED');
  });

  it('real flows raise events: an issue is raised, a KPI value turns red', async () => {
    await hook({ name: 'GRC', events: ['issue.raised', 'kpi.red'] });
    await createUser(ctx.prisma, 'risk@test.local', ['RISK_OFFICER', 'PERFORMANCE_OFFICER']);
    const risk = await loggedIn(ctx.app, 'risk@test.local');
    await risk
      .post('/issues')
      .send({ titleEn: 'Missing approval evidence', severity: 'HIGH', departmentId: deptA })
      .expect(201);
    await dispatcher.whenIdle();
    const kpi = (
      await risk
        .post('/kpis')
        .send({
          nameEn: 'Invoices paid on time',
          unit: '%',
          direction: 'HIGHER_IS_BETTER',
          frequency: 'MONTHLY',
          target: 95,
          redThreshold: 80,
          departmentId: deptA,
        })
        .expect(201)
    ).body.item.id as string;
    await risk.put(`/kpis/${kpi}/measurements`).send({ period: '2026-09', value: 90 }).expect(200);
    await risk.put(`/kpis/${kpi}/measurements`).send({ period: '2026-10', value: 70 }).expect(200);
    // Still red: no second event.
    await risk.put(`/kpis/${kpi}/measurements`).send({ period: '2026-10', value: 60 }).expect(200);
    await dispatcher.whenIdle();
    const types = receiver.received.map((r) => JSON.parse(r.body));
    expect(types.map((t) => t.type)).toEqual(['issue.raised', 'kpi.red']);
    expect(types[0]).toMatchObject({
      entity: { type: 'ISSUE', nameEn: 'Missing approval evidence' },
      data: { severity: 'HIGH' },
    });
    expect(JSON.stringify(types[0])).not.toContain('description');
    expect(types[1]).toMatchObject({
      entity: { type: 'KPI', id: kpi },
      data: { period: '2026-10', value: '70 %' },
    });
  });
});
