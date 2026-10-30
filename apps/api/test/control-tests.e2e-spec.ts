import { AssuranceScheduler } from '../src/assurance/assurance-scheduler.service';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

/** Control testing (Phase 4.2, step 1 — D-099). */
describe('Control testing (e2e)', () => {
  let ctx: TestContext;
  let officer: Client;
  let reviewer: Client;
  let tester: Client;
  let viewer: Client;
  let testerId: string;
  let reviewerId: string;
  let controlId: string;
  let riskId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    reviewerId = (await createUser(ctx.prisma, 'audit@test.local', ['INTERNAL_AUDIT'])).id;
    testerId = (await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'])).id;
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    officer = await loggedIn(ctx.app, 'officer@test.local');
    reviewer = await loggedIn(ctx.app, 'audit@test.local');
    tester = await loggedIn(ctx.app, 'owner@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    controlId = (
      await officer
        .post('/grc/controls')
        .send({ code: 'C-1', nameEn: 'PO approval', status: 'ACTIVE', effectiveness: 'EFFECTIVE' })
        .expect(201)
    ).body.item.id;
    riskId = (
      await officer
        .post('/grc/risks')
        .send({
          code: 'R-1',
          nameEn: 'Fraud',
          category: 'FRAUD',
          inherentLikelihood: 4,
          inherentImpact: 4,
          controlIds: [controlId],
        })
        .expect(201)
    ).body.item.id;
  });

  const plan = (body: object = {}) =>
    officer.post('/control-tests/plans').send({
      controlId,
      testType: 'OPERATING',
      procedure: [
        { en: 'Check the approval', ar: 'تحقق من الاعتماد' },
        { en: 'Check the amount', ar: 'تحقق من المبلغ' },
      ],
      sampleSize: 2,
      frequency: 'QUARTERLY',
      testerId,
      reviewerId,
      nextDueAt: '2026-12-31',
      leadDays: 30,
      ...body,
    });

  it('the scheduler creates tests from plans and reminds testers once', async () => {
    const p = (await plan().expect(201)).body;
    expect(p).toMatchObject({ frequency: 'QUARTERLY', tester: { user: { id: testerId } } });
    await plan({ testerId: reviewerId }).expect(400); // tester = reviewer
    const scheduler = ctx.app.get(AssuranceScheduler);
    expect((await scheduler.runOnce(new Date('2026-11-15T00:00:00Z'))).tests.created).toBe(0);
    expect((await scheduler.runOnce(new Date('2026-12-05T00:00:00Z'))).tests.created).toBe(1);
    const tests = (await officer.get(`/control-tests?controlId=${controlId}`).expect(200)).body;
    expect(tests.items).toHaveLength(1);
    expect(tests.items[0]).toMatchObject({
      period: '2026-Q4',
      status: 'PLANNED',
      origin: 'SCHEDULED',
      sampleSize: 2,
    });
    expect(tests.items[0].samples).toHaveLength(2);
    const plans = (await officer.get(`/control-tests/plans?controlId=${controlId}`)).body;
    expect(plans[0].nextDueAt.slice(0, 10)).toBe('2027-03-31');
    // Assigned + due reminder, then overdue — each once.
    await scheduler.runOnce(new Date('2026-12-20T00:00:00Z'));
    await scheduler.runOnce(new Date('2026-12-21T00:00:00Z'));
    await scheduler.runOnce(new Date('2027-01-02T00:00:00Z'));
    await scheduler.runOnce(new Date('2027-01-03T00:00:00Z'));
    const kinds = (
      await ctx.prisma.notification.findMany({
        where: { userId: testerId, type: 'CONTROL_TEST' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((n) => (n.params as { kind: string }).kind);
    expect(kinds).toEqual(['assigned', 'due', 'overdue']);
    const mine = (await tester.get('/assurance/tasks').expect(200)).body;
    expect(mine.testsToExecute).toHaveLength(1);
    expect((await reviewer.get('/assurance/tasks')).body.testsToExecute).toHaveLength(0);
  });

  it('tester executes with evidence, reviewer returns then signs off; effectiveness follows', async () => {
    await plan().expect(201);
    const planId = (await officer.get('/control-tests/plans')).body[0].id;
    const id = (
      await officer.post('/control-tests').send({ planId, dueAt: '2026-11-30' }).expect(201)
    ).body.id;
    await viewer.get(`/control-tests/${id}`).expect(403);
    await reviewer.post(`/control-tests/${id}/start`).expect(403); // not the tester
    await tester.post(`/control-tests/${id}/start`).expect(200);
    await tester
      .post(`/control-tests/${id}/submit`)
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('TEST_INCOMPLETE'));
    const file = await tester
      .post(`/control-tests/${id}/files`)
      .attach('file', Buffer.from('%PDF-1.4 evidence'), {
        filename: 'evidence.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    await tester
      .post(`/control-tests/${id}/files`)
      .attach('file', Buffer.from('MZ binary'), { filename: 'x.exe' })
      .expect(400);
    await tester
      .put(`/control-tests/${id}/results`)
      .send({
        samples: [
          { ref: 'PO-1', steps: ['PASS', 'PASS'], result: 'PASS', note: '' },
          { ref: 'PO-2', steps: ['FAIL', 'PASS'], result: 'FAIL', note: 'No approval' },
        ],
        conclusion: 'NOT_EFFECTIVE',
        testerComment: 'One order without approval',
      })
      .expect(200);
    await tester.post(`/control-tests/${id}/submit`).expect(200);
    await tester.post(`/control-tests/${id}/review`).send({ decision: 'APPROVE' }).expect(403);
    await reviewer.post(`/control-tests/${id}/review`).send({ decision: 'RETURN' }).expect(400);
    await reviewer
      .post(`/control-tests/${id}/review`)
      .send({ decision: 'RETURN', comment: 'Add the PO number' })
      .expect(200);
    expect((await tester.get(`/control-tests/${id}`)).body.status).toBe('RETURNED');
    await tester.post(`/control-tests/${id}/submit`).expect(200);
    const done = await reviewer
      .post(`/control-tests/${id}/review`)
      .send({ decision: 'APPROVE', comment: 'Agreed' })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'REVIEWED', reviewedBy: { id: reviewerId } });
    expect(done.body.files.map((f: { fileName: string }) => f.fileName)).toEqual(['evidence.pdf']);
    expect(done.body.events.length).toBeGreaterThan(4);

    const control = (await officer.get(`/grc/controls/${controlId}`)).body.item;
    expect(control).toMatchObject({
      effectiveness: 'EFFECTIVE',
      operatingEffectiveness: 'NOT_EFFECTIVE',
    });
    // The tested result counts: the risk is no longer effectively controlled.
    expect((await officer.get(`/grc/risks/${riskId}`)).body.item.effectivelyControlled).toBe(false);
    expect(control.testOverdue).toBe(false);
    // A tested result older than one test cycle (quarterly plan) still counts but is flagged.
    await ctx.prisma.control.update({
      where: { objectId: controlId },
      data: { lastTestedAt: new Date(Date.now() - 120 * 86_400_000) },
    });
    const stale = (await officer.get(`/grc/controls/${controlId}`)).body.item;
    expect(stale).toMatchObject({ operatingEffectiveness: 'NOT_EFFECTIVE', testOverdue: true });
    expect(
      (await officer.get('/grc/controls?testOverdue=true')).body.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([controlId]);
    expect((await officer.get('/grc/dashboard')).body.coverage.testsOverdue).toBe(1);
    const timeline = (await officer.get(`/grc/items/${controlId}/timeline`)).body;
    expect(timeline[0].changes.operatingEffectiveness).toEqual({
      from: 'NOT_ASSESSED',
      to: 'NOT_EFFECTIVE',
    });

    // Evidence: readable by people involved, never by others.
    await tester.get(`/assurance/files/${file.body.id}`).expect(200);
    await viewer.get(`/assurance/files/${file.body.id}`).expect(404);
    await officer.post(`/control-tests/${id}/close`).expect(200);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityId: id, entityType: 'ControlTest' },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['CREATE', 'SUBMIT', 'REQUEST_CHANGES', 'APPROVE']),
    );
  });

  it('four-eyes: whoever executed a test cannot review it', async () => {
    const id = (
      await officer
        .post('/control-tests')
        .send({ controlId, dueAt: '2026-11-30', sampleSize: 1, procedure: [] })
        .expect(201)
    ).body.id;
    await officer.post(`/control-tests/${id}/start`).expect(200);
    await officer
      .put(`/control-tests/${id}/results`)
      .send({ samples: [{ ref: 'A', steps: [], result: 'PASS' }], conclusion: 'EFFECTIVE' })
      .expect(200);
    await officer.post(`/control-tests/${id}/submit`).expect(200);
    await officer.post(`/control-tests/${id}/review`).send({ decision: 'APPROVE' }).expect(403);
    await reviewer.post(`/control-tests/${id}/review`).send({ decision: 'APPROVE' }).expect(200);
  });
});
