import ExcelJS from 'exceljs';
import { DEFAULT_GRC_SETTINGS } from '@processhub/shared';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

/** Approval of changes to active risks and controls (Phase 4.2, step 0 — D-098). */
describe('GRC change approval (e2e)', () => {
  let ctx: TestContext;
  let officer: Client;
  let approver: Client;
  let reviewer: Client;
  let workflowId: string;
  let approverId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    approverId = (await createUser(ctx.prisma, 'approver@test.local', ['RISK_OFFICER'])).id;
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    officer = await loggedIn(ctx.app, 'officer@test.local');
    approver = await loggedIn(ctx.app, 'approver@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    workflowId = (
      await ctx.prisma.workflow.create({
        data: {
          nameEn: 'Risk changes',
          nameAr: 'تعديلات المخاطر',
          steps: [
            {
              nameEn: 'Risk committee',
              nameAr: 'لجنة المخاطر',
              rule: 'ANY',
              assignees: [{ type: 'USER', userId: approverId }],
            },
          ],
        },
      })
    ).id;
  });

  const enable = (c: Client, on = true) =>
    c
      .put('/grc/settings')
      .send({
        ...DEFAULT_GRC_SETTINGS,
        changeApproval: { enabled: on, types: ['RISK', 'CONTROL'], workflowId },
      })
      .expect(200);

  const newRisk = async (status = 'ACTIVE') =>
    (
      await officer
        .post('/grc/risks')
        .send({
          code: 'R-1',
          nameEn: 'Fraud',
          category: 'FRAUD',
          inherentLikelihood: 4,
          inherentImpact: 4,
          status,
        })
        .expect(201)
    ).body.item.id as string;

  it('applies changes directly while approval is off and for drafts', async () => {
    const id = await newRisk();
    await officer.patch(`/grc/risks/${id}`).send({ inherentImpact: 2 }).expect(200);
    await enable(officer);
    const draft = await newRisk('DRAFT');
    const res = await officer.patch(`/grc/risks/${draft}`).send({ inherentImpact: 1 }).expect(200);
    expect(res.body.item.inherentImpact).toBe(1);
    expect(res.body.pendingChange).toBeNull();
  });

  it('routes a change of an active risk through the workflow and applies it on approval', async () => {
    const id = await newRisk();
    await enable(officer);
    const res = await officer
      .patch(`/grc/risks/${id}`)
      .send({ inherentImpact: 2, ownerId: approverId, comment: 'New assessment' })
      .expect(200);
    // The current values stay in force; the change is pending with a before / after.
    expect(res.body.item.inherentImpact).toBe(4);
    const change = res.body.pendingChange;
    expect(change).toMatchObject({ status: 'PENDING', canDecide: false, canWithdraw: true });
    expect(change.fields).toEqual(
      expect.arrayContaining([
        { field: 'inherentImpact', from: 4, to: 2 },
        { field: 'ownerId', from: null, to: { en: 'approver', ar: 'مستخدم' } },
      ]),
    );
    await officer
      .patch(`/grc/risks/${id}`)
      .send({ inherentImpact: 3 })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('CHANGE_PENDING'));
    // Only the assignee decides; the submitter cannot approve their own change.
    await officer
      .post(`/grc/changes/${change.id}/decision`)
      .send({ decision: 'APPROVE' })
      .expect(403);
    const mine = await approver.get('/grc/changes?mine=true').expect(200);
    expect(mine.body.map((c: { id: string }) => c.id)).toEqual([change.id]);
    const n = await ctx.prisma.notification.findFirst({ where: { type: 'GRC_CHANGE' } });
    expect(n?.params).toMatchObject({ kind: 'requested' });
    const done = await approver
      .post(`/grc/changes/${change.id}/decision`)
      .send({ decision: 'APPROVE', comment: 'ok' })
      .expect(200);
    expect(done.body.status).toBe('APPROVED');
    const after = await officer.get(`/grc/risks/${id}`).expect(200);
    expect(after.body.item).toMatchObject({ inherentImpact: 2, owner: { id: approverId } });
    expect(after.body.pendingChange).toBeNull();
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityId: id, action: { in: ['SUBMIT', 'APPROVE', 'ASSESS'] } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual(['APPROVE', 'ASSESS', 'SUBMIT']);
  });

  it('rejects, withdraws and refuses changes without a workflow or without changes', async () => {
    const id = await newRisk();
    await enable(officer);
    const c1 = (await officer.patch(`/grc/risks/${id}`).send({ status: 'RETIRED' }).expect(200))
      .body.pendingChange;
    await approver
      .post(`/grc/changes/${c1.id}/decision`)
      .send({ decision: 'REJECT', comment: 'Still needed' })
      .expect(200);
    expect((await officer.get(`/grc/risks/${id}`).expect(200)).body.item.status).toBe('ACTIVE');
    const c2 = (await officer.patch(`/grc/risks/${id}`).send({ nameEn: 'Fraud 2' }).expect(200))
      .body.pendingChange;
    await reviewer.post(`/grc/changes/${c2.id}/withdraw`).expect(403);
    await officer.post(`/grc/changes/${c2.id}/withdraw`).expect(200);
    await officer
      .patch(`/grc/risks/${id}`)
      .send({ nameEn: 'Fraud' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('NO_CHANGES'));
    await ctx.prisma.workflow.update({
      where: { id: workflowId },
      data: { deletedAt: new Date() },
    });
    await officer
      .patch(`/grc/risks/${id}`)
      .send({ nameEn: 'Other' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('NO_WORKFLOW'));
  });

  it('routes control changes too (effectiveness is applied on approval)', async () => {
    await enable(officer);
    const c = (
      await officer
        .post('/grc/controls')
        .send({ code: 'C-1', nameEn: 'Four eyes', status: 'ACTIVE' })
        .expect(201)
    ).body.item.id;
    const pending = (
      await officer.patch(`/grc/controls/${c}`).send({ effectiveness: 'EFFECTIVE' }).expect(200)
    ).body.pendingChange;
    expect(pending.fields).toEqual([
      { field: 'effectiveness', from: 'NOT_ASSESSED', to: 'EFFECTIVE' },
    ]);
    await approver.post(`/grc/changes/${pending.id}/decision`).send({ decision: 'APPROVE' });
    expect((await officer.get(`/grc/controls/${c}`)).body.item.effectiveness).toBe('EFFECTIVE');
  });

  it('Excel import: changes of active items become one batch to approve together; new rows are drafts', async () => {
    const id = await newRisk(); // R-1, active
    const r2 = (
      await officer
        .post('/grc/risks')
        .send({
          code: 'R-2',
          nameEn: 'Theft',
          category: 'FRAUD',
          inherentLikelihood: 2,
          inherentImpact: 2,
        })
        .expect(201)
    ).body.item.id;
    await enable(officer);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Risks');
    ws.addRow([
      'Code',
      'Title (English)',
      'Category (key)',
      'Inherent likelihood (1-5)',
      'Inherent impact (1-5)',
    ]);
    ws.addRow(['R-1', 'Fraud (renamed)', 'FRAUD', 4, 4]);
    ws.addRow(['R-2', 'Theft', 'FRAUD', 3, 2]);
    ws.addRow(['R-3', 'Bribery', 'FRAUD', 2, 5]);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const dry = (await officer.post('/grc/import/risks').attach('file', file, 'r.xlsx').expect(200))
      .body;
    expect(dry).toMatchObject({ created: 1, updated: 2, pending: 2, imported: false });
    const done = (
      await officer
        .post('/grc/import/risks?dryRun=false')
        .attach('file', file, 'r.xlsx')
        .expect(200)
    ).body;
    expect(done).toMatchObject({ created: 1, updated: 0, pending: 2, imported: true });
    expect(done.batchId).toBeTruthy();
    // Current values stay; the new item is a draft.
    expect((await officer.get(`/grc/risks/${id}`)).body.item.nameEn).toBe('Fraud');
    const r3 = await ctx.prisma.repoObject.findFirstOrThrow({
      where: { code: 'R-3' },
      include: { risk: true },
    });
    expect(r3.risk!.status).toBe('DRAFT');
    // One notification for the whole import; a second import is refused while changes wait.
    expect(
      await ctx.prisma.notification.count({ where: { type: 'GRC_CHANGE', userId: approverId } }),
    ).toBe(1);
    const again = (
      await officer.post('/grc/import/risks').attach('file', file, 'r.xlsx').expect(200)
    ).body;
    expect(again.errors.filter((e: { code: string }) => e.code === 'CHANGE_PENDING')).toHaveLength(
      2,
    );
    const mine = (await approver.get('/grc/changes?mine=true').expect(200)).body;
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ batchId: done.batchId, batchSize: 2 });
    await officer
      .post(`/grc/changes/batches/${done.batchId}/decision`)
      .send({ decision: 'APPROVE' })
      .expect(403);
    const decided = (
      await approver
        .post(`/grc/changes/batches/${done.batchId}/decision`)
        .send({ decision: 'APPROVE' })
        .expect(200)
    ).body;
    expect(decided.map((c: { status: string }) => c.status)).toEqual(['APPROVED', 'APPROVED']);
    expect((await officer.get(`/grc/risks/${id}`)).body.item.nameEn).toBe('Fraud (renamed)');
    expect((await officer.get(`/grc/risks/${r2}`)).body.item.inherentLikelihood).toBe(3);
  });

  it('active risks are retired through approval and never deleted; drafts can be deleted', async () => {
    const id = await newRisk();
    await enable(officer);
    await officer.delete(`/grc/risks/${id}`).expect(409);
    const c = (await officer.patch(`/grc/risks/${id}`).send({ status: 'RETIRED' }).expect(200)).body
      .pendingChange;
    await approver.post(`/grc/changes/${c.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    expect((await officer.get(`/grc/risks/${id}`)).body.item.status).toBe('RETIRED');
    await officer.delete(`/grc/risks/${id}`).expect(409);
    const draft = await newRisk('DRAFT');
    await officer.delete(`/grc/risks/${draft}`).expect(204);
  });
});
