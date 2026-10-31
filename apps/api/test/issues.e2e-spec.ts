import { AssuranceScheduler } from '../src/assurance/assurance-scheduler.service';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

/** Issues and action plans (Phase 4.2, step 2 — D-100). */
describe('Issues and actions (e2e)', () => {
  let ctx: TestContext;
  let officer: Client;
  let owner: Client;
  let doer: Client;
  let viewer: Client;
  let ownerId: string;
  let doerId: string;
  let managerId: string;
  let officerId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const dept = await ctx.prisma.department.create({
      data: { nameEn: 'Finance', nameAr: 'المالية' },
    });
    officerId = (await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER'])).id;
    managerId = (await createUser(ctx.prisma, 'manager@test.local', ['REVIEWER'])).id;
    ownerId = (
      await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'], { departmentId: dept.id })
    ).id;
    doerId = (await createUser(ctx.prisma, 'doer@test.local', ['VIEWER'])).id;
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    await ctx.prisma.department.update({ where: { id: dept.id }, data: { managerId } });
    officer = await loggedIn(ctx.app, 'officer@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    doer = await loggedIn(ctx.app, 'doer@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
  });

  const raise = (body: object = {}) =>
    officer.post('/issues').send({
      titleEn: 'POs approved after delivery',
      titleAr: 'اعتماد أوامر الشراء بعد التسليم',
      severity: 'HIGH',
      ownerId,
      dueAt: '2026-12-31',
      actions: [{ titleEn: 'Train buyers', ownerId: doerId, dueAt: '2026-12-15' }],
      ...body,
    });

  it('raises an issue from a failed test, works the actions and verifies the fix', async () => {
    const control = (
      await officer
        .post('/grc/controls')
        .send({ code: 'C-1', nameEn: 'PO approval', status: 'ACTIVE' })
    ).body.item.id;
    const test = (
      await officer
        .post('/control-tests')
        .send({ controlId: control, dueAt: '2026-11-30' })
        .expect(201)
    ).body.id;
    await owner.post('/issues').send({ titleEn: 'x', severity: 'LOW' }).expect(403); // no issues.manage
    await raise({ sourceType: 'CONTROL_TEST' }).expect(400); // source id missing
    await raise({ severity: 'BOGUS' }).expect(400);
    const issue = (await raise({ sourceType: 'CONTROL_TEST', sourceId: test }).expect(201)).body;
    expect(issue).toMatchObject({
      code: 'ISS-0001',
      status: 'OPEN',
      sourceLink: `/grc/tests/${test}`,
      control: { id: control, code: 'C-1' },
      actionCount: 1,
    });
    const actionId = issue.actions[0].id;
    // The action owner (a Viewer) reaches the issue through the action and updates progress only.
    await viewer.get(`/issues/${issue.id}`).expect(404);
    const asDoer = (await doer.get(`/issues/${issue.id}`).expect(200)).body;
    expect(asDoer.actions[0].canUpdate).toBe(true);
    await doer.patch(`/issues/actions/${actionId}`).send({ titleEn: 'Renamed' }).expect(403);
    await doer
      .patch(`/issues/actions/${actionId}`)
      .send({ progress: 50, note: 'Half done' })
      .expect(200);
    expect((await owner.get(`/issues/${issue.id}`)).body.status).toBe('IN_PROGRESS');
    await doer
      .post(`/issues/actions/${actionId}/files`)
      .attach('file', Buffer.from('%PDF-1.4 training list'), { filename: 'training.pdf' })
      .expect(201);
    // Cannot be ready while an action is open.
    await owner
      .post(`/issues/${issue.id}/transition`)
      .send({ action: 'READY' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('ACTIONS_OPEN'));
    await doer.patch(`/issues/actions/${actionId}`).send({ progress: 100 }).expect(200);
    await owner.post(`/issues/${issue.id}/transition`).send({ action: 'READY' }).expect(200);
    // The owner never verifies their own fix; the raiser (officer) does.
    await owner.post(`/issues/${issue.id}/transition`).send({ action: 'VERIFY' }).expect(403);
    const verifyTasks = (await officer.get('/assurance/tasks')).body.issuesToVerify;
    expect(verifyTasks.map((i: { id: string }) => i.id)).toEqual([issue.id]);
    await officer
      .post(`/issues/${issue.id}/transition`)
      .send({ action: 'REJECT_VERIFICATION', comment: 'Show the training records' })
      .expect(200);
    await owner.post(`/issues/${issue.id}/transition`).send({ action: 'READY' }).expect(200);
    const closed = (
      await officer.post(`/issues/${issue.id}/transition`).send({ action: 'VERIFY' }).expect(200)
    ).body;
    expect(closed).toMatchObject({ status: 'CLOSED', verifiedBy: { id: officerId } });
    await owner.patch(`/issues/${issue.id}`).send({ titleEn: 'Late edit' }).expect(403);
    const kinds = (
      await ctx.prisma.notification.findMany({
        where: { type: 'ISSUE' },
        orderBy: { createdAt: 'asc' },
      })
    ).map(
      (n) =>
        `${n.userId === ownerId ? 'owner' : n.userId === doerId ? 'doer' : 'other'}:${(n.params as { kind: string }).kind}`,
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        'owner:assigned',
        'doer:action_assigned',
        'owner:returned',
        'owner:closed',
      ]),
    );
  });

  it('accepts a risk with a justification (officer, not the owner) and lists by filters', async () => {
    const issue = (await raise().expect(201)).body;
    await officer
      .post(`/issues/${issue.id}/transition`)
      .send({ action: 'ACCEPT_RISK' })
      .expect(400); // justification required
    const accepted = (
      await officer
        .post(`/issues/${issue.id}/transition`)
        .send({ action: 'ACCEPT_RISK', comment: 'Compensating control in place' })
        .expect(200)
    ).body;
    expect(accepted).toMatchObject({
      status: 'ACCEPTED_RISK',
      acceptanceJustification: 'Compensating control in place',
      acceptedBy: { id: officerId },
    });
    await raise({ titleEn: 'Second', severity: 'LOW' }).expect(201);
    const open = (await officer.get('/issues?open=true').expect(200)).body;
    expect(open.items.map((i: { titleEn: string }) => i.titleEn)).toEqual(['Second']);
    const mine = (await owner.get('/issues?mine=true').expect(200)).body;
    expect(mine.total).toBe(2);
    await viewer.get('/issues').expect(403);
  });

  it('reminds owners and escalates overdue issues to the department manager and officers', async () => {
    const issue = (await raise().expect(201)).body;
    const scheduler = ctx.app.get(AssuranceScheduler);
    await scheduler.runOnce(new Date('2026-12-26T00:00:00Z')); // due soon (issue), action overdue
    await scheduler.runOnce(new Date('2027-01-02T00:00:00Z')); // issue overdue
    await scheduler.runOnce(new Date('2027-01-10T00:00:00Z')); // past the 7 escalation days
    await scheduler.runOnce(new Date('2027-01-11T00:00:00Z')); // nothing new
    const rows = await ctx.prisma.notification.findMany({ where: { type: 'ISSUE' } });
    const of = (userId: string) =>
      rows
        .filter((r) => r.userId === userId)
        .map((r) => (r.params as { kind: string }).kind)
        .sort();
    expect(of(ownerId)).toEqual(['assigned', 'due', 'overdue']);
    expect(of(managerId)).toEqual(['escalated']);
    expect(of(officerId)).toEqual(expect.arrayContaining(['escalated', 'action_escalated']));
    expect(of(doerId)).toEqual(['action_assigned', 'action_overdue']);
    const detail = (await officer.get(`/issues/${issue.id}`)).body;
    expect(detail.escalatedAt).not.toBeNull();
  });

  it('first run after a long downtime: overdue and escalation in one run, nothing on the next', async () => {
    await raise().expect(201);
    const scheduler = ctx.app.get(AssuranceScheduler);
    await scheduler.runOnce(new Date('2027-01-20T00:00:00Z')); // first run, long past escalation
    const count = () => ctx.prisma.notification.count({ where: { type: 'ISSUE' } });
    const after = await count();
    const rows = await ctx.prisma.notification.findMany({ where: { type: 'ISSUE' } });
    const kinds = (userId: string) =>
      rows
        .filter((r) => r.userId === userId)
        .map((r) => (r.params as { kind: string }).kind)
        .sort();
    expect(kinds(ownerId)).toEqual(['assigned', 'overdue']);
    expect(kinds(managerId)).toEqual(['escalated']);
    expect(kinds(doerId)).toEqual(['action_assigned', 'action_overdue']);
    await scheduler.runOnce(new Date('2027-01-20T01:00:00Z'));
    await scheduler.runOnce(new Date('2027-01-21T00:00:00Z'));
    expect(await count()).toBe(after);
  });

  it('Viewers change only the actions assigned to them (D-106)', async () => {
    const issue = (
      await raise({
        actions: [
          { titleEn: 'Mine', ownerId: doerId },
          { titleEn: 'Not mine', ownerId },
        ],
      }).expect(201)
    ).body;
    const [mine, other] = issue.actions;
    await doer.patch(`/issues/actions/${mine.id}`).send({ progress: 20 }).expect(200);
    await doer.patch(`/issues/actions/${other.id}`).send({ progress: 20 }).expect(403);
    await doer
      .post(`/issues/actions/${other.id}/files`)
      .attach('file', Buffer.from('%PDF-1.4 x'), { filename: 'x.pdf' })
      .expect(403);
    await doer.post(`/issues/${issue.id}/transition`).send({ action: 'READY' }).expect(403);
    await doer.patch(`/issues/${issue.id}`).send({ titleEn: 'x' }).expect(403);
    // Another Viewer without an action does not even see the issue.
    await viewer.patch(`/issues/actions/${mine.id}`).send({ progress: 50 }).expect(404);
    await viewer.get(`/issues/${issue.id}`).expect(404);
    expect(
      (await ctx.prisma.issueAction.findUniqueOrThrow({ where: { id: other.id } })).progress,
    ).toBe(0);
  });
});
