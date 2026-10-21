import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

describe('Models, versions, objects and links (e2e)', () => {
  let ctx: TestContext;
  let modeler: Client;
  let processId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    processId = (
      await modeler.post('/processes').send({ code: 'C.01', nameEn: 'Sales', category: 'CORE' })
    ).body.id;
  });

  const role = (c: Client, nameEn: string) =>
    c.post('/objects').send({ type: 'ROLE', nameEn, nameAr: 'دور' });

  it('GET/PUT /processes/:id/model saves the working model', async () => {
    const empty = (await modeler.get(`/processes/${processId}/model`).expect(200)).body;
    expect(empty.bpmnXml).toBeNull();
    const saved = (
      await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn() }).expect(200)
    ).body;
    expect(saved.bpmnXml).toContain('Task_1');
    expect(saved.updatedBy.email).toBe('modeler@test.local');
    expect((await modeler.get(`/processes/${processId}`)).body.hasModel).toBe(true);
  });

  it('rejects unsafe or invalid BPMN', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>${sampleBpmn()}`;
    expect(
      (await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: xxe })).body.code,
    ).toBe('INVALID_BPMN');
    expect(
      (await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: '<html/>' })).body.code,
    ).toBe('INVALID_BPMN');
    expect((await modeler.put(`/processes/${processId}/model`).send({})).body.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('only users with model rights can save', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.get(`/processes/${processId}/model`).expect(200);
    await viewer.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn() }).expect(403);
    const owner = await loggedIn(ctx.app, 'owner@test.local');
    await owner.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn() }).expect(403);
    const ownerId = (
      await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.local' } })
    ).id;
    await modeler.patch(`/processes/${processId}`).send({ ownerId }).expect(200);
    await owner.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn() }).expect(200);
  });

  it('POST /processes/:id/versions snapshots the model with a change note', async () => {
    const v1 = (
      await modeler
        .post(`/processes/${processId}/versions`)
        .send({ bpmnXml: sampleBpmn(), changeNote: 'First' })
        .expect(201)
    ).body;
    expect(v1).toMatchObject({ versionNumber: 1, changeNote: 'First' });
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: sampleBpmn(['Task_2']), changeNote: 'Second' })
      .expect(201);
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: sampleBpmn(), changeNote: '' })
      .expect(400);
    const list = (await modeler.get(`/processes/${processId}/versions`).expect(200)).body;
    expect(list.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
    expect(list[0].createdBy.email).toBe('modeler@test.local');
    const one = (await modeler.get(`/processes/${processId}/versions/${v1.id}`).expect(200)).body;
    expect(one.bpmnXml).toContain('Task_1');
    expect((await modeler.get(`/processes/${processId}/model`)).body.bpmnXml).toContain('Task_2');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'VERSION' } })).toBe(2);
  });

  it('objects library: CRUD with bilingual fields and attributes', async () => {
    const created = (
      await modeler
        .post('/objects')
        .send({
          type: 'SYSTEM',
          code: 'SYS-1',
          nameEn: 'ERP',
          nameAr: 'نظام',
          attributes: { vendor: 'SAP', critical: true },
        })
        .expect(201)
    ).body;
    expect(created).toMatchObject({
      type: 'SYSTEM',
      usageCount: 0,
      attributes: { vendor: 'SAP', critical: true },
    });
    await role(modeler, 'Clerk').expect(201);
    const systems = (await modeler.get('/objects?type=SYSTEM').expect(200)).body;
    expect(systems.total).toBe(1);
    const updated = (
      await modeler.patch(`/objects/${created.id}`).send({ descriptionAr: 'وصف' }).expect(200)
    ).body;
    expect(updated.descriptionAr).toBe('وصف');
    await modeler.post('/objects').send({ type: 'ALIEN', nameEn: 'X' }).expect(400);
    // Other object types are supported by the data model already
    await modeler.post('/objects').send({ type: 'RISK', nameEn: 'Fraud' }).expect(201);
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.get(`/objects/${created.id}`).expect(200);
    await viewer.patch(`/objects/${created.id}`).send({ nameEn: 'X' }).expect(403);
  });

  it('links objects to BPMN elements, reports usage and prunes stale links', async () => {
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_1', 'Task_2']) });
    const clerk = (await role(modeler, 'Clerk')).body;
    const erp = (await modeler.post('/objects').send({ type: 'SYSTEM', nameEn: 'ERP' })).body;

    let links = (
      await modeler
        .post(`/processes/${processId}/links`)
        .send({ bpmnElementId: 'Task_1', repoObjectId: clerk.id })
        .expect(201)
    ).body;
    expect(links[0]).toMatchObject({ bpmnElementId: 'Task_1', relation: 'PERFORMS' });
    links = (
      await modeler
        .post(`/processes/${processId}/links`)
        .send({ bpmnElementId: 'Task_2', repoObjectId: erp.id })
        .expect(201)
    ).body;
    expect(
      links.find((l: { repoObject: { id: string } }) => l.repoObject.id === erp.id).relation,
    ).toBe('SUPPORTS');
    // idempotent
    links = (
      await modeler
        .post(`/processes/${processId}/links`)
        .send({ bpmnElementId: 'Task_1', repoObjectId: clerk.id })
    ).body;
    expect(links).toHaveLength(2);
    await modeler
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: '"><script>', repoObjectId: clerk.id })
      .expect(400);

    const usage = (await modeler.get(`/objects/${clerk.id}/usage`).expect(200)).body;
    expect(usage).toEqual([
      expect.objectContaining({
        bpmnElementId: 'Task_1',
        relation: 'PERFORMS',
        element: { nameEn: 'Task_1', nameAr: '' },
        process: expect.objectContaining({ code: 'C.01' }),
      }),
    ]);
    expect(
      links.find((l: { bpmnElementId: string }) => l.bpmnElementId === 'Task_2').element,
    ).toEqual({ nameEn: 'Task_2', nameAr: '' });
    expect((await modeler.get(`/objects/${clerk.id}`)).body.usageCount).toBe(1);

    // Removing Task_2 from the model prunes its link
    await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn(['Task_1']) });
    expect((await modeler.get(`/processes/${processId}/links`)).body).toHaveLength(1);

    const linkId = (await modeler.get(`/processes/${processId}/links`)).body[0].id;
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.delete(`/processes/${processId}/links/${linkId}`).expect(403);
    await modeler.delete(`/processes/${processId}/links/${linkId}`).expect(200);
    expect((await modeler.get(`/objects/${clerk.id}/usage`)).body).toEqual([]);
  });

  it('deleting an object removes its links; deleted processes disappear from usage', async () => {
    await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: sampleBpmn() });
    const clerk = (await role(modeler, 'Clerk')).body;
    await modeler
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_1', repoObjectId: clerk.id });
    await ctx.prisma.process.update({ where: { id: processId }, data: { deletedAt: new Date() } });
    expect((await modeler.get(`/objects/${clerk.id}/usage`)).body).toEqual([]);
    await modeler.delete(`/objects/${clerk.id}`).expect(204);
    await modeler.get(`/objects/${clerk.id}`).expect(404);
    expect(await ctx.prisma.objectLink.count()).toBe(0);
  });
});
