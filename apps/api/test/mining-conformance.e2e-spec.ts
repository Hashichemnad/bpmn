import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  waitJob,
  type Client,
  type TestContext,
} from './helpers';
import { analysisCsv, importLog } from './mining-fixtures';
import { setPhAttributes } from '../src/mining/bpmn-attributes';

const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="Defs_1">
  <bpmn:process id="Process_1">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="Receive" name="Receive" ph:nameEn="Receive" ph:durationMinutes="10" ph:slaMinutes="90" />
    <bpmn:task id="Check" name="Check" ph:nameEn="Check" ph:durationMinutes="60" />
    <bpmn:exclusiveGateway id="Decide" />
    <bpmn:task id="Approve" name="Approve" ph:nameEn="Approve" />
    <bpmn:task id="Reject" name="Reject" ph:nameEn="Reject" />
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

/** Conformance (Phase 5.1 step 3): replay, overlay data, mining KPIs, step attribute updates. */
describe('Mining — conformance (e2e)', () => {
  let ctx: TestContext;
  let analyst: Client;
  let viewer: Client;
  let processId: string;
  let logId: string;

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
    const dep = await ctx.prisma.department.create({ data: { nameEn: 'Ops', nameAr: 'العمليات' } });
    await createUser(ctx.prisma, 'analyst@test.local', ['PERFORMANCE_OFFICER', 'MODELER'], {
      departmentId: dep.id,
    });
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER'], { departmentId: dep.id });
    analyst = await loggedIn(ctx.app, 'analyst@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    processId = (
      await analyst
        .post('/processes')
        .send({ code: 'C.09', nameEn: 'Requests', category: 'CORE' })
        .expect(201)
    ).body.id;
    await analyst.put(`/processes/${processId}/model`).send({ bpmnXml: MODEL }).expect(200);
    // 20 cases (see analysisCsv): 5 with a repeated "Check", 4 rejected.
    logId = await importLog(analyst, analysisCsv(), { processId });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('replays the log on the model: fitness, conforming cases, deviations, step and flow counts', async () => {
    const acts = (await analyst.get(`/mining/logs/${logId}/activities`).expect(200)).body.items;
    expect(acts.every((a: { elementId: string | null }) => a.elementId)).toBe(true);
    const res = (await analyst.post(`/mining/logs/${logId}/conformance`).send({}).expect(200)).body;
    expect(res.status).toBe('DONE');
    const r = res.result;
    expect(r).toMatchObject({ cases: 20, conformingCases: 15 });
    expect(r.fitness).toBe(1); // repetitions are inserted events, not missing tokens
    expect(r.deviations).toEqual([
      expect.objectContaining({
        kind: 'INSERTED',
        elementId: 'Check',
        activity: 'Check',
        cases: 5,
      }),
    ]);
    expect(r.elements.Check).toMatchObject({ cases: 20, events: 25, deviations: 5 });
    expect(r.elements.Receive.processing.median).toBe(3_600_000);
    expect(r.flows).toMatchObject({ F4: 16, F5: 4, F2: 20 });
    const logs = (await analyst.get(`/mining/processes/${processId}/logs`).expect(200)).body;
    expect(logs).toEqual([
      expect.objectContaining({ id: logId, caseCount: 20, mappedActivities: 4 }),
    ]);
    await viewer.get(`/mining/processes/${processId}/logs`).expect(403);
  });

  it('suggests measured step times and applies accepted ones as a new version', async () => {
    const list = (await analyst.get(`/mining/logs/${logId}/step-suggestions`).expect(200)).body;
    const receive = list.find((s: { elementId: string }) => s.elementId === 'Receive');
    expect(receive).toMatchObject({
      plannedDuration: 10,
      measuredDuration: 60,
      suggestDuration: true,
      observations: 20,
    });
    const check = list.find((s: { elementId: string }) => s.elementId === 'Check');
    expect(check).toMatchObject({
      plannedDuration: 60,
      measuredDuration: 60,
      suggestDuration: false,
    });
    const applied = (
      await analyst
        .post(`/mining/logs/${logId}/step-suggestions/apply`)
        .send({
          items: [
            {
              elementId: 'Receive',
              durationMinutes: 60,
              waitingMinutes: receive.measuredWaiting ?? 0,
            },
          ],
          changeNote: 'Step times from event log LOG-001',
        })
        .expect(201)
    ).body;
    expect(applied.version.changeNote).toBe('Step times from event log LOG-001');
    const model = await ctx.prisma.processModel.findUniqueOrThrow({ where: { processId } });
    expect(model.bpmnXml).toMatch(/id="Receive"[^>]*ph:durationMinutes="60"/);
    expect(model.bpmnXml).not.toMatch(/id="Receive"[^>]*ph:durationMinutes="10"/);
    // The new model changes the conformance cache key (no stale result).
    expect(
      (await analyst.post(`/mining/logs/${logId}/conformance`).send({}).expect(200)).body.status,
    ).toBe('DONE');
  });

  it('calculates KPIs from the event log per period', async () => {
    const create = (metric: string, code: string) =>
      analyst
        .post('/kpis')
        .send({
          code,
          nameEn: code,
          unit: 'h',
          frequency: 'MONTHLY',
          dataSource: 'EVENT_LOG',
          calculatedMetric: metric,
          miningLogId: logId,
          target: 10,
          direction: 'LOWER_IS_BETTER',
        })
        .expect(201);
    await analyst
      .post('/kpis')
      .send({ code: 'BAD', nameEn: 'x', dataSource: 'EVENT_LOG', calculatedMetric: 'MINING_CASES' })
      .expect(400);
    const tp = (await create('MINING_THROUGHPUT_HOURS', 'KPI-M1')).body.item;
    const rw = (await create('MINING_REWORK_RATE', 'KPI-M2')).body.item;
    const sla = (await create('MINING_SLA_SHARE', 'KPI-M3')).body.item;
    const rec = await analyst.post(`/mining/kpis/${tp.id}/recalculate`);
    expect(rec.body).toMatchObject({ status: expect.any(String) });
    const job = rec.body;
    await waitJob(analyst, job.id);
    await waitJob(
      analyst,
      (await analyst.post(`/mining/kpis/${rw.id}/recalculate`).expect(200)).body.id,
    );
    await waitJob(
      analyst,
      (await analyst.post(`/mining/kpis/${sla.id}/recalculate`).expect(200)).body.id,
    );
    const m = await ctx.prisma.kpiMeasurement.findMany({ where: { kpiId: tp.id } });
    // All cases are in February 2026 (Asia/Dubai): 15 cases of 7 h, 4 rejected of 13 h, 1 rejected
    // with rework of 13 h — see analysisCsv.
    expect(m.map((x) => x.period)).toEqual(['2026-02']);
    expect(m[0].source).toBe('EVENT_LOG');
    expect(m[0].value).toBeGreaterThan(7);
    const rework = await ctx.prisma.kpiMeasurement.findFirstOrThrow({ where: { kpiId: rw.id } });
    expect(rework.value).toBe(25);
    // Receive: SLA 90 min, takes 60 min, first step (no waiting) → 100 %.
    const slaM = await ctx.prisma.kpiMeasurement.findFirstOrThrow({ where: { kpiId: sla.id } });
    expect(slaM.value).toBe(100);
    const dto = (await analyst.get(`/kpis/${tp.id}`).expect(200)).body.item;
    expect(dto).toMatchObject({
      dataSource: 'EVENT_LOG',
      calculatedMetric: 'MINING_THROUGHPUT_HOURS',
    });
    expect(dto.miningLog.id).toBe(logId);
  });

  it('sets ph attributes in BPMN XML', () => {
    const xml =
      '<bpmn:definitions xmlns:bpmn="x"><bpmn:task id="A" name="a" /><bpmn:task id="AB" /></bpmn:definitions>';
    const out = setPhAttributes(xml, 'A', { durationMinutes: '5' });
    expect(out).toContain('<bpmn:task id="A" name="a" ph:durationMinutes="5" />');
    expect(out).toContain('xmlns:ph="http://processhub.io/schema/bpmn"');
    expect(setPhAttributes(out, 'A', { durationMinutes: null })).toContain(
      '<bpmn:task id="A" name="a" />',
    );
    expect(setPhAttributes(out, 'AB', { waitingMinutes: '1' })).toContain(
      '<bpmn:task id="AB" ph:waitingMinutes="1" />',
    );
  });
});
