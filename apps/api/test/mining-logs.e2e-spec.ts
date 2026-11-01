import ExcelJS from 'exceljs';
import { MiningScheduler } from '../src/mining/mining-scheduler.service';
import { MiningJobsService } from '../src/mining/jobs/mining-jobs.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  waitJob,
  type Client,
  type TestContext,
} from './helpers';

/** BPMN with bilingual labels and a dictionary term reference (activity auto-matching). */
export function miningBpmn(termId = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="Defs_1">
  <bpmn:process id="Process_1">
    <bpmn:startEvent id="Start" name="Request received" ph:nameEn="Request received" ph:nameAr="استلام الطلب" />
    <bpmn:task id="Check" name="Check request" ph:nameEn="Check request" ph:nameAr="تدقيق الطلب" />
    <bpmn:task id="Approve" name="Approve" ph:nameEn="Approve" ph:nameAr="اعتماد" ${termId ? `ph:labelRef="${termId}"` : ''} />
    <bpmn:endEvent id="End" name="Done" ph:nameEn="Done" ph:nameAr="تم" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Check" />
    <bpmn:sequenceFlow id="F2" sourceRef="Check" targetRef="Approve" />
    <bpmn:sequenceFlow id="F3" sourceRef="Approve" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;
}

const CSV = [
  'Case ID;Activity;Start time;End time;Employee;Department;Amount',
  '1001;Check request;01/03/2026 08:00;01/03/2026 09:00;Sara;Finance;500',
  '1001;Sign-off;01/03/2026 10:00;01/03/2026 10:30;Omar;Finance;500',
  '1002;تدقيق الطلب;02/03/2026 08:00;02/03/2026 08:45;Sara;Finance;700',
  '1002;Sign-off;02/03/2026 09:00;02/03/2026 11:00;Omar;Finance;700',
  '1002;Sign-off;02/03/2026 09:00;02/03/2026 11:00;Omar;Finance;700', // duplicate
  ';Check request;03/03/2026 08:00;03/03/2026 09:00;Sara;Finance;100', // missing case
  '1003;Check request;yesterday;03/03/2026 09:00;Sara;Finance;100', // unparsable start
  '1004;Archive;13/03/2026 08:00;13/03/2026 08:10;Lina;Archive;0',
].join('\n');

const XES = `<?xml version="1.0" encoding="UTF-8"?>
<log xes.version="1.0" xmlns="http://www.xes-standard.org/">
  <string key="concept:name" value="demo"/>
  <trace>
    <string key="concept:name" value="T1"/>
    <string key="channel" value="web"/>
    <event><string key="concept:name" value="A"/><string key="lifecycle:transition" value="start"/><date key="time:timestamp" value="2026-01-01T08:00:00.000+04:00"/><string key="org:resource" value="Ali"/></event>
    <event><string key="concept:name" value="A"/><string key="lifecycle:transition" value="complete"/><date key="time:timestamp" value="2026-01-01T09:00:00.000+04:00"/><string key="org:resource" value="Ali"/></event>
    <event><string key="concept:name" value="B"/><string key="lifecycle:transition" value="complete"/><date key="time:timestamp" value="2026-01-01T10:00:00.000+04:00"/></event>
  </trace>
  <trace>
    <string key="concept:name" value="T2"/>
    <event><string key="concept:name" value="B"/><date key="time:timestamp" value="2026-01-02T10:00:00.000Z"/></event>
  </trace>
</log>`;

/** Event logs (Phase 5.1): upload, preview, mapping, validation, import, access, delete, retention. */
describe('Mining — event logs (e2e)', () => {
  let ctx: TestContext;
  let analyst: Client;
  let colleague: Client;
  let outsider: Client;
  let modeler: Client;
  let viewer: Client;
  let processId: string;
  let outsiderId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const fin = await ctx.prisma.department.create({
      data: { nameEn: 'Finance', nameAr: 'المالية' },
    });
    const hr = await ctx.prisma.department.create({ data: { nameEn: 'HR', nameAr: 'الموارد' } });
    await createUser(ctx.prisma, 'analyst@test.local', ['PERFORMANCE_OFFICER'], {
      departmentId: fin.id,
    });
    await createUser(ctx.prisma, 'colleague@test.local', ['MODELER'], { departmentId: fin.id });
    outsiderId = (
      await createUser(ctx.prisma, 'outsider@test.local', ['PROCESS_OWNER'], {
        departmentId: hr.id,
      })
    ).id;
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER'], { departmentId: hr.id });
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER'], { departmentId: fin.id });
    analyst = await loggedIn(ctx.app, 'analyst@test.local');
    colleague = await loggedIn(ctx.app, 'colleague@test.local');
    outsider = await loggedIn(ctx.app, 'outsider@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    const term = await ctx.prisma.repoObject.create({
      data: {
        type: 'TERM',
        nameEn: 'Approve',
        nameAr: 'اعتماد',
        synonymsEn: ['Sign-off'],
        status: 'APPROVED',
      },
    });
    processId = (
      await modeler
        .post('/processes')
        .send({ code: 'C.01', nameEn: 'Requests', category: 'CORE' })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: miningBpmn(term.id) })
      .expect(200);
  });

  const upload = (
    c: Client,
    data: Buffer | string,
    name: string,
    fields: Record<string, string> = {},
  ) => {
    let req = c.post('/mining/logs/upload').attach('file', Buffer.from(data), name);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  };

  it('uploads a CSV, previews, validates, imports and maps activities to steps', async () => {
    const log = (
      await upload(analyst, CSV, 'requests.csv', { nameEn: 'Requests 2026', processId }).expect(201)
    ).body;
    expect(log).toMatchObject({
      code: 'LOG-001',
      status: 'DRAFT',
      fileFormat: 'CSV',
      canManage: true,
    });

    const preview = (await analyst.get(`/mining/logs/${log.id}/preview`).expect(200)).body;
    expect(preview.delimiter).toBe(';');
    expect(preview.rows).toHaveLength(8);
    expect(preview.suggestion).toMatchObject({
      caseColumn: 'Case ID',
      activityColumn: 'Activity',
      startColumn: 'Start time',
      endColumn: 'End time',
      resourceColumn: 'Employee',
      departmentColumn: 'Department',
      timestampFormat: 'dmy',
    });
    expect(
      preview.columns.find((c: { name: string }) => c.name === 'End time').timestampFormat,
    ).toBe('dmy');

    await analyst
      .put(`/mining/logs/${log.id}/mapping`)
      .send({ ...preview.suggestion, attributeColumns: ['Nope'] })
      .expect(400);
    const mapping = { ...preview.suggestion, attributeColumns: ['Amount'], timestampFormat: null };
    await analyst.put(`/mining/logs/${log.id}/mapping`).send(mapping).expect(200);

    // Validation report (dry run).
    const vjob = (await analyst.post(`/mining/logs/${log.id}/validate`).expect(201)).body;
    const validated = await waitJob(analyst, vjob.id);
    expect(validated.status).toBe('DONE');
    expect(validated.result).toMatchObject({
      rows: 8,
      events: 5,
      cases: 3,
      missingCase: 1,
      unparsableTimestamp: 1,
      duplicates: 1,
      skipped: 3,
      timestampFormat: 'dmy',
    });
    expect(await ctx.prisma.miningEvent.count()).toBe(0);

    // Import.
    const ijob = (await analyst.post(`/mining/logs/${log.id}/import`).expect(201)).body;
    expect((await waitJob(analyst, ijob.id)).status).toBe('DONE');
    const ready = (await analyst.get(`/mining/logs/${log.id}`).expect(200)).body;
    expect(ready).toMatchObject({
      status: 'READY',
      caseCount: 3,
      eventCount: 5,
      activityCount: 4,
      resourceCount: 3,
      hasStartTimes: true,
      dataVersion: 1,
      attributeNames: ['Amount'],
    });
    // 01/03/2026 08:00 in Asia/Dubai = 04:00 UTC.
    expect(ready.periodStart).toBe('2026-03-01T04:00:00.000Z');
    expect(await ctx.prisma.miningEvent.count({ where: { logId: log.id } })).toBe(5);

    // Activities matched by label (EN / AR) and by dictionary synonym.
    const acts = (await analyst.get(`/mining/logs/${log.id}/activities`).expect(200)).body;
    const byName = Object.fromEntries(acts.items.map((a: { name: string }) => [a.name, a]));
    expect(byName['Check request']).toMatchObject({
      elementId: 'Check',
      match: 'LABEL',
      eventCount: 1,
    });
    expect(byName['تدقيق الطلب']).toMatchObject({ elementId: 'Check', match: 'LABEL' });
    expect(byName['Sign-off']).toMatchObject({
      elementId: 'Approve',
      match: 'SYNONYM',
      caseCount: 2,
    });
    expect(byName.Archive.elementId).toBeNull();
    expect(acts.steps.map((s: { id: string }) => s.id)).toEqual([
      'Start',
      'Check',
      'Approve',
      'End',
    ]);

    // Manual mapping.
    await analyst
      .put(`/mining/logs/${log.id}/activities`)
      .send({ items: [{ activity: 'Archive', elementId: 'Nope' }] })
      .expect(400);
    const mapped = (
      await analyst
        .put(`/mining/logs/${log.id}/activities`)
        .send({ items: [{ activity: 'Archive', elementId: 'End' }] })
        .expect(200)
    ).body;
    expect(mapped.items.find((a: { name: string }) => a.name === 'Archive')).toMatchObject({
      elementId: 'End',
      match: 'MANUAL',
    });

    // Case drill-down.
    const events = (await analyst.get(`/mining/logs/${log.id}/cases/1002`).expect(200)).body;
    expect(events.map((e: { activity: string }) => e.activity)).toEqual([
      'تدقيق الطلب',
      'Sign-off',
    ]);
    expect(events[0]).toMatchObject({
      resource: 'Sara',
      department: 'Finance',
      attributes: { Amount: '700' },
    });

    // Mapping template.
    const tpl = (
      await analyst
        .post('/mining/templates')
        .send({ name: 'Requests CSV', format: 'CSV', mapping })
        .expect(201)
    ).body;
    expect(
      (await analyst.get('/mining/templates').expect(200)).body.map((t: { id: string }) => t.id),
    ).toEqual([tpl.id]);

    // Hard delete (audited): events and log are gone.
    const djob = (await analyst.delete(`/mining/logs/${log.id}`).expect(200)).body;
    await analyst.get(`/mining/logs/${log.id}`).expect(404);
    await waitJob(analyst, djob.id);
    expect(await ctx.prisma.miningEvent.count()).toBe(0);
    expect(await ctx.prisma.eventLog.count()).toBe(0);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'EventLog' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['CREATE', 'UPDATE', 'IMPORT', 'DELETE']),
    );
  });

  it('imports XES with lifecycle pairs and Excel files', async () => {
    const xes = (await upload(analyst, XES, 'demo.xes', { nameEn: 'XES' }).expect(201)).body;
    const preview = (await analyst.get(`/mining/logs/${xes.id}/preview`).expect(200)).body;
    expect(preview.format).toBe('XES');
    expect(preview.suggestion).toMatchObject({
      caseColumn: 'case:concept:name',
      activityColumn: 'concept:name',
      startColumn: 'time:start',
      endColumn: 'time:timestamp',
      resourceColumn: 'org:resource',
    });
    await analyst
      .put(`/mining/logs/${xes.id}/mapping`)
      .send({ ...preview.suggestion, attributeColumns: ['case:channel'] })
      .expect(200);
    await waitJob(
      analyst,
      (await analyst.post(`/mining/logs/${xes.id}/import`).expect(201)).body.id,
    );
    const ready = (await analyst.get(`/mining/logs/${xes.id}`).expect(200)).body;
    expect(ready).toMatchObject({
      status: 'READY',
      caseCount: 2,
      eventCount: 3,
      hasStartTimes: true,
    });
    const t1 = (await analyst.get(`/mining/logs/${xes.id}/cases/T1`).expect(200)).body;
    expect(t1[0]).toMatchObject({
      activity: 'A',
      startAt: '2026-01-01T04:00:00.000Z',
      endAt: '2026-01-01T05:00:00.000Z',
      attributes: { 'case:channel': 'web' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Events');
    ws.addRow(['Case', 'Activity', 'Timestamp', 'User']);
    ws.addRow(['X1', 'Open', new Date(Date.UTC(2026, 4, 1, 9, 0)), 'u1']);
    ws.addRow(['X1', 'Close', new Date(Date.UTC(2026, 4, 1, 12, 0)), 'u2']);
    ws.addRow(['X2', 'Open', new Date(Date.UTC(2026, 4, 2, 9, 0)), 'u1']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const xlsx = (await upload(analyst, buf, 'events.xlsx', { nameEn: 'Excel' }).expect(201)).body;
    const p2 = (await analyst.get(`/mining/logs/${xlsx.id}/preview`).expect(200)).body;
    expect(p2).toMatchObject({ format: 'XLSX', sheets: ['Events'] });
    expect(p2.suggestion).toMatchObject({
      caseColumn: 'Case',
      activityColumn: 'Activity',
      endColumn: 'Timestamp',
      resourceColumn: 'User',
    });
    await analyst.put(`/mining/logs/${xlsx.id}/mapping`).send(p2.suggestion).expect(200);
    await waitJob(
      analyst,
      (await analyst.post(`/mining/logs/${xlsx.id}/import`).expect(201)).body.id,
    );
    const x = (await analyst.get(`/mining/logs/${xlsx.id}`).expect(200)).body;
    expect(x).toMatchObject({ status: 'READY', caseCount: 2, eventCount: 3, hasStartTimes: false });
    // Excel date cells are wall-clock times in Asia/Dubai.
    expect(x.periodStart).toBe('2026-05-01T05:00:00.000Z');
  });

  it('rejects other file types and checks the mapping', async () => {
    await upload(analyst, Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'tool.exe').expect(400);
    await upload(analyst, '%PDF-1.4 nope', 'file.pdf').expect(400);
    const log = (await upload(analyst, CSV, 'r.csv', { nameEn: 'R' }).expect(201)).body;
    await analyst.post(`/mining/logs/${log.id}/import`).expect(400); // no mapping yet
    await analyst
      .put(`/mining/logs/${log.id}/mapping`)
      .send({ caseColumn: 'Case ID', activityColumn: 'Activity' })
      .expect(400); // no timestamp column
  });

  it('pseudonymises case ids and resources and drops the uploaded file', async () => {
    const log = (await upload(analyst, CSV, 'r.csv', { nameEn: 'Private' }).expect(201)).body;
    const preview = (await analyst.get(`/mining/logs/${log.id}/preview`).expect(200)).body;
    await analyst
      .put(`/mining/logs/${log.id}/mapping`)
      .send({ ...preview.suggestion, pseudonymise: true })
      .expect(200);
    await waitJob(
      analyst,
      (await analyst.post(`/mining/logs/${log.id}/import`).expect(201)).body.id,
    );
    const events = await ctx.prisma.miningEvent.findMany({ where: { logId: log.id } });
    expect(events.every((e) => /^C-[0-9a-f]{12}$/.test(e.caseId))).toBe(true);
    expect(events.every((e) => !e.resource || /^R-[0-9a-f]{12}$/.test(e.resource))).toBe(true);
    expect(new Set(events.map((e) => e.caseId)).size).toBe(3);
    const after = (await analyst.get(`/mining/logs/${log.id}`).expect(200)).body;
    expect(after).toMatchObject({ pseudonymised: true, status: 'READY' });
    expect(ctx.storage.files.has(`mining/${log.id}/source.csv`)).toBe(false);
  });

  it('limits logs to owner, department and granted users', async () => {
    const log = (await upload(analyst, CSV, 'r.csv', { nameEn: 'Finance log' }).expect(201)).body;
    // Same department (read only for a Modeler), other department hidden, Viewers have no access.
    expect((await colleague.get('/mining/logs').expect(200)).body.total).toBe(1);
    const seen = (await colleague.get(`/mining/logs/${log.id}`).expect(200)).body;
    expect(seen.canManage).toBe(false);
    await colleague.patch(`/mining/logs/${log.id}`).send({ nameEn: 'x' }).expect(403);
    expect((await outsider.get('/mining/logs').expect(200)).body.total).toBe(0);
    await outsider.get(`/mining/logs/${log.id}`).expect(404);
    await outsider.patch(`/mining/logs/${log.id}`).send({ nameEn: 'x' }).expect(404);
    await viewer.get('/mining/logs').expect(403);
    await modeler.post('/mining/logs/upload').attach('file', Buffer.from(CSV), 'r.csv').expect(403);
    // Granted: visible, still not manageable (the outsider's department differs).
    await analyst
      .put(`/mining/logs/${log.id}/grants`)
      .send({ userIds: [outsiderId] })
      .expect(200);
    expect((await outsider.get(`/mining/logs/${log.id}`).expect(200)).body.canManage).toBe(false);
    await outsider.delete(`/mining/logs/${log.id}`).expect(403);
  });

  it('creates a log from ProcessHub governance reviews', async () => {
    const owner = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'analyst@test.local' },
    });
    const reviewer = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'colleague@test.local' },
    });
    const t0 = Date.UTC(2026, 5, 1, 6);
    for (let i = 0; i < 3; i++) {
      const review = await ctx.prisma.review.create({
        data: {
          entityType: 'PROCESS',
          entityId: processId,
          versionNumber: i + 1,
          status: i === 2 ? 'WITHDRAWN' : 'APPROVED',
          steps: [
            {
              nameEn: 'Owner approval',
              nameAr: 'موافقة المالك',
              rule: 'ANY',
              assigneeIds: [reviewer.id],
            },
          ],
          submittedById: owner.id,
          submittedAt: new Date(t0 + i * 86_400_000),
          completedAt: new Date(t0 + i * 86_400_000 + 7_200_000),
        },
      });
      if (i < 2)
        await ctx.prisma.reviewTask.create({
          data: {
            reviewId: review.id,
            stepIndex: 0,
            assigneeId: reviewer.id,
            status: 'APPROVED',
            createdAt: new Date(t0 + i * 86_400_000),
            decidedAt: new Date(t0 + i * 86_400_000 + 3_600_000),
          },
        });
    }
    // A review of a page in a view-restricted space never reaches the log (SEC-20).
    const closed = await ctx.prisma.space.create({
      data: { key: 'HRX', nameEn: 'HR', viewRestricted: true },
    });
    const secret = await ctx.prisma.page.create({
      data: { spaceId: closed.id, titleEn: 'Secret dismissal procedure', version: 1 },
    });
    await ctx.prisma.review.create({
      data: {
        entityType: 'PAGE',
        entityId: secret.id,
        versionNumber: 1,
        status: 'APPROVED',
        steps: [],
        submittedById: owner.id,
        submittedAt: new Date(t0),
      },
    });
    const log = (
      await analyst.post('/mining/logs/processhub').send({ nameEn: 'Reviews' }).expect(201)
    ).body;
    expect(log.source).toBe('PROCESSHUB');
    const jobId = (await ctx.prisma.miningJob.findFirstOrThrow({ where: { logId: log.id } })).id;
    expect((await waitJob(analyst, jobId)).status).toBe('DONE');
    const ready = (await analyst.get(`/mining/logs/${log.id}`).expect(200)).body;
    expect(ready).toMatchObject({
      status: 'READY',
      caseCount: 3,
      eventCount: 6,
      hasStartTimes: true,
    });
    const acts = (await analyst.get(`/mining/logs/${log.id}/activities`).expect(200)).body.items;
    expect(acts.map((a: { name: string }) => a.name).sort()).toEqual([
      'Approve: Owner approval',
      'Submit for review',
      'Withdraw',
    ]);
  });

  it('deletes logs past the retention period', async () => {
    const log = (await upload(analyst, CSV, 'r.csv', { nameEn: 'Old' }).expect(201)).body;
    const preview = (await analyst.get(`/mining/logs/${log.id}/preview`).expect(200)).body;
    await analyst.put(`/mining/logs/${log.id}/mapping`).send(preview.suggestion).expect(200);
    await waitJob(
      analyst,
      (await analyst.post(`/mining/logs/${log.id}/import`).expect(201)).body.id,
    );
    const scheduler = ctx.app.get(MiningScheduler);
    // Without a retention setting nothing happens.
    expect((await scheduler.runOnce(new Date('2030-01-01'))).purged).toBe(0);
    await ctx.prisma.setting.create({ data: { key: 'mining', value: { retentionMonths: 12 } } });
    expect((await scheduler.runOnce(new Date('2026-06-01'))).purged).toBe(0);
    expect((await scheduler.runOnce(new Date('2030-01-01'))).purged).toBe(1);
    await analyst.get(`/mining/logs/${log.id}`).expect(404);
    const job = await ctx.prisma.miningJob.findFirstOrThrow({ where: { kind: 'DELETE' } });
    expect((await ctx.app.get(MiningJobsService).wait(job.id, 20_000)).status).toBe('DONE');
    expect(await ctx.prisma.miningEvent.count()).toBe(0);
  });

  it('purges unused analysis results and old finished jobs (SEC-18)', async () => {
    const log = (await upload(analyst, CSV, 'c.csv', { nameEn: 'Cache' }).expect(201)).body;
    const old = new Date('2026-01-01');
    await ctx.prisma.miningResultCache.create({
      data: {
        key: 'old',
        logId: log.id,
        dataVersion: 1,
        kind: 'ANALYSE',
        result: {},
        lastUsedAt: old,
      },
    });
    await ctx.prisma.miningResultCache.create({
      data: { key: 'fresh', logId: log.id, dataVersion: 1, kind: 'ANALYSE', result: {} },
    });
    await ctx.prisma.miningJob.create({
      data: { kind: 'ANALYSE', status: 'DONE', finishedAt: old, logId: log.id },
    });
    const res = await ctx.app.get(MiningScheduler).purgeCache(new Date('2026-03-01'));
    expect(res).toMatchObject({ cacheRows: 1 });
    expect(res.jobRows).toBeGreaterThanOrEqual(1);
    expect(
      await ctx.prisma.miningResultCache.findUnique({ where: { key: 'fresh' } }),
    ).not.toBeNull();
    expect(await ctx.prisma.miningResultCache.findUnique({ where: { key: 'old' } })).toBeNull();
  });
});
