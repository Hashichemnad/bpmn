import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  waitJob,
  type Client,
  type TestContext,
} from './helpers';
import JSZip from 'jszip';
import { analysisCsv, importLog } from './mining-fixtures';

const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="Defs_1">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="Process_1" /></bpmn:collaboration>
  <bpmn:process id="Process_1">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="LaneFront" name="Front office"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>Receive</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="LaneBack" name="Back office"><bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>Decide</bpmn:flowNodeRef><bpmn:flowNodeRef>Approve</bpmn:flowNodeRef><bpmn:flowNodeRef>Reject</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start" />
    <bpmn:task id="Receive" name="Receive" ph:durationMinutes="20" ph:frequencyPerMonth="300" />
    <bpmn:task id="Check" name="Check" ph:durationMinutes="40" ph:slaMinutes="240" ph:costPerExecution="25" />
    <bpmn:exclusiveGateway id="Decide" />
    <bpmn:task id="Approve" name="Approve" ph:durationMinutes="10" />
    <bpmn:task id="Reject" name="Reject" ph:durationMinutes="10" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Receive" />
    <bpmn:sequenceFlow id="F2" sourceRef="Receive" targetRef="Check" />
    <bpmn:sequenceFlow id="F3" sourceRef="Check" targetRef="Decide" />
    <bpmn:sequenceFlow id="F4" sourceRef="Decide" targetRef="Approve" />
    <bpmn:sequenceFlow id="F5" sourceRef="Decide" targetRef="Reject" />
    <bpmn:sequenceFlow id="F6" sourceRef="Approve" targetRef="End" />
    <bpmn:sequenceFlow id="F7" sourceRef="Reject" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

/** Simulation (Phase 5.1 step 4): scenarios, validation, runs, comparison, AI proposals. */
describe('Mining — simulation (e2e)', () => {
  let ctx: TestContext;
  let analyst: Client;
  let reader: Client;
  let viewer: Client;
  let processId: string;

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
    const dep = await ctx.prisma.department.create({ data: { nameEn: 'Ops', nameAr: 'العمليات' } });
    await createUser(ctx.prisma, 'analyst@test.local', ['PERFORMANCE_OFFICER', 'MODELER'], {
      departmentId: dep.id,
    });
    await createUser(ctx.prisma, 'reader@test.local', ['AUDITOR'], { departmentId: dep.id });
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    analyst = await loggedIn(ctx.app, 'analyst@test.local');
    reader = await loggedIn(ctx.app, 'reader@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    processId = (
      await analyst
        .post('/processes')
        .send({ code: 'C.10', nameEn: 'Requests', category: 'CORE' })
        .expect(201)
    ).body.id;
    await analyst.put(`/processes/${processId}/model`).send({ bpmnXml: MODEL }).expect(200);
    // A linked log gives the default branch probabilities (16 approved / 4 rejected).
    await importLog(analyst, analysisCsv(), { processId });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates a simulation with an as-is scenario and defaults from mining', async () => {
    const d = (await analyst.get(`/simulations/defaults?processId=${processId}`).expect(200)).body;
    expect(d.probabilities).toEqual({ F4: 80, F5: 20 });
    const sim = (
      await analyst.post('/simulations').send({ processId, nameEn: 'Staffing' }).expect(201)
    ).body;
    expect(sim).toMatchObject({ code: 'SIM-001', canManage: true });
    expect(sim.scenarios).toHaveLength(1);
    const asIs = sim.scenarios[0];
    expect(asIs).toMatchObject({ kind: 'AS_IS', result: null });
    expect(asIs.params.probabilities).toEqual({ F4: 80, F5: 20 });
    expect(asIs.params.arrival.unit).toBe('model');
    expect(asIs.params.resources).toEqual({
      LaneFront: { capacity: 1, costPerHour: 0 },
      LaneBack: { capacity: 1, costPerHour: 0 },
    });
    expect(asIs.issues).toEqual([]);
    expect(sim.model.gateways[0]).toMatchObject({ id: 'Decide' });
    expect(sim.model.arrivalsPerMonth).toBe(300);
    await viewer.get(`/simulations/${sim.id}`).expect(403);
    await reader.post('/simulations').send({ processId, nameEn: 'x' }).expect(403);
  });

  it('validates, runs and compares as-is and to-be scenarios', async () => {
    const sim = (await analyst.get('/simulations').expect(200)).body[0];
    let dto = (await analyst.get(`/simulations/${sim.id}`).expect(200)).body;
    const asIs = dto.scenarios[0];
    // Invalid probabilities block the run with a clear message.
    dto = (
      await analyst
        .post(`/simulations/${sim.id}/scenarios`)
        .send({
          copyFrom: asIs.id,
          nameEn: 'Broken',
          params: { ...asIs.params, probabilities: { F4: 50, F5: 20 } },
        })
        .expect(201)
    ).body;
    const broken = dto.scenarios[1];
    expect(broken.issues).toEqual([
      expect.objectContaining({ code: 'PROBABILITIES_SUM', elementId: 'Decide', value: 70 }),
    ]);
    const blocked = await analyst.post(`/simulations/${sim.id}/run`).send({}).expect(400);
    expect(blocked.body.code).toBe('SIMULATION_INVALID');
    dto = (await analyst.delete(`/simulations/${sim.id}/scenarios/${broken.id}`).expect(200)).body;

    // To-be: two people in the back office.
    dto = (
      await analyst
        .post(`/simulations/${sim.id}/scenarios`)
        .send({
          copyFrom: asIs.id,
          nameEn: 'Two checkers',
          params: {
            ...asIs.params,
            resources: { ...asIs.params.resources, LaneBack: { capacity: 2, costPerHour: 0 } },
          },
        })
        .expect(201)
    ).body;
    const jobs = (await analyst.post(`/simulations/${sim.id}/run`).send({}).expect(201)).body;
    expect(jobs).toHaveLength(2);
    for (const j of jobs) expect((await waitJob(analyst, j.id)).status).toBe('DONE');
    dto = (await reader.get(`/simulations/${sim.id}`).expect(200)).body;
    const [a, b] = dto.scenarios;
    expect(a.result.cases.completed).toBeGreaterThan(100);
    expect(a.resultModel).toBe('working');
    expect(a.stale).toBe(false);
    // Twice the capacity: lower utilisation, shorter throughput.
    const back = (s: typeof a) =>
      s.result.resources.find((r: { laneId: string }) => r.laneId === 'LaneBack');
    expect(back(b).utilisation).toBeLessThan(back(a).utilisation);
    expect(b.result.throughput.mean).toBeLessThanOrEqual(a.result.throughput.mean);
    expect(a.result.costPerCase).toBeCloseTo(25, 0);
    // Changing a parameter marks the result stale.
    dto = (
      await analyst
        .patch(`/simulations/${sim.id}/scenarios/${b.id}`)
        .send({ params: { ...b.params, seed: 7 } })
        .expect(200)
    ).body;
    expect(dto.scenarios[1].stale).toBe(true);

    const xlsx = await reader.get(`/simulations/${sim.id}/export`).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('explains results and proposes scenarios with AI (proposals only)', async () => {
    const sim = (await analyst.get('/simulations').expect(200)).body[0];
    // AI disabled → 403; enabled with a key → answers from the fake provider.
    await analyst.post(`/simulations/${sim.id}/ai/explain`).expect(403);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const su = await loggedIn(ctx.app, 'super@test.local');
    await su
      .put('/ai/settings')
      .send({
        enabled: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        fastModel: 'claude-haiku-5-5',
        apiKey: ctx.ai.validKey,
        allowedRoles: ['PERFORMANCE_OFFICER', 'MODELER'],
        userDailyLimit: 0,
        orgMonthlyLimit: 0,
        noticeEn: '',
        noticeAr: '',
      })
      .expect(200);
    ctx.ai.reply('The back office is the bottleneck.');
    const ex = (await analyst.post(`/simulations/${sim.id}/ai/explain`).expect(200)).body;
    expect(ex.text).toContain('bottleneck');
    expect(ctx.ai.requests.at(-1)!.messages[0].text).toContain('lane LaneBack');
    ctx.ai.reply({
      proposals: [
        {
          nameEn: 'Third checker',
          nameAr: 'مدقق ثالث',
          rationale: 'Back office utilisation is high.',
          capacities: { LaneBack: 3, Invented: 9 },
          durations: { Check: 30 },
        },
      ],
    });
    const sg = (await analyst.post(`/simulations/${sim.id}/ai/suggest`).expect(200)).body;
    expect(sg.proposals[0].capacities).toEqual({ LaneBack: 3 });
    // Proposals change nothing by themselves.
    expect((await analyst.get(`/simulations/${sim.id}`).expect(200)).body.scenarios).toHaveLength(
      2,
    );
  });

  it('shows aggregated performance in the portal (setting, published only) and in the handbook', async () => {
    const url = `/mining/portal/processes/${processId}/performance`;
    await viewer.get(url).expect(404); // setting off by default
    await ctx.prisma.setting.create({
      data: { key: 'mining', value: { portalPerformance: true } },
    });
    await viewer.get(url).expect(404); // not published
    await ctx.prisma.publication.create({
      data: { entityType: 'PROCESS', entityId: processId, versionNumber: 1, titleEn: 'Requests' },
    });
    const perf = (await viewer.get(url).expect(200)).body;
    expect(perf).toMatchObject({ cases: 20, granularity: 'week' });
    expect(perf.throughput.mean).toBeGreaterThan(0);
    expect(perf.trend.length).toBeGreaterThan(0);
    expect(perf.conformance.conformingShare).toBeCloseTo(0.75);
    // Aggregated values only: no case ids, resources or the log.
    expect(JSON.stringify(perf)).not.toMatch(/C1\b|ann|bob|LOG-/);

    const res = await analyst
      .post('/reports/handbook')
      .send({
        processId,
        includeChildren: false,
        locale: 'en',
        includePerformance: true,
        images: [],
      })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const xml = await (
      await JSZip.loadAsync(res.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    for (const text of [
      'Performance analysis',
      'LOG-001',
      'Cases with rework',
      'SIM-001',
      'highest utilisation',
    ])
      expect(xml).toContain(text);
  });

  it('uses the central public holiday list maintained by admins (D-143)', async () => {
    const list = (await analyst.get('/simulations/holidays').expect(200)).body;
    expect(list.find((h: { nameEn: string }) => h.nameEn === 'Eid al-Fitr')).toMatchObject({
      expected: true,
    });
    // Performance Officers read it; Super Admins and Admins maintain it.
    await analyst.put('/simulations/holidays').send({ holidays: list }).expect(403);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    await admin
      .put('/simulations/holidays')
      .send({ holidays: [{ date: '2026-01-01' }, { date: '2026-01-01' }] })
      .expect(400);
    const sim = (await analyst.get('/simulations').expect(200)).body[0];
    let dto = (await analyst.get(`/simulations/${sim.id}`).expect(200)).body;
    // Second scenario: its own list (not affected by the central list).
    const own = dto.scenarios[1];
    await analyst
      .patch(`/simulations/${sim.id}/scenarios/${own.id}`)
      .send({
        params: {
          ...own.params,
          calendar: { ...own.params.calendar, useCentralHolidays: false, holidays: [] },
        },
      })
      .expect(200);
    for (const j of (await analyst.post(`/simulations/${sim.id}/run`).send({}).expect(201)).body)
      await waitJob(analyst, j.id);
    dto = (await analyst.get(`/simulations/${sim.id}`).expect(200)).body;
    expect(dto.scenarios.map((x: { stale: boolean }) => x.stale)).toEqual([false, false]);
    // Confirming a date / adding a holiday changes the central list: scenarios using it become stale.
    const saved = (
      await admin
        .put('/simulations/holidays')
        .send({
          holidays: [
            ...list,
            { date: '2026-11-30', nameEn: 'Extra day', nameAr: 'يوم إضافي', expected: false },
          ],
        })
        .expect(200)
    ).body;
    expect(saved.some((h: { date: string }) => h.date === '2026-11-30')).toBe(true);
    dto = (await analyst.get(`/simulations/${sim.id}`).expect(200)).body;
    expect(dto.scenarios[0].params.calendar.useCentralHolidays).toBe(true);
    expect(dto.scenarios.map((x: { stale: boolean }) => x.stale)).toEqual([true, false]);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { entityId: 'mining.holidays' } });
    expect(audit?.summary).toMatchObject({ added: ['2026-11-30'] });
  });
});
