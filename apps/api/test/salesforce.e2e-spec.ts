import { DEFAULT_SALESFORCE_MAPPING } from '@processhub/shared';
import { SalesforceSyncService } from '../src/salesforce/salesforce-sync.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/**
 * Salesforce KPI link (Phase 4.3): settings with sealed secrets, test connection, preview, apply,
 * re-sync, read-only fields, failures and the schedule — against recorded fixtures only.
 */
describe('Salesforce KPI link (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;
  let modeler: Client;
  let performance: Client;

  const settings = (body: object = {}) => ({
    enabled: true,
    instanceUrl: 'https://example-dof.my.salesforce.com',
    authFlow: 'CLIENT_CREDENTIALS',
    clientId: '3MVG9FAKE.client.id',
    clientSecret: 'super-secret-value-123',
    schedule: 'DAILY',
    scheduleHour: 2,
    syncValues: true,
    ...body,
  });

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.salesforce.reset();
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'performance@test.local', ['PERFORMANCE_OFFICER']);
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    performance = await loggedIn(ctx.app, 'performance@test.local');
  });

  it('is configured by the Super Admin only and keeps the secret sealed', async () => {
    for (const c of [admin, modeler]) {
      await c.get('/integrations/salesforce').expect(403);
      await c.put('/integrations/salesforce').send(settings()).expect(403);
      await c.post('/integrations/salesforce/test').expect(403);
      await c.post('/integrations/salesforce/preview').expect(403);
      await c.post('/integrations/salesforce/sync').expect(403);
      await c.get('/integrations/salesforce/runs').expect(403);
      await c.get('/integrations/salesforce/describe/Org_Kpi_Goal__c').expect(403);
    }
    // Performance Officers (kpi.sync) review and run the sync but do not configure it (D-118).
    await performance.get('/integrations/salesforce').expect(200);
    await performance.put('/integrations/salesforce').send(settings()).expect(403);
    await performance.post('/integrations/salesforce/test').expect(403);
    await performance.get('/integrations/salesforce/describe/Org_Kpi_Goal__c').expect(403);
    const off = (await superAdmin.get('/integrations/salesforce').expect(200)).body;
    expect(off).toMatchObject({ enabled: false, hasClientSecret: false, encryptionReady: true });
    expect(off.mapping.kpis.object).toBe('Org_Kpi_Goal__c');
    // Enabling needs the credentials.
    await superAdmin
      .put('/integrations/salesforce')
      .send(settings({ clientSecret: undefined }))
      .expect(400);
    await superAdmin
      .put('/integrations/salesforce')
      .send(settings({ instanceUrl: 'ftp://x' }))
      .expect(400);
    const saved = (await superAdmin.put('/integrations/salesforce').send(settings()).expect(200))
      .body;
    expect(saved).toMatchObject({ enabled: true, hasClientSecret: true });
    expect(JSON.stringify(saved)).not.toContain('super-secret-value-123');
    const row = await ctx.prisma.setting.findUnique({ where: { key: 'integrations.salesforce' } });
    expect(JSON.stringify(row!.value)).not.toContain('super-secret-value-123');
    // Saving again without a secret keeps it.
    await superAdmin
      .put('/integrations/salesforce')
      .send(settings({ clientSecret: '' }))
      .expect(200);
    expect((await superAdmin.get('/integrations/salesforce')).body.hasClientSecret).toBe(true);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityType: 'Integration', entityId: 'salesforce' },
    });
    expect(JSON.stringify(audit!.summary)).not.toContain('super-secret');

    const test = (await superAdmin.post('/integrations/salesforce/test').expect(200)).body;
    expect(test).toMatchObject({
      ok: true,
      organizationId: '00DFAKE0000000000',
      userName: 'kpi.integration@example.test',
      objects: { Org_Kpi_Goal__c: true, Org_Kpi_Process__c: true, Org_Kpi_Measure__c: true },
    });
    const fields = (
      await superAdmin.get('/integrations/salesforce/describe/Org_Kpi_Goal__c').expect(200)
    ).body;
    expect(fields.map((f: { name: string }) => f.name)).toContain('Measuring_Direction__c');
    await superAdmin.get('/integrations/salesforce/describe/Bad;Name').expect(400);
    // Only GET requests and the token POST — ProcessHub never writes to Salesforce.
    expect(
      ctx.salesforce.requests.every(
        (r) => r.method === 'GET' || r.url.endsWith('/services/oauth2/token'),
      ),
    ).toBe(true);
    const seen = (await performance.get('/integrations/salesforce').expect(200)).body;
    expect(seen).toMatchObject({ enabled: true, hasClientSecret: true });
    expect(JSON.stringify(seen)).not.toContain('super-secret-value-123');
  });

  it('previews, applies and re-syncs definitions and values; Salesforce fields are read-only', async () => {
    const processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.05', nameEn: 'Payments', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn() }).expect(200);
    await superAdmin
      .put('/integrations/salesforce')
      .send(
        settings({
          mapping: {
            objectives: { source: 'KPI_FIELD' },
            kpis: {
              directionValues: { Increase: 'HIGHER_IS_BETTER', Decrease: 'LOWER_IS_BETTER' },
              frequencyValues: { Quarterly: 'QUARTERLY', Annual: 'ANNUAL' },
              statusValues: { Active: 'ACTIVE' },
            },
            results: {
              periodValues: { Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', Q4: 'Q4', 'Full Year': 'YEAR' },
            },
            measures: {},
          },
        }),
      )
      .expect(200);

    const preview = (await superAdmin.post('/integrations/salesforce/preview').expect(200)).body;
    expect(preview.objectives.create.map((o: { name: string }) => o.name).sort()).toEqual([
      'Efficient government services',
      'Financial sustainability',
    ]);
    expect(preview.kpis.create.map((k: { code: string }) => k.code)).toEqual([
      'KPI-0001',
      'KPI-0002',
    ]);
    // 2 approved quarterly values of KPI-0001 (the unapproved Q3 is not read), the 2025 result of
    // KPI-0002 and its 2024 value from the yearly measure; Q3 of an annual KPI is skipped.
    expect(preview.measurements).toMatchObject({ create: 4, update: 0 });
    expect(
      ctx.salesforce.requests.some((r) =>
        decodeURIComponent(r.url).includes('FROM Org_Kpi_Process__c WHERE Approved__c = true'),
      ),
    ).toBe(true);
    expect(preview.warnings).toEqual([
      expect.objectContaining({ record: 'a0YFAKE000000004', code: 'PERIOD_MISMATCH' }),
    ]);
    expect(await ctx.prisma.kpi.count()).toBe(0);

    const run = (await superAdmin.post('/integrations/salesforce/sync').expect(200)).body;
    expect(run).toMatchObject({
      status: 'SUCCESS',
      trigger: 'MANUAL',
      counts: { objectivesCreated: 2, kpisCreated: 2, valuesCreated: 4 },
      warnings: 1,
      user: expect.objectContaining({ email: 'super@test.local' }),
      configuredBy: expect.objectContaining({ email: 'super@test.local' }),
    });
    const list = (await modeler.get('/kpis?sort=code').expect(200)).body.items;
    expect(list[0]).toMatchObject({
      code: 'KPI-0001',
      dataSource: 'SALESFORCE',
      direction: 'HIGHER_IS_BETTER',
      frequency: 'QUARTERLY',
      salesforceId: 'a0XFAKE000000001',
      salesforceUrl: 'https://example-dof.my.salesforce.com/lightning/r/a0XFAKE000000001/view',
      objectives: [expect.objectContaining({ nameEn: 'Financial sustainability' })],
      latest: { period: '2025-Q2', value: 47, target: 50 },
    });
    expect(list[0].lockedFields).toEqual(
      expect.arrayContaining([
        'code',
        'nameEn',
        'descriptionEn',
        'descriptionAr',
        'unit',
        'direction',
        'frequency',
      ]),
    );
    expect(list[1]).toMatchObject({
      frequency: 'ANNUAL',
      direction: 'LOWER_IS_BETTER',
      latest: { period: '2025', value: 21, rag: 'RED' },
    });
    const kpiId = list[0].id;
    // Causality and corrective actions become part of the comment; the yearly target is the
    // target of the year's last quarter.
    const q1 = await ctx.prisma.kpiMeasurement.findFirstOrThrow({
      where: { kpiId, period: '2025-Q1' },
    });
    expect(q1.comment).toBe(
      'Slow start of the fiscal year.\nCausality: Tenders awarded late.\nCorrective actions: Weekly tender review with the budget owners.',
    );
    expect(
      (
        await ctx.prisma.kpiPeriodTarget.findMany({ where: { kpiId }, orderBy: { period: 'asc' } })
      ).map((t) => [t.period, t.target]),
    ).toEqual([
      ['2025-Q1', 25],
      ['2025-Q2', 50],
      ['2025-Q4', 100],
    ]);
    expect(
      await ctx.prisma.kpiMeasurement.findFirst({ where: { kpiId: list[1].id, period: '2024' } }),
    ).toMatchObject({ value: 25 });
    expect(await ctx.prisma.kpiMeasurement.count({ where: { kpiId, period: '2025-Q3' } })).toBe(0);
    // Read-only in ProcessHub: Salesforce fields and values; other fields stay editable.
    await superAdmin.patch(`/kpis/${kpiId}`).send({ nameEn: 'Renamed' }).expect(400);
    await superAdmin
      .patch(`/kpis/${kpiId}`)
      .send({ redThreshold: 20, links: [{ processId, bpmnElementId: '#process' }] })
      .expect(200);
    await superAdmin
      .put(`/kpis/${kpiId}/measurements`)
      .send({ period: '2025-Q3', value: 60 })
      .expect(400);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'SYNC', entityType: 'KpiMeasurement' } }),
    ).toBe(4);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'SYNC', entityType: 'Integration' } }),
    ).toBe(1);

    // Re-sync: one value changed in Salesforce, one new quarter, a renamed KPI.
    const goals = ctx.salesforce.records.Org_Kpi_Goal__c as { records: Record<string, unknown>[] };
    goals.records[0].Proposed_Kpi_Name__c = 'Budget execution rate (YTD)';
    const results = ctx.salesforce.records.Org_Kpi_Process__c as {
      records: Record<string, unknown>[];
    };
    results.records[1].Achieve_Value__c = 52;
    results.records.push({
      Id: 'a0YFAKE000000009',
      Org_Kpi_Measure__r: { Org_Kpi_Goal__c: 'a0XFAKE000000001', Measuring_Year__c: '2025' },
      Quarter__c: 'Q3',
      Achieve_Value__c: 71,
      Target_Value__c: 75,
      Notes__c: '',
      Approved__c: true,
    });
    const again = (await superAdmin.post('/integrations/salesforce/preview').expect(200)).body;
    expect(again.kpis.update).toEqual([
      expect.objectContaining({
        code: 'KPI-0001',
        changes: { nameEn: { from: 'Budget execution rate', to: 'Budget execution rate (YTD)' } },
      }),
    ]);
    expect(again.measurements).toMatchObject({ create: 1, update: 1 });
    const second = (await superAdmin.post('/integrations/salesforce/sync').expect(200)).body;
    expect(second.counts).toMatchObject({
      kpisUpdated: 1,
      valuesCreated: 1,
      valuesUpdated: 1,
      kpisCreated: 0,
    });
    const detail = (await modeler.get(`/kpis/${kpiId}`).expect(200)).body;
    expect(detail.item).toMatchObject({
      nameEn: 'Budget execution rate (YTD)',
      latest: { period: '2025-Q3', value: 71, target: 75 },
    });
    // Local fields survive the sync.
    expect(detail.item.redThreshold).toBe(20);
    expect(detail.links).toHaveLength(1);
    const runs = (await superAdmin.get('/integrations/salesforce/runs').expect(200)).body;
    expect(runs.map((r: { status: string }) => r.status)).toEqual(['SUCCESS', 'SUCCESS']);
  });

  it('records failures, notifies Super Admins and runs on the schedule', async () => {
    await superAdmin.put('/integrations/salesforce').send(settings()).expect(200);
    ctx.salesforce.failToken = true;
    await superAdmin.post('/integrations/salesforce/preview').expect(400);
    const failed = (await superAdmin.post('/integrations/salesforce/sync').expect(200)).body;
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed.error).toContain('invalid client credentials');
    const notes = await ctx.prisma.notification.findMany({
      where: { type: 'KPI' },
      include: { user: true },
    });
    expect(notes.map((n) => n.user.email).sort()).toEqual([
      'performance@test.local',
      'super@test.local',
    ]);
    expect(
      (await superAdmin.get('/integrations/salesforce').expect(200)).body.lastSync,
    ).toMatchObject({ status: 'FAILED' });

    ctx.salesforce.failToken = false;
    // Scheduled runs use the system actor "Salesforce sync" and keep working after the Super Admin
    // who configured the link is deactivated; nothing is attributed to a person (D-119).
    await ctx.prisma.user.update({
      where: { email: 'super@test.local' },
      data: { status: 'INACTIVE' },
    });
    const sync = ctx.app.get(SalesforceSyncService);
    const at = new Date(Date.UTC(2026, 9, 31, 3, 0));
    const first = await sync.runScheduled(at);
    expect(first).toMatchObject({
      status: 'SUCCESS',
      trigger: 'SCHEDULED',
      user: null,
      configuredBy: expect.objectContaining({ email: 'super@test.local' }),
      counts: expect.objectContaining({ kpisCreated: 2 }),
    });
    const kpi = await ctx.prisma.repoObject.findFirstOrThrow({ where: { code: 'KPI-0001' } });
    expect(kpi.createdById).toBeNull();
    const entries = await ctx.prisma.auditLog.findMany({
      where: { action: 'SYNC', entityType: { in: ['Kpi', 'KpiMeasurement', 'Integration'] } },
    });
    expect(entries.length).toBeGreaterThan(3);
    for (const e of entries.filter(
      (x) => JSON.stringify(x.summary).includes('SCHEDULED') || x.entityType !== 'Integration',
    )) {
      expect(e.userId).toBeNull();
      expect(e.summary).toMatchObject({
        actor: 'Salesforce sync',
        configuredBy: expect.objectContaining({ email: 'super@test.local' }),
      });
    }
    await ctx.prisma.user.update({
      where: { email: 'super@test.local' },
      data: { status: 'ACTIVE' },
    });
    // Same daily slot: not again; the next day after 02:00 UTC: again.
    expect(await sync.runScheduled(new Date(Date.UTC(2026, 9, 31, 23, 0)))).toBeNull();
    expect(await sync.runScheduled(new Date(Date.UTC(2026, 10, 1, 2, 30)))).toMatchObject({
      status: 'SUCCESS',
    });
    expect(
      SalesforceSyncService.slot(new Date(Date.UTC(2026, 9, 31, 1, 0)), 'DAILY', 2)?.toISOString(),
    ).toBe('2026-10-30T02:00:00.000Z');
    expect(
      SalesforceSyncService.slot(new Date(Date.UTC(2026, 9, 31, 3, 0)), 'WEEKLY', 2)?.toISOString(),
    ).toBe('2026-10-26T02:00:00.000Z');
    // Disabled: nothing runs.
    await superAdmin
      .put('/integrations/salesforce')
      .send(settings({ enabled: false }))
      .expect(200);
    await superAdmin.post('/integrations/salesforce/sync').expect(400);
    expect(await sync.runScheduled(new Date(Date.UTC(2026, 10, 3, 3, 0)))).toBeNull();
  });

  it('includes unapproved results on request, links picklist values to existing objectives, half years', async () => {
    const existing = (
      await performance
        .post('/kpis/objectives')
        .send({ code: 'OBJ-1', nameEn: 'Sustainable finances' })
        .expect(201)
    ).body;
    const goals = ctx.salesforce.records.Org_Kpi_Goal__c as { records: Record<string, unknown>[] };
    goals.records[1].Measuring_Period__c = 'Semi-Annual';
    const page2 = ctx.salesforce.records['Org_Kpi_Process__c.page2'] as {
      records: Record<string, unknown>[];
    };
    page2.records[0].Quarter__c = 'First Half';
    await superAdmin
      .put('/integrations/salesforce')
      .send(
        settings({
          includeUnapproved: true,
          mapping: {
            ...DEFAULT_SALESFORCE_MAPPING,
            objectives: {
              ...DEFAULT_SALESFORCE_MAPPING.objectives,
              valueLinks: { 'Financial sustainability': existing.id },
            },
          },
        }),
      )
      .expect(200);
    // A Performance Officer previews and runs the sync; the run records who configured it.
    const preview = (await performance.post('/integrations/salesforce/preview').expect(200)).body;
    expect(preview.objectives.create.map((o: { name: string }) => o.name)).toEqual([
      'Efficient government services',
    ]);
    const run = (await performance.post('/integrations/salesforce/sync').expect(200)).body;
    expect(run).toMatchObject({
      status: 'SUCCESS',
      user: expect.objectContaining({ email: 'performance@test.local' }),
      configuredBy: expect.objectContaining({ email: 'super@test.local' }),
      counts: expect.objectContaining({ objectivesCreated: 1, valuesCreated: 4 }),
    });
    expect(
      ctx.salesforce.requests.some((r) => decodeURIComponent(r.url).includes('WHERE Approved__c')),
    ).toBe(false);
    const list = (await performance.get('/kpis?sort=code').expect(200)).body.items;
    expect(list[0].objectives).toEqual([expect.objectContaining({ id: existing.id })]);
    // The unapproved Q3 result is imported with this setting.
    expect(list[0].latest).toMatchObject({ period: '2025-Q3', value: 60 });
    // Semi-annual KPI: "First Half" → 2025-H1; the 2024 yearly target on 2024-H2.
    expect(list[1]).toMatchObject({ frequency: 'SEMI_ANNUAL', latest: { period: '2025-H1' } });
    expect(
      await ctx.prisma.kpiPeriodTarget.findFirst({
        where: { kpiId: list[1].id, period: '2024-H2' },
      }),
    ).toMatchObject({ target: 20 });
    const runs = (await performance.get('/integrations/salesforce/runs').expect(200)).body;
    expect(runs).toHaveLength(1);
    await performance.get(`/integrations/salesforce/runs/${run.id}/warnings`).expect(200);
  });
});
