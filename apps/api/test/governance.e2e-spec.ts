import { NotificationsService } from '../src/notifications/notifications.service';
import { GovernanceScheduler } from '../src/governance/scheduler.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

describe('Governance workflow (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let reviewer2: Client;
  let owner: Client;
  let viewer: Client;
  let ids: Record<string, string>;
  let workflowId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.sent = [];
    const users = {
      admin: await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']),
      modeler: await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']),
      reviewer: await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']),
      reviewer2: await createUser(ctx.prisma, 'reviewer2@test.local', ['REVIEWER']),
      owner: await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']),
      viewer: await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']),
    };
    ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id]));
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    reviewer2 = await loggedIn(ctx.app, 'reviewer2@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');

    workflowId = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Review then owner',
          nameAr: 'مراجعة ثم المالك',
          steps: [
            {
              nameEn: 'Review',
              nameAr: 'مراجعة',
              rule: 'ANY',
              assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }],
            },
            { nameEn: 'Owner approval', nameAr: 'اعتماد المالك', assignees: [{ type: 'OWNER' }] },
          ],
        })
        .expect(201)
    ).body.id;
    await admin
      .put('/governance/settings')
      .send({
        reviewIntervalMonths: 12,
        reminderDays: 14,
        reviewDueDays: 5,
        defaultWorkflowId: workflowId,
        categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
      })
      .expect(200);
  });

  const newProcess = async (code = 'C.01') => {
    const p = (
      await admin
        .post('/processes')
        .send({
          code,
          nameEn: 'Order handling',
          nameAr: 'معالجة الطلبات',
          category: 'CORE',
          ownerId: ids.owner,
        })
        .expect(201)
    ).body;
    return p.id as string;
  };
  const version = (c: Client, id: string, tasks = ['Task_1'], note = 'v') =>
    c.post(`/processes/${id}/versions`).send({ bpmnXml: sampleBpmn(tasks), changeNote: note });
  const info = async (c: Client, id: string) =>
    (await c.get(`/governance/processes/${id}`).expect(200)).body;
  const myReview = async (c: Client) => {
    const tasks = (await c.get('/tasks').expect(200)).body;
    return tasks.reviews[0];
  };
  const decide = (c: Client, reviewId: string, decision: string, comment?: string) =>
    c.post(`/reviews/${reviewId}/decision`).send({ decision, comment });
  const idle = () => ctx.app.get(NotificationsService).whenIdle();

  it('runs Draft → In Review → Approved → Published with sequential steps', async () => {
    const id = await newProcess();
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(409);
    await version(modeler, id).expect(201);

    let g = await info(modeler, id);
    expect(g).toMatchObject({
      status: 'DRAFT',
      latestVersion: 1,
      can: { submit: true, publish: false },
    });
    expect(g.workflow).toMatchObject({ source: 'DEFAULT', workflow: { id: workflowId } });

    g = (
      await modeler
        .post(`/governance/processes/${id}/submit`)
        .send({ note: 'Please check' })
        .expect(200)
    ).body;
    expect(g.status).toBe('IN_REVIEW');
    expect(g.activeReview).toMatchObject({ currentStep: 0, stepCount: 2, versionNumber: 1 });

    // Locked while in review.
    await version(modeler, id, ['Task_2']).expect(409);
    await modeler
      .put(`/processes/${id}/model`)
      .send({ bpmnXml: sampleBpmn(['X']) })
      .expect(409);
    await admin.patch(`/processes/${id}`).send({ nameEn: 'Renamed' }).expect(409);
    await admin.patch(`/processes/${id}`).send({ departmentId: null }).expect(200);

    // Both reviewers are asked (ANY); one approval completes the step.
    const r1 = await myReview(reviewer);
    expect(r1).toMatchObject({
      item: { entityId: id, code: 'C.01' },
      myTaskId: expect.any(String),
    });
    expect((await myReview(reviewer2)).id).toBe(r1.id);
    await decide(owner, r1.id, 'APPROVE').expect(403);
    await decide(reviewer, r1.id, 'APPROVE').expect(200);
    expect((await reviewer2.get('/tasks').expect(200)).body.reviews).toHaveLength(0);

    const detail = (await owner.get(`/reviews/${r1.id}`).expect(200)).body;
    expect(detail.steps.map((s: { state: string }) => s.state)).toEqual(['APPROVED', 'ACTIVE']);
    expect(detail.steps[0].tasks.map((t: { status: string }) => t.status).sort()).toEqual([
      'APPROVED',
      'SKIPPED',
    ]);
    expect(detail.canDecide).toBe(true);
    expect(detail.compare).toMatchObject({ kind: 'PROCESS', baseXml: null });

    await decide(owner, r1.id, 'APPROVE').expect(200);
    g = await info(modeler, id);
    expect(g).toMatchObject({ status: 'APPROVED', can: { publish: true } });
    expect((await modeler.get('/tasks').expect(200)).body.toPublish[0]).toMatchObject({
      entityId: id,
    });

    g = (
      await modeler
        .post(`/governance/processes/${id}/publish`)
        .send({ versionLabel: 'v1.0' })
        .expect(200)
    ).body;
    expect(g.status).toBe('PUBLISHED');
    expect(g.publication).toMatchObject({ versionNumber: 1, versionLabel: 'v1.0' });
    expect(g.publication.approvedBy.map((u: { id: string }) => u.id).sort()).toEqual(
      [ids.reviewer, ids.owner].sort(),
    );
    expect(new Date(g.nextReviewAt).getFullYear()).toBe(new Date().getFullYear() + 1);
    const versions = (await modeler.get(`/processes/${id}/versions`).expect(200)).body;
    expect(versions[0].label).toBe('v1.0');

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { entityType: 'Process', entityId: id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['SUBMIT', 'APPROVE', 'PUBLISH']));

    await idle();
    const typesOf = async (userId: string) =>
      (await ctx.prisma.notification.findMany({ where: { userId } })).map((n) => n.type).sort();
    // The modeler published it, so only the owner and the approvers hear about the publication.
    expect(await typesOf(ids.modeler)).toEqual(['APPROVED']);
    expect(await typesOf(ids.owner)).toEqual(['PUBLISHED', 'REVIEW_REQUESTED']);
    expect(await typesOf(ids.reviewer)).toEqual(['PUBLISHED', 'REVIEW_REQUESTED']);
  });

  it('editing a published item starts a draft; the publication stays until the next one', async () => {
    const id = await newProcess();
    await version(modeler, id).expect(201);
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    await decide(reviewer, (await myReview(reviewer)).id, 'APPROVE').expect(200);
    await decide(owner, (await myReview(owner)).id, 'APPROVE').expect(200);
    await modeler.post(`/governance/processes/${id}/publish`).send({}).expect(200);

    await version(modeler, id, ['Task_1', 'Task_2']).expect(201);
    let g = await info(modeler, id);
    expect(g).toMatchObject({
      status: 'DRAFT',
      latestVersion: 2,
      publication: { versionNumber: 1 },
    });

    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    const review = await myReview(reviewer);
    const detail = (await reviewer.get(`/reviews/${review.id}`).expect(200)).body;
    expect(detail.compare.baseVersion).toBe(1);
    expect(detail.compare.baseXml).toContain('Task_1');
    expect(detail.compare.newXml).toContain('Task_2');
    await decide(reviewer, review.id, 'APPROVE').expect(200);
    await decide(owner, (await myReview(owner)).id, 'APPROVE').expect(200);
    g = (await owner.post(`/governance/processes/${id}/publish`).send({}).expect(200)).body;
    expect(g.publication.versionNumber).toBe(2);
    const pubs = await ctx.prisma.publication.findMany({
      where: { entityId: id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(pubs.map((p) => [p.versionNumber, p.current])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('request changes needs a comment and returns the item to Draft', async () => {
    const id = await newProcess();
    await version(modeler, id).expect(201);
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    const r = await myReview(reviewer);
    await decide(reviewer, r.id, 'REQUEST_CHANGES').expect(400);
    await decide(reviewer, r.id, 'REQUEST_CHANGES', 'Step 2 is missing').expect(200);
    const g = await info(modeler, id);
    expect(g).toMatchObject({
      status: 'DRAFT',
      changesRequested: true,
      lastReview: { status: 'CHANGES_REQUESTED' },
    });
    expect((await modeler.get('/tasks').expect(200)).body.returned).toHaveLength(1);
    await decide(reviewer2, r.id, 'APPROVE').expect(409);
    await idle();
    const n = await ctx.prisma.notification.findFirst({
      where: { userId: ids.modeler, type: 'CHANGES_REQUESTED' },
    });
    expect(n?.params).toMatchObject({ comment: 'Step 2 is missing', code: 'C.01' });
  });

  it('reject, withdraw, archive and restore follow the allowed transitions', async () => {
    const id = await newProcess();
    await version(modeler, id).expect(201);
    await modeler.post(`/governance/processes/${id}/publish`).send({}).expect(409);
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(409);
    await owner.post(`/governance/processes/${id}/archive`).send({}).expect(409);
    await decide(reviewer, (await myReview(reviewer)).id, 'REJECT', 'Out of scope').expect(200);
    expect((await info(modeler, id)).rejected).toBe(true);

    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    await reviewer.post(`/governance/processes/${id}/withdraw`).expect(403);
    await modeler.post(`/governance/processes/${id}/withdraw`).expect(200);
    expect((await myReview(reviewer)) ?? null).toBeNull();

    await modeler.post(`/governance/processes/${id}/archive`).send({}).expect(200); // modeler: processes.edit
    await reviewer.post(`/governance/processes/${id}/restore`).expect(403);
    await version(modeler, id, ['Z']).expect(409);
    const g = (await owner.post(`/governance/processes/${id}/restore`).expect(200)).body;
    expect(g.status).toBe('DRAFT');
    const actions = (await ctx.prisma.auditLog.findMany({ where: { entityId: id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['REJECT', 'WITHDRAW', 'ARCHIVE', 'UNARCHIVE']));
  });

  it('blocks self-approval: a submitter who is the only approver of a step cannot submit', async () => {
    const id = await newProcess();
    await version(owner, id).expect(201);
    // The owner step would only have the owner (the submitter) as approver.
    const res = await owner.post(`/governance/processes/${id}/submit`).send({}).expect(400);
    expect(res.body).toMatchObject({
      code: 'SELF_APPROVAL_NOT_ALLOWED',
      details: { step: 1, nameEn: 'Owner approval', nameAr: 'اعتماد المالك' },
    });
    expect((await info(owner, id)).status).toBe('DRAFT');
    expect(await ctx.prisma.review.count()).toBe(0);

    // Another approver on the owner step: the submitter is left out, the colleague decides.
    await admin
      .patch(`/governance/processes/${id}`)
      .send({
        customWorkflow: {
          nameEn: 'Owner or deputy',
          steps: [
            {
              nameEn: 'Approval',
              assignees: [{ type: 'OWNER' }, { type: 'USER', userId: ids.reviewer2 }],
            },
          ],
        },
      })
      .expect(200);
    await owner.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    const r = await myReview(reviewer2);
    const detail = (await owner.get(`/reviews/${r.id}`).expect(200)).body;
    expect(detail.steps[0].assignees.map((a: { id: string }) => a.id)).toEqual([ids.reviewer2]);
    expect(await myReview(owner)).toBeUndefined();
    await decide(reviewer2, r.id, 'APPROVE').expect(200);
    expect((await info(owner, id)).status).toBe('APPROVED');
  });

  it('ALL steps, item workflows, auto-publish and missing assignees', async () => {
    const id = await newProcess();
    await version(modeler, id).expect(201);
    await owner
      .patch(`/governance/processes/${id}`)
      .send({
        customWorkflow: {
          nameEn: 'Both reviewers',
          autoPublish: true,
          steps: [
            {
              nameEn: 'Joint review',
              rule: 'ALL',
              assignees: [
                { type: 'USER', userId: ids.reviewer },
                { type: 'USER', userId: ids.reviewer2 },
              ],
            },
          ],
        },
      })
      .expect(200);
    expect((await info(modeler, id)).workflow.source).toBe('ITEM');
    await reviewer.patch(`/governance/processes/${id}`).send({ workflowId: null }).expect(403);
    expect((await admin.get('/workflows').expect(200)).body).toHaveLength(1); // custom ones are not templates

    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    const r = await myReview(reviewer);
    await decide(reviewer, r.id, 'APPROVE').expect(200);
    expect((await info(modeler, id)).status).toBe('IN_REVIEW');
    await decide(reviewer2, r.id, 'APPROVE').expect(200);
    expect(await info(modeler, id)).toMatchObject({
      status: 'PUBLISHED',
      publication: { versionNumber: 1 },
    });

    const id2 = await newProcess('C.02');
    await version(modeler, id2).expect(201);
    await admin
      .patch(`/governance/processes/${id2}`)
      .send({
        customWorkflow: {
          nameEn: 'Nobody',
          steps: [{ nameEn: 'x', assignees: [{ type: 'ROLE', roleKey: 'SUPER_ADMIN' }] }],
        },
      })
      .expect(200);
    const res = await modeler.post(`/governance/processes/${id2}/submit`).send({}).expect(400);
    expect(res.body.code).toBe('WORKFLOW_NO_ASSIGNEES');
  });

  it('unversioned model changes must be saved as a version before submitting', async () => {
    const id = await newProcess();
    await version(modeler, id).expect(201);
    await modeler
      .put(`/processes/${id}/model`)
      .send({ bpmnXml: sampleBpmn(['Changed']) })
      .expect(200);
    const g = await info(modeler, id);
    expect(g.hasUnversionedChanges).toBe(true);
    expect(
      (await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(409)).body.code,
    ).toBe('UNVERSIONED_CHANGES');
  });

  it('workflows and settings are for governance managers; templates in use cannot be deleted', async () => {
    await modeler
      .post('/workflows')
      .send({ nameEn: 'x', steps: [{ nameEn: 'a', assignees: [{ type: 'OWNER' }] }] })
      .expect(403);
    await owner.put('/governance/settings').send({}).expect(403);
    await admin.delete(`/workflows/${workflowId}`).expect(409);
    const w = (await admin.get(`/workflows/${workflowId}`).expect(200)).body;
    expect(w).toMatchObject({
      usage: 1,
      steps: [
        { rule: 'ANY', assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }] },
        { assignees: [{ type: 'OWNER' }] },
      ],
    });
    await admin
      .put('/governance/settings')
      .send({
        reviewIntervalMonths: 6,
        reminderDays: 7,
        reviewDueDays: 3,
        defaultWorkflowId: '00000000-0000-4000-8000-000000000000',
        categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
      })
      .expect(400);
  });

  it('viewers have no access to the governance API', async () => {
    const id = await newProcess();
    await viewer.get(`/governance/processes/${id}`).expect(403);
    await viewer.post(`/governance/processes/${id}/submit`).send({}).expect(403);
    await viewer.get('/governance/dashboard').expect(403);
    await viewer.get('/workflows').expect(403);
    expect((await viewer.get('/tasks').expect(200)).body.reviews).toEqual([]);
  });

  it('dashboard: counts, reviews in progress and overdue periodic reviews', async () => {
    const id = await newProcess();
    await newProcess('C.02');
    await version(modeler, id).expect(201);
    await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
    await modeler.get('/governance/dashboard').expect(403);
    const d = (await owner.get('/governance/dashboard').expect(200)).body;
    expect(d.counts.PROCESS).toMatchObject({ DRAFT: 1, IN_REVIEW: 1 });
    expect(d.inReview[0]).toMatchObject({ item: { entityId: id }, days: 0 });
  });

  it('reminders: overdue reviews and periodic review dates notify once, with email', async () => {
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    await superAdmin
      .put('/settings/email')
      .send({
        enabled: true,
        host: 'smtp.test',
        port: 25,
        fromAddress: 'hub@test.local',
        password: 'smtp-secret',
      })
      .expect(200);
    const id = await newProcess();
    await version(modeler, id).expect(201);
    await modeler
      .post(`/governance/processes/${id}/submit`)
      .send({ dueAt: new Date(Date.now() - 86_400_000).toISOString() })
      .expect(200);
    const scheduler = ctx.app.get(GovernanceScheduler);
    expect((await scheduler.runOnce()).tasks).toBe(1);
    expect((await scheduler.runOnce()).tasks).toBe(0);
    await idle();
    const overdue = await ctx.prisma.notification.findMany({ where: { type: 'REVIEW_OVERDUE' } });
    expect(overdue.map((n) => n.userId).sort()).toEqual([ids.reviewer, ids.reviewer2].sort());
    expect(overdue.every((n) => n.emailStatus === 'SENT')).toBe(true);
    const mail = ctx.mail.sent.find(
      (m) => m.to === 'reviewer@test.local' && m.subject.startsWith('Overdue'),
    );
    expect(mail?.html).toContain('/reviews/');
    expect(mail?.text).toContain('Order handling');

    // Publish, then move the review date into the past.
    await decide(reviewer, (await myReview(reviewer)).id, 'APPROVE').expect(200);
    await decide(owner, (await myReview(owner)).id, 'APPROVE').expect(200);
    await owner.post(`/governance/processes/${id}/publish`).send({}).expect(200);
    await owner
      .patch(`/governance/processes/${id}`)
      .send({ nextReviewAt: new Date(Date.now() - 86_400_000).toISOString() })
      .expect(200);
    expect((await info(owner, id)).reviewState).toBe('OVERDUE');
    expect((await scheduler.runOnce()).overdue).toBe(1);
    expect((await scheduler.runOnce()).overdue).toBe(0);
    expect((await owner.get('/tasks').expect(200)).body.dueReviews[0]).toMatchObject({
      entityId: id,
      reviewState: 'OVERDUE',
    });
    expect((await admin.get('/governance/dashboard').expect(200)).body.overdueReviews).toHaveLength(
      1,
    );

    const g = (await owner.post(`/governance/processes/${id}/confirm-review`).expect(200)).body;
    expect(g.reviewState).toBe('OK');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'REVIEW_CONFIRMED' } })).toBe(1);
  });

  it('pages: space default workflow, lock while in review, publish', async () => {
    const space = (await admin.post('/spaces').send({ key: 'QM', nameEn: 'Quality' }).expect(201))
      .body;
    const pw = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Page review',
          steps: [{ nameEn: 'Review', assignees: [{ type: 'USER', userId: ids.reviewer }] }],
        })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/governance/spaces/${space.id}/workflow`)
      .send({ workflowId: pw })
      .expect(403);
    await admin.put(`/governance/spaces/${space.id}/workflow`).send({ workflowId: pw }).expect(200);
    const page = (
      await modeler
        .post(`/spaces/${space.id}/pages`)
        .send({ titleEn: 'SOP', titleAr: 'إجراء' })
        .expect(201)
    ).body;
    expect(page.status).toBe('DRAFT');
    let g = (await modeler.get(`/governance/pages/${page.id}`).expect(200)).body;
    expect(g).toMatchObject({ workflow: { source: 'SPACE' }, owner: { id: ids.modeler } });
    await modeler.post(`/governance/pages/${page.id}/submit`).send({}).expect(200);
    await modeler.put(`/pages/${page.id}`).send({ titleEn: 'SOP 2', changeNote: 'x' }).expect(409);
    const r = await myReview(reviewer);
    const detail = (await reviewer.get(`/reviews/${r.id}`).expect(200)).body;
    expect(detail.compare).toMatchObject({ kind: 'PAGE', base: null, next: { titleEn: 'SOP' } });
    await decide(reviewer, r.id, 'APPROVE').expect(200);
    g = (await modeler.post(`/governance/pages/${page.id}/publish`).send({}).expect(200)).body;
    expect(g.status).toBe('PUBLISHED');
    const tree = (await modeler.get(`/spaces/${space.id}/pages`).expect(200)).body;
    expect(tree[0].status).toBe('PUBLISHED');
  });
});
