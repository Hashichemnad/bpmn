import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { DEFAULT_GRC_SETTINGS, PROCESS_ELEMENT_ID } from '@processhub/shared';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/** Risk & Compliance registers (Phase 4.1): risks, controls, requirements, links, permissions. */
describe('Risk & Compliance (e2e)', () => {
  let ctx: TestContext;
  let officer: Client;
  let modeler: Client;
  let owner: Client;
  let auditor: Client;
  let viewer: Client;
  let reviewer: Client;
  let processId: string;
  let otherProcessId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    const ownerUser = await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    await createUser(ctx.prisma, 'auditor@test.local', ['AUDITOR']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    officer = await loggedIn(ctx.app, 'officer@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    auditor = await loggedIn(ctx.app, 'auditor@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Purchasing', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_Order', 'Task_Approve']) })
      .expect(200);
    otherProcessId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.02', nameEn: 'Payments', category: 'SUPPORT', ownerId: ownerUser.id })
        .expect(201)
    ).body.id;
  });

  const risk = (c: Client, body: object = {}) =>
    c.post('/grc/risks').send({
      code: 'R-01',
      nameEn: 'Split purchase orders',
      nameAr: 'تجزئة أوامر الشراء',
      category: 'FRAUD',
      inherentLikelihood: 4,
      inherentImpact: 4,
      ...body,
    });

  it('creates risks with ratings, relates controls and requirements, filters the registers', async () => {
    const r = (await risk(officer).expect(201)).body.item;
    expect(r).toMatchObject({
      type: 'RISK',
      status: 'ACTIVE',
      rating: { inherentScore: 16, inherentBand: 'CRITICAL', residualScore: 16, alert: true },
      controls: [],
      effectivelyControlled: false,
    });
    await risk(officer, { category: 'NOPE' }).expect(400);
    await risk(officer, { residualLikelihood: 2 }).expect(400);
    await risk(officer, { inherentImpact: 6 }).expect(400);

    const source = (
      await officer
        .post('/grc/requirements')
        .send({
          code: 'PL',
          nameEn: 'Procurement law',
          nameAr: 'نظام المشتريات',
          sourceRef: 'Law 2019',
        })
        .expect(201)
    ).body.item;
    expect(source).toMatchObject({ level: 'SOURCE', status: 'ACTIVE' });
    const clause = (
      await officer
        .post('/grc/requirements')
        .send({ code: 'PL-12', nameEn: 'Art. 12', parentId: source.id, level: 'CLAUSE' })
        .expect(201)
    ).body.item;
    expect(clause.parent).toMatchObject({ id: source.id });
    await officer.post('/grc/requirements').send({ nameEn: 'Orphan', level: 'CLAUSE' }).expect(400);
    await officer
      .post('/grc/requirements')
      .send({ nameEn: 'Bad link', url: 'javascript:alert(1)' })
      .expect(400);

    const c = (
      await officer
        .post('/grc/controls')
        .send({
          code: 'C-01',
          nameEn: 'Three quotations',
          controlType: 'PREVENTIVE',
          nature: 'MANUAL',
          frequency: 'PER_TRANSACTION',
          keyControl: true,
          riskIds: [r.id],
          requirementIds: [clause.id],
        })
        .expect(201)
    ).body.item;
    expect(c).toMatchObject({
      effectiveness: 'NOT_ASSESSED',
      keyControl: true,
      risks: [{ id: r.id, rating: { residualBand: 'CRITICAL' } }],
      requirements: [{ id: clause.id }],
    });
    const withControl = (await officer.get(`/grc/risks/${r.id}`).expect(200)).body.item;
    expect(withControl.controls).toMatchObject([{ id: c.id, effectiveness: 'NOT_ASSESSED' }]);
    expect(withControl.effectivelyControlled).toBe(false);

    await risk(officer, {
      code: 'R-02',
      nameEn: 'Late payment',
      category: 'FINANCIAL',
      inherentLikelihood: 2,
      inherentImpact: 2,
    }).expect(201);

    const list = (await officer.get('/grc/risks?sort=residualScore&order=desc').expect(200)).body;
    expect(list.items.map((x: { code: string }) => x.code)).toEqual(['R-01', 'R-02']);
    expect((await officer.get('/grc/risks?rating=LOW').expect(200)).body.total).toBe(1);
    expect((await officer.get('/grc/risks?category=FRAUD').expect(200)).body.total).toBe(1);
    expect((await officer.get('/grc/risks?cell=4,4').expect(200)).body.total).toBe(1);
    expect((await officer.get('/grc/risks?withoutControls=true').expect(200)).body.total).toBe(1);
    expect(
      (await officer.get('/grc/risks?alertWithoutEffectiveControl=true').expect(200)).body.items,
    ).toMatchObject([{ code: 'R-01' }]);
    expect((await officer.get('/grc/controls?keyAttention=true').expect(200)).body.total).toBe(1);
    expect(
      (await officer.get('/grc/requirements?withoutControls=true').expect(200)).body.items,
    ).toMatchObject([{ code: 'PL' }]);
    await officer.get('/grc/risks?cell=9,9').expect(400);

    // Risks, controls and requirements also appear in the object library ("where used").
    const lib = (await modeler.get('/objects?type=REQUIREMENT').expect(200)).body;
    expect(lib.total).toBe(2);
    await modeler.patch(`/objects/${r.id}`).send({ nameEn: 'X' }).expect(400);
    await modeler.delete(`/objects/${r.id}`).expect(400);
  });

  it('keeps an assessment history and comments as a timeline', async () => {
    const r = (await risk(officer).expect(201)).body.item;
    await officer
      .patch(`/grc/risks/${r.id}`)
      .send({ residualLikelihood: 2, residualImpact: 3, comment: 'Quotations in place' })
      .expect(200);
    const c = (await officer.post('/grc/controls').send({ nameEn: 'Review' }).expect(201)).body
      .item;
    await officer
      .patch(`/grc/controls/${c.id}`)
      .send({ effectiveness: 'NOT_EFFECTIVE', comment: 'Sample failed' })
      .expect(200);
    await officer.patch(`/grc/risks/${r.id}`).send({ status: 'RETIRED' }).expect(200);
    await officer
      .post(`/grc/items/${r.id}/comments`)
      .send({ body: 'Discussed in committee' })
      .expect(201);

    const timeline = (await auditor.get(`/grc/items/${r.id}/timeline`).expect(200)).body;
    expect(timeline.map((a: { kind: string }) => a.kind)).toEqual([
      'COMMENT',
      'STATUS',
      'ASSESSMENT',
      'CREATED',
    ]);
    expect(timeline[2]).toMatchObject({
      comment: 'Quotations in place',
      changes: {
        residualLikelihood: { from: null, to: 2 },
        residualImpact: { from: null, to: 3 },
      },
      author: { email: 'officer@test.local' },
    });
    const ct = (await officer.get(`/grc/items/${c.id}/timeline`).expect(200)).body;
    expect(ct[0]).toMatchObject({
      kind: 'ASSESSMENT',
      changes: { effectiveness: { from: 'NOT_ASSESSED', to: 'NOT_EFFECTIVE' } },
    });
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityId: r.id, action: 'ASSESS' },
    });
    expect(audit).toHaveLength(1);
    // Auditors read but do not comment.
    await auditor.post(`/grc/items/${r.id}/comments`).send({ body: 'x' }).expect(403);
  });

  it('process owners and modelers propose drafts; only editors activate, assess and map requirements', async () => {
    const draft = (await risk(modeler, { status: 'ACTIVE' }).expect(201)).body.item;
    expect(draft.status).toBe('DRAFT');
    await modeler.patch(`/grc/risks/${draft.id}`).send({ nameEn: 'Better name' }).expect(200);
    await modeler.patch(`/grc/risks/${draft.id}`).send({ status: 'ACTIVE' }).expect(403);
    // Someone else's draft, an active risk, requirements and assessments are off limits.
    await owner.patch(`/grc/risks/${draft.id}`).send({ nameEn: 'Mine' }).expect(403);
    const active = (await risk(officer, { code: 'R-9' }).expect(201)).body.item;
    await modeler.patch(`/grc/risks/${active.id}`).send({ nameEn: 'X' }).expect(403);
    await modeler.post('/grc/requirements').send({ nameEn: 'Policy' }).expect(403);
    const ctl = (
      await owner
        .post('/grc/controls')
        .send({ nameEn: 'Check', effectiveness: 'EFFECTIVE' })
        .expect(201)
    ).body.item;
    expect(ctl).toMatchObject({ status: 'DRAFT', effectiveness: 'NOT_ASSESSED' });
    await owner.patch(`/grc/controls/${ctl.id}`).send({ effectiveness: 'EFFECTIVE' }).expect(403);
    await owner
      .post('/grc/controls')
      .send({ nameEn: 'Y', riskIds: [active.id] })
      .expect(403);
    // The officer activates the proposal.
    await officer.patch(`/grc/risks/${draft.id}`).send({ status: 'ACTIVE' }).expect(200);
    // Proposers delete their own drafts only; admins anything.
    await owner.delete(`/grc/risks/${active.id}`).expect(403);
    await owner.delete(`/grc/controls/${ctl.id}`).expect(204);
    await officer.delete(`/grc/risks/${active.id}`).expect(204);
    await officer.get(`/grc/risks/${active.id}`).expect(404);
  });

  it('read-only roles read, Viewers see nothing, settings need grc.admin', async () => {
    const r = (await risk(officer).expect(201)).body.item;
    for (const c of [auditor, reviewer]) {
      await c.get('/grc/risks').expect(200);
      await c.get(`/grc/risks/${r.id}`).expect(200);
      await risk(c).expect(403);
      await c.patch(`/grc/risks/${r.id}`).send({ nameEn: 'X' }).expect(403);
      await c.delete(`/grc/risks/${r.id}`).expect(403);
      await c.put('/grc/settings').send(DEFAULT_GRC_SETTINGS).expect(403);
    }
    for (const path of ['/grc/risks', '/grc/controls', '/grc/requirements', `/grc/risks/${r.id}`])
      await viewer.get(path).expect(403);
    await viewer.get('/grc/settings').expect(403);
    await viewer.get(`/grc/processes/${processId}`).expect(403);

    await modeler.get('/grc/settings').expect(200);
    await modeler.put('/grc/settings').send(DEFAULT_GRC_SETTINGS).expect(403);
    const bands = DEFAULT_GRC_SETTINGS.bands.map((b) =>
      b.key === 'HIGH' ? { ...b, minScore: 12 } : b,
    );
    const saved = (
      await officer
        .put('/grc/settings')
        .send({ ...DEFAULT_GRC_SETTINGS, bands, portalVisibility: 'CONTROLS' })
        .expect(200)
    ).body;
    expect(saved.portalVisibility).toBe('CONTROLS');
    await officer
      .put('/grc/settings')
      .send({ ...DEFAULT_GRC_SETTINGS, bands: [...bands].reverse() })
      .expect(400);
  });

  it('links risks and controls to steps and to the whole process; saves keep process links', async () => {
    const r = (await risk(officer).expect(201)).body.item;
    const req = (await officer.post('/grc/requirements').send({ nameEn: 'Policy' }).expect(201))
      .body.item;
    // The officer links without model edit rights; the modeler as an editor of the model.
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Approve', repoObjectId: r.id })
      .expect(201);
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: PROCESS_ELEMENT_ID, repoObjectId: req.id })
      .expect(201);
    // …but not other library objects.
    const role = (await modeler.post('/objects').send({ type: 'ROLE', nameEn: 'Clerk' })).body;
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Order', repoObjectId: role.id })
      .expect(403);
    // Owners link to their own processes only; auditors never.
    await owner
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Order', repoObjectId: r.id })
      .expect(403);
    await owner
      .post(`/processes/${otherProcessId}/links`)
      .send({ bpmnElementId: PROCESS_ELEMENT_ID, repoObjectId: r.id })
      .expect(201);
    await auditor
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Order', repoObjectId: r.id })
      .expect(403);

    const view = (await modeler.get(`/grc/processes/${processId}`).expect(200)).body;
    expect(view.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: r.id,
          bpmnElementId: 'Task_Approve',
          rating: expect.any(Object),
        }),
        expect.objectContaining({ id: req.id, bpmnElementId: PROCESS_ELEMENT_ID }),
      ]),
    );
    const detail = (await auditor.get(`/grc/risks/${r.id}`).expect(200)).body;
    expect(detail.item.stepCount).toBe(2);
    expect(detail.steps).toMatchObject([
      {
        process: { code: 'S.01' },
        bpmnElementId: 'Task_Approve',
        element: { nameEn: 'Task_Approve' },
      },
      { process: { code: 'S.02' }, bpmnElementId: PROCESS_ELEMENT_ID },
    ]);
    expect((await officer.get(`/grc/risks?processId=${processId}`).expect(200)).body.total).toBe(1);

    // Removing the step prunes its links; the process-level link stays.
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_Order']) })
      .expect(200);
    const after = (await modeler.get(`/grc/processes/${processId}`).expect(200)).body.items;
    expect(after.map((i: { id: string }) => i.id)).toEqual([req.id]);

    // Deleting a risk removes its links.
    await officer.delete(`/grc/risks/${r.id}`).expect(204);
    expect(await ctx.prisma.objectLink.count({ where: { repoObjectId: r.id } })).toBe(0);
  });

  /** Workbook with a header row and data rows. */
  async function xlsx(header: string[], rows: (string | number)[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet');
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Reads a binary response body into a Buffer. */
  const binary = (r: import('node:stream').Readable, cb: (e: Error | null, b: Buffer) => void) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('exports registers, validates imports before importing and upserts by code', async () => {
    const existing = (await risk(officer).expect(201)).body.item;
    await officer.post('/grc/controls').send({ code: 'C-01', nameEn: 'Quotations' }).expect(201);
    await officer
      .post('/grc/requirements')
      .send({ code: 'PL', nameEn: 'Procurement law' })
      .expect(201);

    // Template and export (Arabic headers, right-to-left sheet).
    const template = await officer
      .get('/grc/template/risks?locale=ar')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template.body);
    expect(wb.worksheets[0].views[0]).toMatchObject({ rightToLeft: true });
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('الرمز');
    expect(wb.worksheets[0].rowCount).toBe(1);
    const exported = await auditor
      .get('/grc/export/risks')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    await wb.xlsx.load(exported.body);
    expect(wb.worksheets[0].getRow(2).getCell(1).value).toBe('R-01');
    await auditor.get('/grc/template/risks').expect(403);

    const header = [
      'Code',
      'Title (English)',
      'Category (key)',
      'Inherent likelihood (1-5)',
      'Inherent impact (1-5)',
      'Controls (codes; separated)',
      'Owner (e-mail)',
    ];
    const bad = await xlsx(header, [
      ['R-02', 'Duplicate invoices', 'FINANCIAL', 3, 9, 'C-01', 'officer@test.local'],
      ['R-03', 'Bribery', 'NOPE', 2, 2, 'C-99', 'nobody@test.local'],
      ['R-04', '', 'FINANCIAL', 2, 2, '', ''],
      ['R-02', 'Again', 'FINANCIAL', 2, 2, '', ''],
    ]);
    const report = (
      await officer
        .post('/grc/import/risks?dryRun=false')
        .attach('file', bad, 'risks.xlsx')
        .expect(200)
    ).body;
    expect(report.imported).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        { row: 2, column: 'inherentImpact', code: 'INVALID_RATING' },
        { row: 3, column: 'category', code: 'INVALID_CATEGORY' },
        { row: 3, column: 'controls', code: 'UNKNOWN_CONTROL' },
        { row: 3, column: 'owner', code: 'UNKNOWN_USER' },
        { row: 4, column: 'nameEn', code: 'NAME_REQUIRED' },
        { row: 5, column: 'code', code: 'DUPLICATE_IN_FILE' },
      ]),
    );
    expect(await ctx.prisma.risk.count()).toBe(1);

    const good = await xlsx(header, [
      ['R-01', 'Split orders (renamed)', 'FRAUD', 5, 5, 'C-01', ''],
      ['R-02', 'Duplicate invoices', 'FINANCIAL', 3, 4, 'C-01', 'officer@test.local'],
    ]);
    const dry = (
      await officer.post('/grc/import/risks').attach('file', good, 'risks.xlsx').expect(200)
    ).body;
    expect(dry).toMatchObject({ rows: 2, created: 1, updated: 1, errors: [], imported: false });
    const done = (
      await officer
        .post('/grc/import/risks?dryRun=false')
        .attach('file', good, 'risks.xlsx')
        .expect(200)
    ).body;
    expect(done.imported).toBe(true);
    const updated = (await officer.get(`/grc/risks/${existing.id}`).expect(200)).body.item;
    expect(updated).toMatchObject({
      nameEn: 'Split orders (renamed)',
      inherentLikelihood: 5,
      controls: [{ code: 'C-01' }],
    });
    expect((await officer.get('/grc/risks?q=R-02').expect(200)).body.items[0]).toMatchObject({
      owner: { email: 'officer@test.local' },
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'IMPORT' } })).toBe(1);

    // Requirements: parents in the same file come first; not an Excel file is refused.
    const reqs = await xlsx(
      ['Code', 'Title (English)', 'Level', 'Parent (code)'],
      [
        ['PL-1.1', 'Clause 1.1', 'CLAUSE', 'PL-1'],
        ['PL-1', 'Section 1', 'SECTION', 'PL'],
      ],
    );
    const imported = (
      await officer
        .post('/grc/import/requirements?dryRun=false')
        .attach('file', reqs, 'reqs.xlsx')
        .expect(200)
    ).body;
    expect(imported).toMatchObject({ created: 2, errors: [], imported: true });
    const clause = (await officer.get('/grc/requirements?q=PL-1.1').expect(200)).body.items[0];
    expect(clause.parent).toMatchObject({ code: 'PL-1' });
    await officer
      .post('/grc/import/requirements')
      .attach('file', Buffer.from('code,name'), 'x.xlsx')
      .expect(400);
    await modeler.post('/grc/import/risks').attach('file', good, 'risks.xlsx').expect(403);
  });

  it('shows linked controls and risks in the portal only as the setting allows', async () => {
    const r = (await risk(officer).expect(201)).body.item;
    const c = (await officer.post('/grc/controls').send({ nameEn: 'Check quotes' }).expect(201))
      .body.item;
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: sampleBpmn(['Task_Order', 'Task_Approve']), changeNote: 'v1' })
      .expect(201);
    // Published as linked (publishing itself is covered by the governance tests).
    const pub = await ctx.prisma.publication.create({
      data: { entityType: 'PROCESS', entityId: processId, versionNumber: 1, titleEn: 'Purchasing' },
    });
    await ctx.prisma.publishedLink.createMany({
      data: [r.id, c.id].map((repoObjectId) => ({
        publicationId: pub.id,
        bpmnElementId: 'Task_Approve',
        repoObjectId,
        relation: 'MITIGATES' as const,
      })),
    });
    await ctx.prisma.process.update({ where: { id: processId }, data: { status: 'PUBLISHED' } });

    const types = async () =>
      (await viewer.get(`/portal/processes/${processId}`).expect(200)).body.links
        .map((l: { object: { type: string } }) => l.object.type)
        .sort();
    expect(await types()).toEqual([]);
    for (const [visibility, expected] of [
      ['CONTROLS', ['CONTROL']],
      ['ALL', ['CONTROL', 'RISK']],
    ] as const) {
      await officer
        .put('/grc/settings')
        .send({ ...DEFAULT_GRC_SETTINGS, portalVisibility: visibility })
        .expect(200);
      expect(await types()).toEqual(expected);
    }
  });

  it('adds an optional "Risks and controls" section to the process handbook', async () => {
    const r = (await risk(officer).expect(201)).body.item;
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Approve', repoObjectId: r.id })
      .expect(201);
    const handbook = async (includeRisks: boolean) => {
      const res = await modeler
        .post('/reports/handbook')
        .send({ processId, source: 'working', locale: 'en', includeRisks })
        .buffer(true)
        .parse(binary as never)
        .expect(200);
      const zip = await JSZip.loadAsync(res.body as Buffer);
      return zip.file('word/document.xml')!.async('string');
    };
    const withRisks = await handbook(true);
    expect(withRisks).toContain('Risks and controls');
    expect(withRisks).toContain('R-01 Split purchase orders');
    expect(withRisks).toContain('Critical · 16');
    expect(await handbook(false)).not.toContain('Risks and controls');
  });

  it('dashboards: heat maps, coverage, drill-down, uncovered steps and the RCM export', async () => {
    const dept = await ctx.prisma.department.create({ data: { nameEn: 'Procurement' } });
    await ctx.prisma.process.update({ where: { id: processId }, data: { departmentId: dept.id } });
    const high = (await risk(officer).expect(201)).body.item; // 4 × 4, critical
    const low = (
      await risk(officer, {
        code: 'R-02',
        nameEn: 'Typos',
        inherentLikelihood: 2,
        inherentImpact: 1,
        nextReviewAt: '2020-01-01',
      }).expect(201)
    ).body.item;
    const ctl = (
      await officer
        .post('/grc/controls')
        .send({ code: 'C-1', nameEn: 'Check', keyControl: true, riskIds: [low.id] })
        .expect(201)
    ).body.item;
    await officer.post('/grc/requirements').send({ code: 'Q', nameEn: 'Policy' }).expect(201);
    const link = (el: string, id: string) =>
      officer
        .post(`/processes/${processId}/links`)
        .send({ bpmnElementId: el, repoObjectId: id })
        .expect(201);
    await link('Task_Approve', high.id);
    await link('Task_Order', low.id);
    await link('Task_Order', ctl.id);

    const org = (await auditor.get('/grc/dashboard').expect(200)).body;
    expect(org.heatMap.total).toBe(2);
    expect(org.heatMap.inherent[3][3]).toBe(1);
    expect(org.heatMap.residual[1][0]).toBe(1);
    expect(org.coverage).toMatchObject({
      risksWithoutControls: 1,
      alertRisks: 1,
      alertRisksWithoutEffectiveControl: 1,
      keyControlsAttention: 1,
      requirementsWithoutControls: 1,
      stepsWithRiskNoControl: 1,
      processesWithRiskNoControl: 1,
      overdueReviews: 1,
    });
    expect(org.breakdown).toMatchObject({
      level: 'department',
      rows: [{ id: dept.id, risks: 2, alerts: 1, withoutControls: 1 }],
    });
    const byDept = (await auditor.get(`/grc/dashboard?departmentId=${dept.id}`).expect(200)).body;
    expect(byDept.breakdown).toMatchObject({
      level: 'process',
      rows: [{ id: processId, risks: 2 }],
    });
    const byProcess = (await auditor.get(`/grc/dashboard?processId=${processId}`).expect(200)).body;
    expect(byProcess.breakdown.level).toBe('step');
    expect(byProcess.breakdown.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'Task_Approve', nameEn: 'Task_Approve', withoutControls: 1 }),
      ]),
    );
    const other = (await auditor.get(`/grc/dashboard?processId=${otherProcessId}`).expect(200))
      .body;
    expect(other.heatMap.total).toBe(0);

    const uncovered = (await auditor.get('/grc/dashboard/uncovered-steps').expect(200)).body;
    expect(uncovered).toMatchObject([
      { process: { code: 'S.01' }, bpmnElementId: 'Task_Approve', risks: [{ id: high.id }] },
    ]);

    const res = await auditor
      .get('/grc/rcm?locale=ar')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const [rcm, coverage, steps] = wb.worksheets;
    expect(rcm.views[0]).toMatchObject({ rightToLeft: true });
    expect(rcm.rowCount).toBe(3);
    const rows = [2, 3].map((n) => rcm.getRow(n).values as unknown[]);
    expect(rows.find((r) => r[3] === 'R-02')?.[7]).toBe('C-1');
    expect(rows.find((r) => r[3] === 'R-01')?.[7] || '').toBe('');
    expect(coverage.getRow(3).getCell(2).value).toBe(1);
    expect(steps.rowCount).toBe(2);
    await viewer.get('/grc/dashboard').expect(403);
    await viewer.get('/grc/rcm').expect(403);
  });
});
