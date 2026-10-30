import JSZip from 'jszip';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/** Audit management (Phase 4.2, step 3 — D-101). */
describe('Audit management (e2e)', () => {
  let ctx: TestContext;
  let auditor: Client;
  let officer: Client;
  let owner: Client;
  let modeler: Client;
  let readOnly: Client;
  let ownerId: string;
  let processId: string;
  let riskId: string;
  let controlId: string;
  let requirementId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'ia@test.local', ['INTERNAL_AUDIT']);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    ownerId = (await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'])).id;
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'auditor@test.local', ['AUDITOR']);
    auditor = await loggedIn(ctx.app, 'ia@test.local');
    officer = await loggedIn(ctx.app, 'officer@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    readOnly = await loggedIn(ctx.app, 'auditor@test.local');
    processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Purchasing', nameAr: 'المشتريات', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_Approve']) })
      .expect(200);
    controlId = (
      await officer
        .post('/grc/controls')
        .send({ code: 'C-1', nameEn: 'PO approval', status: 'ACTIVE' })
    ).body.item.id;
    riskId = (
      await officer.post('/grc/risks').send({
        code: 'R-1',
        nameEn: 'Fraud',
        category: 'FRAUD',
        inherentLikelihood: 5,
        inherentImpact: 4,
        controlIds: [controlId],
      })
    ).body.item.id;
    requirementId = (
      await officer.post('/grc/requirements').send({ code: 'Q-1', nameEn: 'Procurement law' })
    ).body.item.id;
    await officer
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Approve', repoObjectId: riskId });
    await officer.post('/control-tests/plans').send({
      controlId,
      testType: 'OPERATING',
      procedure: [{ en: 'Inspect the approval', ar: 'افحص الاعتماد' }],
      sampleSize: 2,
      frequency: 'QUARTERLY',
    });
  });

  it('runs an engagement from the plan to agreed findings that become issues, and exports the report', async () => {
    await modeler.post('/audits').send({ year: 2026, titleEn: 'x' }).expect(403);
    const created = await auditor
      .post('/audits')
      .send({
        year: 2026,
        titleEn: 'Procurement audit',
        titleAr: 'تدقيق المشتريات',
        objectiveEn: 'Assess purchase approvals',
        processIds: [processId],
        riskIds: [riskId],
        controlIds: [controlId],
        requirementIds: [requirementId],
        plannedStart: '2026-11-01',
        plannedEnd: '2026-11-30',
      })
      .expect(201);
    const e = created.body;
    expect(e).toMatchObject({ code: 'AUD-2026-01', status: 'PLANNED' });
    expect(e.scope.processes[0]).toMatchObject({ code: 'S.01' });

    // Work programme reuses the control's test procedure.
    const withItem = (await auditor.post(`/audits/${e.id}/items`).send({ controlId }).expect(201))
      .body;
    expect(withItem.items[0]).toMatchObject({
      titleEn: 'C-1 PO approval',
      procedure: [{ en: 'Inspect the approval', ar: 'افحص الاعتماد' }],
    });
    await auditor
      .patch(`/audits/items/${withItem.items[0].id}`)
      .send({ status: 'DONE', result: 'EXCEPTION', notes: '3 of 25 POs approved late' })
      .expect(200);

    // Findings: two, both traced to the process step, risk, control and requirement.
    const base = {
      rating: 'HIGH',
      conditionEn: 'Purchase orders approved after delivery',
      criteriaEn: 'Approval before commitment',
      requirementId,
      causeEn: 'No system block',
      effectEn: 'Unauthorised spending',
      recommendationEn: 'Block goods receipt without approval',
      processId,
      bpmnElementId: 'Task_Approve',
      riskId,
      controlId,
      responseOwnerId: ownerId,
    };
    await auditor.post(`/audits/${e.id}/findings`).send({ ...base, titleEn: 'Late approvals' });
    const two = (
      await auditor
        .post(`/audits/${e.id}/findings`)
        .send({ ...base, rating: 'LOW', titleEn: 'Missing file notes' })
        .expect(201)
    ).body;
    expect(two.findings.map((f: { code: string }) => f.code)).toEqual(['F-01', 'F-02']);
    expect(two.findings[0].elementLabel).toMatchObject({ nameEn: 'Task_Approve' });
    const [f1, f2] = two.findings;

    await auditor.post(`/audits/${e.id}/status`).send({ status: 'REPORTING' }).expect(409);
    await auditor.post(`/audits/${e.id}/status`).send({ status: 'FIELDWORK' }).expect(200);
    await auditor.post(`/audits/${e.id}/status`).send({ status: 'REPORTING' }).expect(200);
    const asked = await ctx.prisma.notification.findMany({
      where: { userId: ownerId, type: 'AUDIT' },
    });
    expect(asked.map((n) => (n.params as { kind: string }).kind)).toEqual(['response', 'response']);
    expect((await owner.get('/assurance/tasks')).body.findingsToAnswer).toHaveLength(2);

    // The response owner (no audit rights) answers; agreeing creates the issue with the action.
    await modeler
      .post(`/audits/findings/${f1.id}/response`)
      .send({ status: 'DISAGREED', comment: 'x' })
      .expect(404);
    await owner
      .post(`/audits/findings/${f1.id}/response`)
      .send({ status: 'ACCEPTED', agreedActionEn: 'Add a system block' })
      .expect(400); // target date required
    const agreed = (
      await owner
        .post(`/audits/findings/${f1.id}/response`)
        .send({
          status: 'ACCEPTED',
          agreedActionEn: 'Add a system block',
          targetDate: '2027-02-28',
        })
        .expect(200)
    ).body;
    expect(agreed.responseStatus).toBe('ACCEPTED');
    const issue = (await owner.get(`/issues/${agreed.issue.id}`).expect(200)).body;
    expect(issue).toMatchObject({
      sourceType: 'AUDIT_FINDING',
      severity: 'HIGH',
      owner: { id: ownerId },
      process: { id: processId },
      bpmnElementId: 'Task_Approve',
      risk: { id: riskId },
      control: { id: controlId },
      requirement: { id: requirementId },
      sourceLink: `/grc/audits/${e.id}?finding=${f1.id}`,
    });
    expect(issue.actions[0]).toMatchObject({
      titleEn: 'Add a system block',
      owner: { id: ownerId },
    });
    await auditor.patch(`/audits/findings/${f1.id}`).send({ titleEn: 'Changed' }).expect(409);

    await auditor.post(`/audits/${e.id}/status`).send({ status: 'FOLLOW_UP' }).expect(200);
    await auditor
      .post(`/audits/${e.id}/status`)
      .send({ status: 'CLOSED' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('FINDINGS_UNANSWERED'));
    await owner
      .post(`/audits/findings/${f2.id}/response`)
      .send({ status: 'DISAGREED', comment: 'Notes are kept in the ERP' })
      .expect(200);

    // Report (both languages); read-only auditors may download, nobody without rights.
    for (const locale of ['en', 'ar']) {
      const res = await readOnly
        .get(`/audits/${e.id}/report?locale=${locale}`)
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
      expect(xml).toContain(locale === 'en' ? 'Internal audit report' : 'تقرير التدقيق الداخلي');
      expect(xml).toContain('F-01');
      expect(xml).toContain('Add a system block');
    }
    await modeler.get(`/audits/${e.id}/report`).expect(403);
    await auditor.post(`/audits/${e.id}/status`).send({ status: 'CLOSED' }).expect(200);
    const exports = await ctx.prisma.auditLog.count({
      where: { entityId: e.id, action: 'EXPORT' },
    });
    expect(exports).toBe(2);

    // The universe ranks the process by its residual risk and shows the audit.
    const universe = (await auditor.get('/audits/universe?year=2026').expect(200)).body;
    const row = universe.find((r: { id: string }) => r.id === processId);
    expect(row).toMatchObject({
      kind: 'PROCESS',
      priorityScore: 20,
      priorityBand: 'CRITICAL',
      riskCount: 1,
    });
    expect(row.lastAuditedAt).not.toBeNull();
    expect(row.planned).toEqual([{ id: e.id, code: 'AUD-2026-01', status: 'CLOSED' }]);
    expect(universe[0].priorityScore).toBeGreaterThanOrEqual(row.priorityScore);
  });
});
