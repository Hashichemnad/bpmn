import ExcelJS from 'exceljs';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/** Assurance dashboard and the tested heat map (Phase 4.2, step 5 — D-103). */
describe('Assurance dashboard (e2e)', () => {
  let ctx: TestContext;
  let officer: Client;
  let reviewer: Client;
  let viewer: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    await createUser(ctx.prisma, 'ia@test.local', ['INTERNAL_AUDIT']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    officer = await loggedIn(ctx.app, 'officer@test.local');
    reviewer = await loggedIn(ctx.app, 'ia@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
  });

  it('counts tests, issues, audits and campaigns per scope and exports them', async () => {
    const modeler = await loggedIn(ctx.app, 'modeler@test.local');
    const dept = await ctx.prisma.department.create({
      data: { code: 'FIN', nameEn: 'Finance', nameAr: 'المالية' },
    });
    const processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Purchasing', category: 'SUPPORT', departmentId: dept.id })
        .expect(201)
    ).body.id;
    await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn(['Task_A']) });
    const control = (
      await officer.post('/grc/controls').send({
        code: 'C-1',
        nameEn: 'Approval',
        status: 'ACTIVE',
        effectiveness: 'EFFECTIVE',
        departmentId: dept.id,
      })
    ).body.item.id;
    const risk = (
      await officer.post('/grc/risks').send({
        code: 'R-1',
        nameEn: 'Fraud',
        category: 'FRAUD',
        inherentLikelihood: 5,
        inherentImpact: 5,
        residualLikelihood: 2,
        residualImpact: 2,
        controlIds: [control],
      })
    ).body.item.id;
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_A', repoObjectId: control })
      .expect(201);
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_A', repoObjectId: risk })
      .expect(201);

    // One reviewed test (not effective) and one overdue test.
    const t1 = (
      await officer
        .post('/control-tests')
        .send({ controlId: control, dueAt: '2026-10-01', sampleSize: 1, procedure: [] })
    ).body.id;
    await officer.post(`/control-tests/${t1}/start`).expect(200);
    await officer
      .put(`/control-tests/${t1}/results`)
      .send({ samples: [{ ref: 'A', steps: [], result: 'FAIL' }], conclusion: 'NOT_EFFECTIVE' });
    await officer.post(`/control-tests/${t1}/submit`).expect(200);
    await reviewer.post(`/control-tests/${t1}/review`).send({ decision: 'APPROVE' }).expect(200);
    await officer
      .post('/control-tests')
      .send({ controlId: control, dueAt: '2020-01-31' })
      .expect(201);
    await officer
      .post('/issues')
      .send({
        titleEn: 'Fix approvals',
        severity: 'HIGH',
        sourceType: 'CONTROL_TEST',
        sourceId: t1,
        processId,
        dueAt: '2020-02-01',
      })
      .expect(201);
    await reviewer
      .post('/audits')
      .send({
        year: new Date().getUTCFullYear(),
        titleEn: 'Purchasing audit',
        processIds: [processId],
      })
      .expect(201);

    await viewer.get('/assurance/dashboard').expect(403);
    const org = (await officer.get('/assurance/dashboard').expect(200)).body;
    expect(org.tests).toMatchObject({
      done: 1,
      overdue: 1,
      effectivePercent: 0,
      byConclusion: { NOT_EFFECTIVE: 1 },
    });
    expect(org.tests.byDepartment[0]).toMatchObject({ code: 'FIN', done: 1, overdue: 1 });
    expect(org.tests.byProcess[0]).toMatchObject({ code: 'S.01', done: 1, overdue: 1 });
    expect(org.issues).toMatchObject({ open: 1, overdue: 1, bySeverity: { HIGH: 1 } });
    expect(org.issues.byAge['0-30']).toBe(1);
    expect(org.audits).toMatchObject({ total: 1, byStatus: { PLANNED: 1 } });
    const other = await ctx.prisma.department.create({ data: { nameEn: 'HR', nameAr: 'الموارد' } });
    const empty = (await officer.get(`/assurance/dashboard?departmentId=${other.id}`).expect(200))
      .body;
    expect(empty.tests.done + empty.issues.open + empty.audits.total).toBe(0);
    const scoped = (await officer.get(`/assurance/dashboard?processId=${processId}`).expect(200))
      .body;
    expect(scoped.tests.done).toBe(1);

    // Tested heat map: the control tested not effective → the risk sits at its inherent position.
    const plain = (await officer.get('/grc/dashboard').expect(200)).body.heatMap.residual;
    const tested = (await officer.get('/grc/dashboard?tested=true').expect(200)).body.heatMap
      .residual;
    expect(plain[1][1]).toBe(1);
    expect(tested[4][4]).toBe(1);
    const cell = (await officer.get('/grc/risks?cell=5,5&matrix=tested').expect(200)).body;
    expect(cell.items.map((r: { id: string }) => r.id)).toEqual([risk]);

    const xlsx = await officer
      .get('/assurance/dashboard/export?locale=en')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Tests by department',
      'Tests by process',
      'Issues',
      'Audits',
      'Surveys',
    ]);
  });
});
