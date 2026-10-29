import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

/** BPMN with ProcessHub labels; `refs` maps element id → linked object id (ph:labelRef). */
function labelledBpmn(tasks: { id: string; en: string; ar: string; ref?: string }[]): string {
  const body = tasks
    .map(
      (t) =>
        `<bpmn:userTask id="${t.id}" name="${t.en}" ph:nameEn="${t.en}" ph:nameAr="${t.ar}"${
          t.ref ? ` ph:labelRef="${t.ref}"` : ''
        } />`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="Defs_1"><bpmn:process id="Process_1">${body}</bpmn:process></bpmn:definitions>`;
}

describe('Dictionary: terms, autocomplete, label links and rename (e2e)', () => {
  let ctx: TestContext;
  let modeler: Client;
  let owner: Client;
  let admin: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
  });

  const term = (c: Client, body: Record<string, unknown>) =>
    c.post('/dictionary/terms').send({ type: 'TERM', ...body });

  it('modelers propose drafts; approvers approve or reject them (audited)', async () => {
    const draft = (
      await term(modeler, {
        nameEn: 'Program request',
        nameAr: 'طلب برنامج',
        descriptionEn: 'A request to start a program.',
        synonymsEn: ['Initiative request'],
        synonymsAr: ['طلب مبادرة'],
        category: 'Programs',
        status: 'APPROVED',
      }).expect(201)
    ).body;
    expect(draft).toMatchObject({
      type: 'TERM',
      status: 'DRAFT',
      category: 'Programs',
      synonymsEn: ['Initiative request'],
      createdBy: { email: 'modeler@test.local' },
      approvedAt: null,
    });

    // Drafts are not suggested; the modeler cannot approve.
    expect((await modeler.get('/dictionary/suggest?q=program').expect(200)).body).toEqual([]);
    await modeler.post(`/dictionary/terms/${draft.id}/approve`).expect(403);
    const listed = await owner.get('/objects?type=TERM&status=DRAFT').expect(200);
    expect(listed.body.items.map((o: { id: string }) => o.id)).toEqual([draft.id]);

    const approved = (await owner.post(`/dictionary/terms/${draft.id}/approve`).expect(200)).body;
    expect(approved).toMatchObject({
      status: 'APPROVED',
      approvedBy: { email: 'owner@test.local' },
    });
    expect((await owner.post(`/dictionary/terms/${draft.id}/approve`)).body.code).toBe(
      'TERM_ALREADY_APPROVED',
    );

    // Approved terms can only be changed by approvers (owners through the dictionary endpoint).
    await modeler.patch(`/objects/${draft.id}`).send({ category: 'Other' }).expect(403);
    await modeler.patch(`/dictionary/terms/${draft.id}`).send({ category: 'Other' }).expect(403);
    await owner.patch(`/objects/${draft.id}`).send({ category: 'Other' }).expect(403);
    await owner.patch(`/dictionary/terms/${draft.id}`).send({ category: 'Programmes' }).expect(200);
    await admin.patch(`/objects/${draft.id}`).send({ category: 'Other' }).expect(200);

    const second = (await term(modeler, { nameEn: 'Gate review' }).expect(201)).body;
    // Drafts can be edited by proposers; a role is not a term.
    await modeler.patch(`/dictionary/terms/${second.id}`).send({ nameAr: 'مراجعة' }).expect(200);
    const role = (await modeler.post('/objects').send({ type: 'ROLE', nameEn: 'PMO' })).body;
    expect((await modeler.patch(`/dictionary/terms/${role.id}`).send({})).body.code).toBe(
      'NOT_A_TERM',
    );
    await owner
      .post(`/dictionary/terms/${second.id}/reject`)
      .send({ reason: 'Duplicate' })
      .expect(204);
    await modeler.get(`/objects/${second.id}`).expect(404);

    const actions = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'RepoObject' },
      orderBy: { createdAt: 'asc' },
      select: { action: true, summary: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'CREATE', // proposal
      'APPROVE',
      'UPDATE', // admin
      'UPDATE', // owner via the dictionary endpoint
      'CREATE', // second proposal
      'UPDATE',
      'CREATE', // the role
      'REJECT',
    ]);
    expect(actions[7].summary).toMatchObject({ reason: 'Duplicate' });
  });

  it('approvers may create approved terms; other object types stay approved', async () => {
    expect((await term(owner, { nameEn: 'Charter' }).expect(201)).body.status).toBe('APPROVED');
    expect((await term(owner, { nameEn: 'Memo', status: 'DRAFT' }).expect(201)).body.status).toBe(
      'DRAFT',
    );
    const role = await modeler
      .post('/objects')
      .send({ type: 'ROLE', nameEn: 'PMO', status: 'DRAFT' })
      .expect(201);
    expect(role.body.status).toBe('APPROVED');
    expect((await term(modeler, { type: 'ROLE', nameEn: 'X' })).body.code).toBe('NOT_A_TERM');
  });

  it('suggests approved terms, roles and systems by name or synonym in both languages', async () => {
    const t = (
      await term(owner, {
        nameEn: 'Program request',
        nameAr: 'طلب برنامج',
        synonymsAr: ['طلب مبادرة'],
      }).expect(201)
    ).body;
    await modeler
      .post('/objects')
      .send({ type: 'ROLE', nameEn: 'Program manager', nameAr: 'مدير البرنامج' });
    await modeler
      .post('/objects')
      .send({ type: 'SYSTEM', nameEn: 'Salesforce PMS', nameAr: 'سيلزفورس' });
    await modeler.post('/objects').send({ type: 'DOCUMENT', nameEn: 'Program charter' });

    const en = (await modeler.get('/dictionary/suggest?q=prog').expect(200)).body;
    expect(en.map((s: { type: string; nameEn: string }) => `${s.type}:${s.nameEn}`)).toEqual([
      'TERM:Program request',
      'ROLE:Program manager',
    ]);
    const roles = (await modeler.get('/dictionary/suggest?q=prog&types=ROLE').expect(200)).body;
    expect(roles).toHaveLength(1);

    await modeler.patch('/auth/me').send({ locale: 'ar' }).expect(200);
    const ar = (await modeler.get(`/dictionary/suggest?q=${encodeURIComponent('مبادره')}`)).body;
    expect(ar).toEqual([expect.objectContaining({ id: t.id, synonym: 'طلب مبادرة' })]);

    await modeler.get('/dictionary/suggest').expect(400);
    await modeler.get('/dictionary/suggest?q=x&types=RISK').expect(400);
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.get('/dictionary/suggest?q=prog').expect(403);
    await (
      await loggedIn(ctx.app, 'reviewer@test.local')
    )
      .post('/dictionary/terms')
      .send({ type: 'TERM', nameEn: 'x' })
      .expect(403);
  });

  it('keeps object links in sync with ph:labelRef when a model is saved', async () => {
    const t = (await term(owner, { nameEn: 'Program request', nameAr: 'طلب برنامج' })).body;
    const role = (await modeler.post('/objects').send({ type: 'ROLE', nameEn: 'PMO' })).body;
    const p = (
      await modeler.post('/processes').send({ code: 'C.01', nameEn: 'Programs', category: 'CORE' })
    ).body;
    const save = (xml: string) =>
      modeler.put(`/processes/${p.id}/model`).send({ bpmnXml: xml }).expect(200);
    await save(
      labelledBpmn([
        { id: 'T1', en: 'Program request', ar: 'طلب برنامج', ref: t.id },
        { id: 'T2', en: 'PMO', ar: 'PMO', ref: role.id },
        { id: 'T3', en: 'Other', ar: 'أخرى', ref: '00000000-0000-0000-0000-000000000000' },
      ]),
    );
    const links = async () =>
      (await modeler.get(`/processes/${p.id}/links`).expect(200)).body
        .map((l: { bpmnElementId: string; relation: string }) => `${l.bpmnElementId}:${l.relation}`)
        .sort();
    expect(await links()).toEqual(['T1:NAMED', 'T2:PERFORMS']);
    expect((await modeler.get(`/objects/${t.id}/usage`)).body).toHaveLength(1);

    // Removing the references removes the NAMED link; the role link stays (it may be kept on purpose).
    await save(
      labelledBpmn([
        { id: 'T1', en: 'Program request', ar: 'طلب برنامج' },
        { id: 'T2', en: 'PMO', ar: 'PMO' },
      ]),
    );
    expect(await links()).toEqual(['T2:PERFORMS']);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityType: 'ProcessModel' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.summary).toMatchObject({ labelRefs: { removed: [`T1:${t.id}`] } });
  });

  it('renames a term with a preview and a new version per process the user may edit', async () => {
    const t = (await term(owner, { nameEn: 'Program request', nameAr: 'طلب برنامج' })).body;
    const mk = async (code: string, ownerEmail?: string) => {
      const ownerId = ownerEmail
        ? (await ctx.prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id
        : undefined;
      const p = (
        await admin.post('/processes').send({ code, nameEn: code, category: 'CORE', ownerId })
      ).body;
      await admin.put(`/processes/${p.id}/model`).send({
        bpmnXml: labelledBpmn([
          { id: 'T1', en: 'Program request', ar: 'طلب برنامج', ref: t.id },
          { id: 'T2', en: 'Unrelated', ar: 'غير مرتبط' },
        ]),
      });
      return p.id as string;
    };
    const own = await mk('C.01', 'owner@test.local');
    const other = await mk('C.02');
    const locked = await mk('C.03', 'owner@test.local');
    await ctx.prisma.process.update({ where: { id: locked }, data: { status: 'IN_REVIEW' } });
    const published = await mk('C.04', 'owner@test.local');
    await ctx.prisma.process.update({ where: { id: published }, data: { status: 'PUBLISHED' } });

    const names = { nameEn: 'Initiative request', nameAr: 'طلب مبادرة' };
    const preview = (
      await owner.post(`/dictionary/objects/${t.id}/rename-preview`).send(names).expect(200)
    ).body;
    expect(
      preview.processes.map(
        (p: {
          process: { code: string };
          canUpdate: boolean;
          reason: string | null;
          newDraft: boolean;
        }) => [p.process.code, p.canUpdate, p.reason, p.newDraft],
      ),
    ).toEqual([
      ['C.01', true, null, false],
      ['C.02', false, 'NO_PERMISSION', false],
      ['C.03', false, 'ITEM_IN_REVIEW', false],
      ['C.04', true, null, true],
    ]);
    expect(preview.processes[0].elements).toEqual([
      {
        elementId: 'T1',
        before: { nameEn: 'Program request', nameAr: 'طلب برنامج' },
        after: names,
      },
    ]);
    // Nothing changed yet.
    expect((await owner.get(`/objects/${t.id}`)).body.nameEn).toBe('Program request');

    // A modeler cannot rename an approved term, a reviewer no term at all.
    await modeler.post(`/dictionary/objects/${t.id}/rename`).send(names).expect(403);
    const reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    const draft = (await term(modeler, { nameEn: 'Draft term' })).body;
    await reviewer.post(`/dictionary/objects/${draft.id}/rename`).send(names).expect(403);
    await modeler
      .post(`/dictionary/objects/${draft.id}/rename`)
      .send({ nameEn: 'Draft 2' })
      .expect(200);

    const res = (await owner.post(`/dictionary/objects/${t.id}/rename`).send(names).expect(200))
      .body;
    expect(res.object).toMatchObject(names);
    expect(
      res.processes.map((p: { process: { code: string }; versionNumber?: number }) => [
        p.process.code,
        p.versionNumber ?? null,
      ]),
    ).toEqual([
      ['C.01', 1],
      ['C.02', null],
      ['C.03', null],
      ['C.04', 1],
    ]);
    const model = (await owner.get(`/processes/${own}/model`)).body.bpmnXml as string;
    expect(model).toContain('ph:nameEn="Initiative request"');
    expect(model).toContain('ph:nameAr="طلب مبادرة"');
    expect(model).toContain('ph:nameEn="Unrelated"');
    const v = (await owner.get(`/processes/${own}/versions`)).body[0];
    expect(v.changeNote).toContain('“Program request” renamed to “Initiative request”');
    expect((await owner.get(`/processes/${other}/model`)).body.bpmnXml).toContain(
      'ph:nameEn="Program request"',
    );
    // An edit of the published process starts a new draft.
    expect((await owner.get(`/processes/${published}`)).body.status).toBe('DRAFT');

    const audit = await ctx.prisma.auditLog.findFirst({
      where: {
        entityType: 'RepoObject',
        entityId: t.id,
        summary: { path: ['renamed'], not: 'null' },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.summary).toMatchObject({
      renamed: { to: names },
      updatedProcesses: expect.arrayContaining([own, published]),
      skippedProcesses: expect.arrayContaining([other, locked]),
    });
  });

  it('renames without touching labels when asked', async () => {
    const t = (await term(owner, { nameEn: 'Gate', nameAr: 'بوابة' })).body;
    const p = (await admin.post('/processes').send({ code: 'C.09', nameEn: 'X', category: 'CORE' }))
      .body;
    await admin
      .put(`/processes/${p.id}/model`)
      .send({ bpmnXml: labelledBpmn([{ id: 'T1', en: 'Gate', ar: 'بوابة', ref: t.id }]) });
    const res = (
      await admin
        .post(`/dictionary/objects/${t.id}/rename`)
        .send({ nameEn: 'Stage gate', nameAr: 'بوابة المرحلة', updateLabels: false })
        .expect(200)
    ).body;
    expect(res.processes).toEqual([]);
    expect((await admin.get(`/processes/${p.id}/versions`)).body).toEqual([]);
  });
});
