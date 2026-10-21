import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/**
 * Auditor: read-only access to the workspace (drafts, history, reviews, audit log) with no
 * edit, comment, approve or publish rights, and never an approver in a workflow.
 */
describe('Auditor role (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let auditor: Client;
  let auditorId: string;
  let processId: string;
  let pageId: string;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    auditorId = (await createUser(ctx.prisma, 'auditor@test.local', ['AUDITOR'])).id;
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    auditor = await loggedIn(ctx.app, 'auditor@test.local');

    processId = (
      await admin
        .post('/processes')
        .send({ code: 'C.01', nameEn: 'Orders', nameAr: 'الطلبات', category: 'CORE' })
        .expect(201)
    ).body.id;
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: sampleBpmn(['Check']), changeNote: 'v1' })
      .expect(201);
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Check', 'Draft step']) })
      .expect(200);
    spaceId = (
      await admin
        .post('/spaces')
        .send({ key: 'qm', nameEn: 'Quality', nameAr: 'الجودة', icon: 'safety' })
        .expect(201)
    ).body.id;
    pageId = (
      await modeler
        .post(`/spaces/${spaceId}/pages`)
        .send({ titleEn: 'Procedure', titleAr: 'إجراء' })
        .expect(201)
    ).body.id;
  });

  it('reads drafts, history, reviews and the audit log', async () => {
    const me = (await auditor.get('/auth/me').expect(200)).body;
    expect(me.roles).toEqual(['AUDITOR']);
    await auditor.get('/processes/tree').expect(200);
    await auditor.get(`/processes/${processId}`).expect(200);
    const model = (await auditor.get(`/processes/${processId}/model`).expect(200)).body;
    expect(model.bpmnXml).toContain('Draft step');
    const versions = (await auditor.get(`/processes/${processId}/versions`).expect(200)).body;
    expect(versions.items ?? versions).toHaveLength(1);
    await auditor.get(`/pages/${pageId}`).expect(200);
    await auditor.get(`/pages/${pageId}/versions`).expect(200);
    await auditor.get(`/governance/processes/${processId}`).expect(200);
    await auditor.get(`/governance/processes/${processId}/reviews`).expect(200);
    await auditor.get('/governance/dashboard').expect(200);
    await auditor.get(`/comments/processes/${processId}`).expect(200);
    const audit = (await auditor.get('/audit-logs').expect(200)).body;
    expect(audit.total).toBeGreaterThan(0);
    await auditor.get('/portal/home').expect(200);
  });

  it('cannot edit, comment, submit, publish or change settings', async () => {
    await auditor
      .post('/processes')
      .send({ code: 'C.09', nameEn: 'X', nameAr: 'س', category: 'CORE' })
      .expect(403);
    await auditor.patch(`/processes/${processId}`).send({ nameEn: 'Changed' }).expect(403);
    await auditor.delete(`/processes/${processId}`).expect(403);
    await auditor
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['X']) })
      .expect(403);
    await auditor
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: sampleBpmn(['X']), changeNote: 'x' })
      .expect(403);
    await auditor
      .put(`/pages/${pageId}`)
      .send({ titleEn: 'X', titleAr: 'س', changeNote: 'x' })
      .expect(403);
    await auditor.post(`/spaces/${spaceId}/pages`).send({ titleEn: 'X' }).expect(403);
    await auditor.post(`/comments/processes/${processId}`).send({ body: 'hi' }).expect(403);
    await auditor.post(`/governance/processes/${processId}/submit`).send({}).expect(403);
    await auditor.post(`/governance/processes/${processId}/archive`).send({}).expect(403);
    await auditor.post('/objects').send({ type: 'ROLE', nameEn: 'X' }).expect(403);
    await auditor.patch('/settings').send({}).expect(403);
    await auditor.post('/workflows').send({ nameEn: 'X', steps: [] }).expect(403);
    await auditor
      .patch(`/users/${auditorId}`)
      .send({ roles: ['SUPER_ADMIN'] })
      .expect(403);
  });

  it('is never an approver', async () => {
    // The role cannot be a workflow assignee…
    const res = await admin
      .post('/workflows')
      .send({
        nameEn: 'Audit',
        steps: [{ nameEn: 'Audit', assignees: [{ type: 'ROLE', roleKey: 'AUDITOR' }] }],
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    // …and a named Auditor is left out, so the step has nobody to review.
    await admin
      .patch(`/governance/processes/${processId}`)
      .send({
        customWorkflow: {
          nameEn: 'Named auditor',
          steps: [{ nameEn: 'Check', assignees: [{ type: 'USER', userId: auditorId }] }],
        },
      })
      .expect(200);
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Check']) })
      .expect(200);
    const submit = await modeler
      .post(`/governance/processes/${processId}/submit`)
      .send({})
      .expect(400);
    expect(submit.body.code).toBe('WORKFLOW_NO_ASSIGNEES');
  });
});
