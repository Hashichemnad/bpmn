import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

/** 1 × 1 PNG (a valid IHDR, as rendered diagrams are). */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A small bilingual process: lanes (roles), an approval step, attributes, a decision. */
function bpmn(roleId: string, suffix = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Requester" ph:nameEn="Requester" ph:nameAr="مقدم الطلب"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Manager" ph:nameEn="Manager" ph:nameAr="المدير" ph:roleId="${roleId}"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef><bpmn:flowNodeRef>G</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" />
    <bpmn:task id="T1" name="Submit request${suffix}" ph:nameEn="Submit request${suffix}" ph:nameAr="تقديم الطلب" ph:descriptionEn="Fill in the form." ph:durationMinutes="30" ph:costPerExecution="12" ph:inputsEn="Request form" />
    <bpmn:userTask id="T2" name="Approve request" ph:nameEn="Approve request" ph:nameAr="اعتماد الطلب" ph:stepKind="approval" ph:waitingMinutes="1440" />
    <bpmn:exclusiveGateway id="G" name="Approved?" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1" />
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="T2" />
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="G" />
    <bpmn:sequenceFlow id="F4" sourceRef="G" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`;
}

async function docText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  return {
    xml: await zip.file('word/document.xml')!.async('string'),
    media: Object.keys(zip.files).filter((f) => f.startsWith('word/media/')),
  };
}

describe('Reports: handbook, RACI, object report (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let viewer: Client;
  let roleId: string;
  let systemId: string;
  let parentId: string;
  let childId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER'], { nameEn: 'Maha Modeler' });
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
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
    roleId = (
      await modeler.post('/objects').send({ type: 'ROLE', nameEn: 'Manager', nameAr: 'المدير' })
    ).body.id;
    systemId = (
      await modeler.post('/objects').send({ type: 'SYSTEM', nameEn: 'SAP', nameAr: 'ساب' })
    ).body.id;
    parentId = (
      await modeler
        .post('/processes')
        .send({ code: 'C.01', nameEn: 'Purchasing', nameAr: 'المشتريات', category: 'CORE' })
    ).body.id;
    childId = (
      await modeler.post('/processes').send({
        code: 'C.01.01',
        nameEn: 'Purchase request',
        nameAr: 'طلب الشراء',
        descriptionEn: 'How to request a purchase.',
        parentId,
      })
    ).body.id;
    for (const id of [parentId, childId])
      await modeler
        .post(`/processes/${id}/versions`)
        .send({ bpmnXml: bpmn(roleId), changeNote: 'v1' })
        .expect(201);
    await modeler
      .post(`/processes/${childId}/links`)
      .send({ bpmnElementId: 'T1', repoObjectId: systemId })
      .expect(201);
  });

  const publish = async (id: string) => {
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    const review = (await reviewer.get('/tasks').expect(200)).body.reviews.find(
      (r: { item: { entityId: string } }) => r.item.entityId === id,
    );
    await reviewer.post(`/reviews/${review.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    await modeler
      .post(`/governance/processes/${id}/publish`)
      .send({ versionLabel: 'Issue 1' })
      .expect(200);
  };

  it('handbook of a branch (working version): docx with diagram, steps and attributes', async () => {
    const plan = (
      await modeler
        .post('/reports/handbook/plan')
        .send({ processId: parentId, includeChildren: true })
        .expect(200)
    ).body;
    expect(plan.source).toBe('working');
    expect(plan.processes.map((p: { code: string }) => p.code)).toEqual(['C.01', 'C.01.01']);
    expect(plan.processes[1].bpmnXml).toContain('Submit request');

    const res = await modeler
      .post('/reports/handbook')
      .send({
        processId: parentId,
        includeChildren: true,
        locale: 'en',
        images: [{ processId: childId, png: PNG }],
      })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('wordprocessingml');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('C.01 Purchasing'));
    const { xml, media } = await docText(res.body as Buffer);
    expect(media).toHaveLength(1);
    for (const text of [
      'Process handbook',
      'C.01.01  Purchase request',
      'How to request a purchase.',
      'Submit request',
      'Approval',
      'Requester',
      'SAP',
      'Processing: 30 min',
      'Waiting: 1 d',
      'Cost: 12',
      'Inputs: Request form',
      'Working version',
    ])
      expect(xml).toContain(text);

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'EXPORT' } });
    expect(audit).toMatchObject({
      entityType: 'Process',
      entityId: parentId,
      summary: { report: 'handbook', source: 'working', processes: ['C.01', 'C.01.01'] },
    });
  });

  it('Arabic handbook is right-to-left', async () => {
    const res = await modeler
      .post('/reports/handbook')
      .send({ processId: childId, locale: 'ar' })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const { xml } = await docText(res.body as Buffer);
    expect(xml).toContain('<w:bidi/>');
    expect(xml).toContain('<w:rtl/>');
    expect(xml).toContain('<w:bidiVisual/>');
    for (const text of ['دليل العمليات', 'طلب الشراء', 'تقديم الطلب', 'اعتماد', 'المدير'])
      expect(xml).toContain(text);
  });

  it('rejects images that are not PNG', async () => {
    await modeler
      .post('/reports/handbook')
      .send({
        processId: childId,
        locale: 'en',
        images: [{ processId: childId, png: Buffer.from('<svg/>').toString('base64') }],
      })
      .expect(400);
  });

  it('RACI: steps × roles with R and A, IT systems per step', async () => {
    const res = await modeler
      .get(`/reports/raci/${childId}?locale=en`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['RACI', 'IT systems', 'Steps', 'Legend']);
    const raci = wb.getWorksheet('RACI')!;
    expect(raci.getRow(1).values).toEqual([undefined, '#', 'Step', 'Type', 'Requester', 'Manager']);
    expect(raci.getRow(2).values).toEqual([undefined, 1, 'Submit request', 'Task', 'R']);
    expect(raci.getRow(3).values).toEqual([
      undefined,
      2,
      'Approve request',
      'Approval',
      undefined,
      'A',
    ]);
    expect(wb.getWorksheet('IT systems')!.getRow(2).values).toEqual([
      undefined,
      1,
      'Submit request',
      'SAP',
    ]);

    const ar = await modeler
      .get(`/reports/raci/${childId}?locale=ar`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wbAr = new ExcelJS.Workbook();
    await wbAr.xlsx.load(ar.body as never);
    expect(wbAr.worksheets[0].views[0]).toMatchObject({ rightToLeft: true });
    expect(wbAr.worksheets[0].getRow(1).values).toContain('المدير');
  });

  it('viewers get published versions only; unpublished processes are not found', async () => {
    expect(
      (await viewer.post('/reports/handbook/plan').send({ processId: childId }).expect(404)).body
        .code,
    ).toBe('NOT_PUBLISHED');
    await viewer.get(`/reports/raci/${childId}`).expect(404);
    await publish(childId);
    // A later draft is not what viewers see.
    await modeler
      .post(`/processes/${childId}/versions`)
      .send({ bpmnXml: bpmn(roleId, ' (draft)'), changeNote: 'v2' })
      .expect(201);
    const plan = (
      await viewer
        .post('/reports/handbook/plan')
        .send({ processId: childId, source: 'working' })
        .expect(200)
    ).body;
    expect(plan.source).toBe('published');
    expect(plan.processes[0].bpmnXml).not.toContain('(draft)');
    // The branch of a viewer holds only published processes.
    await viewer
      .post('/reports/handbook/plan')
      .send({ processId: parentId, includeChildren: true })
      .expect(404);
    const res = await viewer
      .post('/reports/handbook')
      .send({ processId: childId, locale: 'en' })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const { xml } = await docText(res.body as Buffer);
    expect(xml).toContain('Published (official) version');
    expect(xml).toContain('Issue 1');
    expect(xml).not.toContain('(draft)');
    // The working version (with the draft) for workspace users.
    const working = (
      await modeler.post('/reports/handbook/plan').send({ processId: childId }).expect(200)
    ).body;
    expect(working.processes[0].bpmnXml).toContain('(draft)');
    // Object reports are workspace-only.
    await viewer.get(`/reports/objects/${roleId}`).expect(403);
  });

  it('object report: every process and step where a role is used', async () => {
    const res = await modeler
      .get(`/reports/objects/${roleId}?locale=en`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Where used');
    const rows = [2, 3].map((r) => ws.getRow(r).values);
    expect(rows).toEqual([
      [undefined, 'C.01', 'Purchasing', 'Draft', 'Manager', 'Performs'],
      [undefined, 'C.01.01', 'Purchase request', 'Draft', 'Manager', 'Performs'],
    ]);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'EXPORT', entityType: 'RepoObject' },
    });
    expect(audit?.summary).toMatchObject({ report: 'object', rows: 2 });
  });
});
