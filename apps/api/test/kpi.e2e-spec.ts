import ExcelJS from 'exceljs';
import { duePeriod, shiftPeriod } from '@processhub/shared';
import { KpiScheduler } from '../src/kpi/kpi-scheduler.service';
import {
  PNG_BYTES,
  createApp,
  createUser,
  loggedIn,
  resetDb,
  type Client,
  type TestContext,
} from './helpers';

/** KPIs (Phase 4.3, M12): catalogue, objectives, measurements, status, evidence, Excel, permissions. */
describe('KPIs (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let owner: Client;
  let otherOwner: Client;
  let modeler: Client;
  let viewer: Client;
  let officer: Client;
  let ownerId: string;
  let processId: string;

  const month = duePeriod(new Date(), 'MONTHLY');
  const prev = (n: number) => shiftPeriod(month, 'MONTHLY', -n);

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    ownerId = (await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'])).id;
    await createUser(ctx.prisma, 'owner2@test.local', ['PROCESS_OWNER']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    otherOwner = await loggedIn(ctx.app, 'owner2@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    officer = await loggedIn(ctx.app, 'officer@test.local');
    processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Purchasing', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: laneXml() }).expect(200);
  });

  const kpi = (c: Client, body: object = {}) =>
    c.post('/kpis').send({
      code: 'KPI-01',
      nameEn: 'Orders approved on time',
      nameAr: 'الطلبات المعتمدة في الوقت',
      unit: '%',
      direction: 'HIGHER_IS_BETTER',
      frequency: 'MONTHLY',
      target: 90,
      redThreshold: 80,
      ownerId,
      ...body,
    });

  it('defines KPIs with objectives, capabilities, key risk indicators and step links', async () => {
    const parent = (
      await admin
        .post('/kpis/objectives')
        .send({ code: 'SO-1', nameEn: 'Efficient government' })
        .expect(201)
    ).body;
    const child = (
      await admin
        .post('/kpis/objectives')
        .send({ code: 'SO-1.1', nameEn: 'Faster procurement', parentId: parent.id })
        .expect(201)
    ).body;
    // A cycle is refused.
    await admin.patch(`/kpis/objectives/${parent.id}`).send({ parentId: child.id }).expect(400);
    const risk = (
      await officer
        .post('/grc/risks')
        .send({
          code: 'R-1',
          nameEn: 'Late orders',
          category: 'OPERATIONAL',
          inherentLikelihood: 3,
          inherentImpact: 3,
        })
        .expect(201)
    ).body.item;
    const detail = (
      await kpi(admin, {
        objectiveIds: [child.id],
        riskIds: [risk.id],
        links: [
          { processId, bpmnElementId: '#process' },
          { processId, bpmnElementId: 'T1' },
        ],
        periodTargets: [{ period: prev(1), target: 95 }],
      }).expect(201)
    ).body;
    expect(detail.item).toMatchObject({
      code: 'KPI-01',
      owner: { email: 'owner@test.local' },
      objectives: [expect.objectContaining({ code: 'SO-1.1' })],
      risks: [expect.objectContaining({ code: 'R-1' })],
      stepCount: 2,
    });
    expect(detail.links.map((l: { bpmnElementId: string }) => l.bpmnElementId).sort()).toEqual([
      '#process',
      'T1',
    ]);
    // KPI objects come only from the register.
    await modeler.post('/objects').send({ type: 'KPI', nameEn: 'x' }).expect(400);
    // A KPI library object created before the register (or by a seed) appears with defaults.
    await ctx.prisma.repoObject.create({ data: { type: 'KPI', code: 'OLD', nameEn: 'Legacy' } });
    const list = (await modeler.get('/kpis?sort=code').expect(200)).body;
    expect(list.items.map((k: { code: string }) => k.code)).toEqual(['KPI-01', 'OLD']);
    const objectives = (await modeler.get('/kpis/objectives').expect(200)).body;
    expect(objectives.find((o: { code: string }) => o.code === 'SO-1.1').kpiCount).toBe(1);

    // Process view: KPIs of the process / steps and the calculated process KPIs.
    const view = (await modeler.get(`/kpis/processes/${processId}`).expect(200)).body;
    expect(view.items).toHaveLength(2);
    expect(view.calculated).toMatchObject({ handovers: 1, steps: 3, automationRate: 33.3 });
  });

  it('measurements: status from thresholds, owner entry, period checks, history, evidence, tasks', async () => {
    const id = (await kpi(admin, { periodTargets: [{ period: prev(2), target: 70 }] }).expect(201))
      .body.item.id;
    // The owner enters values of their KPI; others may not.
    await owner
      .put(`/kpis/${id}/measurements`)
      .send({ period: prev(3), value: 95 })
      .expect(200);
    await owner
      .put(`/kpis/${id}/measurements`)
      .send({ period: prev(2), value: 75 })
      .expect(200);
    await otherOwner
      .put(`/kpis/${id}/measurements`)
      .send({ period: prev(1), value: 1 })
      .expect(403);
    await modeler
      .put(`/kpis/${id}/measurements`)
      .send({ period: prev(1), value: 1 })
      .expect(403);
    await viewer
      .put(`/kpis/${id}/measurements`)
      .send({ period: prev(1), value: 1 })
      .expect(403);
    await owner.put(`/kpis/${id}/measurements`).send({ period: '2026-Q1', value: 1 }).expect(400);
    await owner.put(`/kpis/${id}/measurements`).send({ period: '2999-01', value: 1 }).expect(400);

    // Due: the last completed month has no value yet → My tasks of the owner.
    expect((await owner.get('/kpis/tasks').expect(200)).body).toEqual([
      expect.objectContaining({ kpi: expect.objectContaining({ id }), period: month }),
    ]);
    const scheduler = ctx.app.get(KpiScheduler);
    expect(await scheduler.remind()).toBe(1);
    expect(await scheduler.remind()).toBe(0);
    expect(await ctx.prisma.notification.count({ where: { type: 'KPI' } })).toBe(1);

    const saved = (
      await owner
        .put(`/kpis/${id}/measurements`)
        .send({ period: month, value: 82, comment: 'Two late approvals' })
        .expect(200)
    ).body;
    expect(
      saved.measurements.map((m: { period: string; rag: string }) => [m.period, m.rag]),
    ).toEqual([
      [prev(3), 'GREEN'],
      // Period target 70 (green from 70) overrides 90.
      [prev(2), 'GREEN'],
      [month, 'AMBER'],
    ]);
    expect(saved.item).toMatchObject({
      latest: { period: month, value: 82, rag: 'AMBER' },
      due: false,
    });
    expect((await owner.get('/kpis/tasks').expect(200)).body).toEqual([]);
    // Correction of a value: an audited update.
    await owner.put(`/kpis/${id}/measurements`).send({ period: month, value: 70 }).expect(200);
    const red = (await modeler.get(`/kpis?rag=RED`).expect(200)).body;
    expect(red.items.map((k: { id: string }) => k.id)).toEqual([id]);
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityType: 'KpiMeasurement' } });
    expect(audit.map((a) => a.action).sort()).toEqual(['CREATE', 'CREATE', 'CREATE', 'UPDATE']);

    // Evidence on a measurement: uploaded by the owner, readable with kpi.read only.
    const mid = saved.measurements[2].id;
    const file = (
      await owner
        .post(`/kpis/measurements/${mid}/files`)
        .attach('file', PNG_BYTES, 'evidence.png')
        .expect(201)
    ).body;
    await otherOwner
      .post(`/kpis/measurements/${mid}/files`)
      .attach('file', PNG_BYTES, 'x.png')
      .expect(403);
    await modeler.get(`/assurance/files/${file.id}`).expect(200);
    await viewer.get(`/assurance/files/${file.id}`).expect(404);
    const detail = (await modeler.get(`/kpis/${id}`).expect(200)).body;
    expect(detail.measurements[2].evidence).toEqual([
      expect.objectContaining({ id: file.id, fileName: 'evidence.png' }),
    ]);

    // A frequency change is refused once values exist; delete a value.
    await admin.patch(`/kpis/${id}`).send({ frequency: 'QUARTERLY' }).expect(409);
    await otherOwner.delete(`/kpis/${id}/measurements/${mid}`).expect(403);
    await owner.delete(`/kpis/${id}/measurements/${mid}`).expect(204);
  });

  it('calculated KPIs read the step attributes of the working model', async () => {
    await kpi(admin, { dataSource: 'CALCULATED' }).expect(400);
    const id = (
      await kpi(admin, {
        code: 'KPI-AUTO',
        dataSource: 'CALCULATED',
        calculatedMetric: 'DURATION_MINUTES',
        calculatedProcessId: processId,
        direction: 'LOWER_IS_BETTER',
        target: 100,
        redThreshold: 200,
      }).expect(201)
    ).body.item.id;
    const detail = (await admin.post(`/kpis/${id}/recalculate`).expect(200)).body;
    expect(detail.calculatedNow).toBe(150);
    expect(detail.measurements).toEqual([
      expect.objectContaining({ value: 150, source: 'CALCULATED', rag: 'AMBER' }),
    ]);
    const view = (await modeler.get(`/kpis/processes/${processId}`).expect(200)).body;
    expect(view.items).toEqual([
      expect.objectContaining({ id, bpmnElementId: '#process', rag: 'AMBER' }),
    ]);
  });

  it('Excel: KPI catalogue for editors, measurements for owners (own KPIs), checked first', async () => {
    const id = (await kpi(admin).expect(201)).body.item.id;
    await kpi(admin, { code: 'KPI-02', nameEn: 'Other', ownerId: null }).expect(201);
    const file = async (header: string[], rows: (string | number | null)[][]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('x');
      ws.addRow(header);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const values = await file(
      ['KPI (code)', 'Period (2026-03, 2026-Q1, 2026)', 'Actual value', 'Comment'],
      [
        ['KPI-01', prev(1), 91, 'ok'],
        ['KPI-01', prev(2), '88', ''],
        ['KPI-02', prev(1), 50, ''],
        ['KPI-09', prev(1), 1, ''],
        ['KPI-01', '2026-Q2', 1, ''],
        ['KPI-01', prev(5), 'abc', ''],
      ],
    );
    const report = (
      await owner.post('/kpis/import/measurements').attach('file', values, 'm.xlsx').expect(200)
    ).body;
    expect(
      report.errors.map(
        (e: { row: number; column: string; code: string }) => `${e.row}:${e.column}:${e.code}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        '4:kpi:NOT_OWNER',
        '5:kpi:UNKNOWN_KPI',
        '6:period:INVALID_PERIOD',
        '7:value:INVALID_NUMBER',
      ]),
    );
    const good = await file(
      ['KPI (code)', 'Period (2026-03, 2026-Q1, 2026)', 'Actual value'],
      [
        ['KPI-01', prev(1), 91],
        ['KPI-01', prev(2), 88],
      ],
    );
    expect(
      (
        await owner
          .post('/kpis/import/measurements?dryRun=false')
          .attach('file', good, 'm.xlsx')
          .expect(200)
      ).body,
    ).toMatchObject({ created: 2, updated: 0, imported: true });
    const d = (await owner.get(`/kpis/${id}`).expect(200)).body;
    expect(d.measurements.map((m: { source: string }) => m.source)).toEqual(['EXCEL', 'EXCEL']);

    // KPI catalogue: editors only; the owner gets 403.
    const cat = await file(
      ['Code', 'Name (English)', 'Frequency', 'Target', 'Owner (e-mail)'],
      [['KPI-03', 'New KPI', 'quarterly', '12.5', 'owner@test.local']],
    );
    await owner.post('/kpis/import/kpis').attach('file', cat, 'k.xlsx').expect(403);
    expect(
      (await admin.post('/kpis/import/kpis?dryRun=false').attach('file', cat, 'k.xlsx').expect(200))
        .body,
    ).toMatchObject({ created: 1, imported: true });
    const k3 = (await admin.get('/kpis?q=KPI-03').expect(200)).body.items[0];
    expect(k3).toMatchObject({
      frequency: 'QUARTERLY',
      target: 12.5,
      owner: { email: 'owner@test.local' },
    });
    const exported = await admin
      .get('/kpis/export/measurements?locale=ar')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exported.body as ArrayBuffer);
    expect(wb.worksheets[0].views[0].rightToLeft).toBe(true);
    expect(wb.worksheets[0].rowCount).toBe(3);
  });

  it('checks permissions on every endpoint', async () => {
    const id = (await kpi(admin).expect(201)).body.item.id;
    const obj = (await admin.post('/kpis/objectives').send({ nameEn: 'Goal' }).expect(201)).body;
    for (const c of [modeler, owner, officer]) {
      await c.get('/kpis').expect(200);
      await c.get(`/kpis/${id}`).expect(200);
      await c.get('/kpis/objectives').expect(200);
      await c.get(`/kpis/processes/${processId}`).expect(200);
      await c.get('/kpis/export/kpis').expect(200);
      await c.get('/kpis/settings').expect(200);
    }
    for (const path of [
      '/kpis',
      `/kpis/${id}`,
      '/kpis/objectives',
      `/kpis/processes/${processId}`,
      '/kpis/export/kpis',
      '/kpis/settings',
      '/kpis/tasks',
    ])
      await viewer.get(path).expect(403);
    // Editing: kpi.edit only (Admins).
    for (const c of [modeler, owner, officer, viewer]) {
      await c.post('/kpis').send({ nameEn: 'x' }).expect(403);
      await c.patch(`/kpis/${id}`).send({ target: 1 }).expect(403);
      await c.delete(`/kpis/${id}`).expect(403);
      await c.post('/kpis/objectives').send({ nameEn: 'x' }).expect(403);
      await c.patch(`/kpis/objectives/${obj.id}`).send({ nameEn: 'x' }).expect(403);
      await c.delete(`/kpis/objectives/${obj.id}`).expect(403);
      await c.put('/kpis/settings').send({ showInPortal: true, reminders: true }).expect(403);
      await c.post(`/kpis/${id}/recalculate`).expect(403);
    }
    // Measuring: kpi.measure / kpi.edit only.
    for (const c of [modeler, officer, viewer]) {
      await c.get('/kpis/tasks').expect(403);
      await c.get('/kpis/template/measurements').expect(403);
      await c.post('/kpis/import/measurements').expect(403);
    }
    await admin.put('/kpis/settings').send({ showInPortal: true, reminders: false }).expect(200);
    expect((await owner.get('/kpis/settings').expect(200)).body).toEqual({
      showInPortal: true,
      reminders: false,
    });
    await admin.delete(`/kpis/${id}`).expect(204);
    await modeler.get(`/kpis/${id}`).expect(404);
    expect(
      (await ctx.prisma.auditLog.findMany({ where: { entityType: 'Kpi' } }))
        .map((a) => a.action)
        .sort(),
    ).toEqual(['CREATE', 'DELETE', 'EXPORT', 'EXPORT', 'EXPORT']);
  });
  it('scorecard by objective with filters and as-of month, Excel; portal KPIs follow the setting', async () => {
    const so = (
      await admin.post('/kpis/objectives').send({ code: 'SO-1', nameEn: 'Top' }).expect(201)
    ).body;
    const child = (
      await admin
        .post('/kpis/objectives')
        .send({ code: 'SO-1.1', nameEn: 'Child', parentId: so.id })
        .expect(201)
    ).body;
    const red = (
      await kpi(admin, {
        objectiveIds: [child.id],
        links: [{ processId, bpmnElementId: 'T1' }],
      }).expect(201)
    ).body.item.id;
    const green = (
      await kpi(admin, { code: 'KPI-02', nameEn: 'Green one', objectiveIds: [child.id] }).expect(
        201,
      )
    ).body.item.id;
    await kpi(admin, { code: 'KPI-03', nameEn: 'Lonely' }).expect(201);
    await owner
      .put(`/kpis/${red}/measurements`)
      .send({ period: prev(2), value: 95 })
      .expect(200);
    await owner.put(`/kpis/${red}/measurements`).send({ period: month, value: 70 }).expect(200);
    await owner.put(`/kpis/${green}/measurements`).send({ period: month, value: 99 }).expect(200);

    const card = (await modeler.get('/kpis/scorecard').expect(200)).body;
    expect(card.summary).toMatchObject({ total: 3, GREEN: 1, RED: 1, none: 1 });
    // The parent objective appears (no KPIs of its own), then the child with red first, then the rest.
    expect(
      card.objectives.map((o: { objective: { code: string } | null; level: number }) => [
        o.objective?.code ?? null,
        o.level,
      ]),
    ).toEqual([
      ['SO-1', 1],
      ['SO-1.1', 2],
      [null, 1],
    ]);
    expect(card.objectives[1]).toMatchObject({ worst: 'RED', counts: { RED: 1, GREEN: 1 } });
    expect(card.objectives[1].kpis.map((k: { code: string }) => k.code)).toEqual([
      'KPI-01',
      'KPI-02',
    ]);
    // As of two months ago only the first value counts; filter by process.
    const past = (await modeler.get(`/kpis/scorecard?asOf=${prev(2)}`).expect(200)).body;
    expect(past.objectives[1].kpis[0]).toMatchObject({ latest: { period: prev(2), rag: 'GREEN' } });
    const scoped = (await modeler.get(`/kpis/scorecard?processId=${processId}`).expect(200)).body;
    expect(scoped.summary.total).toBe(1);
    await modeler.get('/kpis/scorecard/export?locale=ar').expect(200);
    await viewer.get('/kpis/scorecard').expect(403);

    // Portal: a published process shows its KPIs only with the setting on (off by default).
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    const reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    const wf = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Review',
          steps: [{ nameEn: 'Review', assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }] }],
        })
        .expect(201)
    ).body.id;
    await admin
      .put('/governance/settings')
      .send({
        reviewIntervalMonths: 12,
        reminderDays: 14,
        reviewDueDays: 5,
        defaultWorkflowId: wf,
        categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
      })
      .expect(200);
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: laneXml(), changeNote: 'v1' })
      .expect(201);
    await modeler.post(`/governance/processes/${processId}/submit`).send({}).expect(200);
    const review = (await reviewer.get('/tasks').expect(200)).body.reviews[0];
    await reviewer.post(`/reviews/${review.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    await modeler.post(`/governance/processes/${processId}/publish`).send({}).expect(200);
    const hidden = (await viewer.get(`/portal/processes/${processId}`).expect(200)).body;
    expect(hidden.kpis).toBeNull();
    expect(hidden.links.some((l: { object: { type: string } }) => l.object.type === 'KPI')).toBe(
      false,
    );
    await admin.put('/kpis/settings').send({ showInPortal: true, reminders: true }).expect(200);
    const shown = (await viewer.get(`/portal/processes/${processId}`).expect(200)).body;
    expect(shown.kpis).toEqual([
      expect.objectContaining({
        code: 'KPI-01',
        bpmnElementId: 'T1',
        latest: expect.objectContaining({ rag: 'RED', value: 70 }),
      }),
    ]);
  });
});

/** Three tasks in two lanes: T1 (60 + 30 min) → T2 (service task, 60 min) in another lane → T3. */
function laneXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Requester"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Finance"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef><bpmn:flowNodeRef>T3</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" />
    <bpmn:userTask id="T1" name="Order" ph:durationMinutes="60" ph:waitingMinutes="30" />
    <bpmn:serviceTask id="T2" name="Post" ph:durationMinutes="60" />
    <bpmn:userTask id="T3" name="Pay" ph:durationMinutes="30" />
    <bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1" />
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="T2" />
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="T3" />
    <bpmn:sequenceFlow id="F4" sourceRef="T3" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`;
}
