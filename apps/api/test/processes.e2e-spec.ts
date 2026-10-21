import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

describe('Processes (e2e)', () => {
  let ctx: TestContext;
  let modeler: Client;
  let ownerId: string;

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
    ownerId = (await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'])).id;
    await createUser(ctx.prisma, 'viewer@test.local', ['REVIEWER']);
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
  });

  const create = (c: Client, body: Record<string, unknown>) => c.post('/processes').send(body);

  it('POST /processes creates top-level and sub-processes', async () => {
    const top = (
      await create(modeler, {
        code: 'C.01',
        nameEn: 'Sales',
        nameAr: 'المبيعات',
        category: 'CORE',
      }).expect(201)
    ).body;
    expect(top).toMatchObject({ level: 1, sortOrder: 0, status: 'DRAFT', category: 'CORE' });
    const sub = (
      await create(modeler, { code: 'C.01.01', nameAr: 'عروض الأسعار', parentId: top.id }).expect(
        201,
      )
    ).body;
    expect(sub).toMatchObject({ level: 2, category: 'CORE', parentId: top.id });
    const second = (await create(modeler, { code: 'C.02', nameEn: 'Service', category: 'CORE' }))
      .body;
    expect(second.sortOrder).toBe(1);
  });

  it('validates codes, names, category and references', async () => {
    await create(modeler, { code: 'C.01', nameEn: 'A', category: 'CORE' }).expect(201);
    expect((await create(modeler, { code: 'c.01', nameEn: 'B', category: 'CORE' })).body.code).toBe(
      'CODE_TAKEN',
    );
    expect((await create(modeler, { code: 'X', category: 'CORE' })).body.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await create(modeler, { code: 'X', nameEn: 'X' })).body.code).toBe('VALIDATION_ERROR');
    expect(
      (
        await create(modeler, {
          code: 'X',
          nameEn: 'X',
          category: 'CORE',
          ownerId: '00000000-0000-4000-8000-000000000000',
        })
      ).body.code,
    ).toBe('OWNER_NOT_FOUND');
  });

  it('GET /processes, /tree and /:id return data with permissions and breadcrumbs', async () => {
    const top = (
      await create(modeler, {
        code: 'S.01',
        nameEn: 'Procure to Pay',
        category: 'SUPPORT',
        ownerId,
      })
    ).body;
    const sub = (
      await create(modeler, { code: 'S.01.01', nameEn: 'Requisition', parentId: top.id })
    ).body;
    const list = (await modeler.get('/processes?q=requis').expect(200)).body;
    expect(list.items.map((p: { code: string }) => p.code)).toEqual(['S.01.01']);
    const roots = (await modeler.get('/processes?parentId=root').expect(200)).body;
    expect(roots.total).toBe(1);
    expect((await modeler.get('/processes/tree').expect(200)).body).toHaveLength(2);

    const detail = (await modeler.get(`/processes/${sub.id}`).expect(200)).body;
    expect(detail.ancestors).toEqual([
      { id: top.id, code: 'S.01', nameEn: 'Procure to Pay', nameAr: '' },
    ]);
    expect(detail).toMatchObject({
      canEdit: true,
      canEditModel: true,
      canDelete: false,
      hasModel: false,
    });
    const parent = (await modeler.get(`/processes/${top.id}`)).body;
    expect(parent.children).toHaveLength(1);
    expect(parent.owner.email).toBe('owner@test.local');
  });

  it('process owners may edit only their own processes', async () => {
    const mine = (
      await create(modeler, { code: 'M.01', nameEn: 'Mine', category: 'MANAGEMENT', ownerId })
    ).body;
    const other = (await create(modeler, { code: 'M.02', nameEn: 'Other', category: 'MANAGEMENT' }))
      .body;
    const owner = await loggedIn(ctx.app, 'owner@test.local');
    expect((await owner.get(`/processes/${mine.id}`)).body.canEdit).toBe(true);
    expect((await owner.get(`/processes/${other.id}`)).body.canEdit).toBe(false);
    await owner.patch(`/processes/${mine.id}`).send({ descriptionEn: 'Updated' }).expect(200);
    await owner.patch(`/processes/${other.id}`).send({ descriptionEn: 'Nope' }).expect(403);
    // Owners cannot hand the process to someone else or create new ones
    await owner.patch(`/processes/${mine.id}`).send({ ownerId: null }).expect(403);
    await create(owner, { code: 'M.03', nameEn: 'New', category: 'MANAGEMENT' }).expect(403);
  });

  it('PATCH /processes/:id cascades a category change to descendants', async () => {
    const top = (await create(modeler, { code: 'C.01', nameEn: 'Top', category: 'CORE' })).body;
    const sub = (await create(modeler, { code: 'C.01.01', nameEn: 'Sub', parentId: top.id })).body;
    await modeler.patch(`/processes/${top.id}`).send({ category: 'SUPPORT' }).expect(200);
    expect((await modeler.get(`/processes/${sub.id}`)).body.category).toBe('SUPPORT');
    expect((await modeler.patch(`/processes/${sub.id}`).send({ category: 'CORE' })).body.code).toBe(
      'CATEGORY_INHERITED',
    );
    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'UPDATE', entityId: top.id },
    });
    expect(log?.summary).toEqual({ changes: { category: { from: 'CORE', to: 'SUPPORT' } } });
  });

  it('POST /processes/:id/move re-orders and re-parents', async () => {
    const a = (await create(modeler, { code: 'C.01', nameEn: 'A', category: 'CORE' })).body;
    const b = (await create(modeler, { code: 'C.02', nameEn: 'B', category: 'CORE' })).body;
    const s = (await create(modeler, { code: 'S.01', nameEn: 'S', category: 'SUPPORT' })).body;
    let tree = (
      await modeler
        .post(`/processes/${b.id}/move`)
        .send({ parentId: null, index: 0, category: 'CORE' })
        .expect(200)
    ).body;
    const find = (id: string) => tree.find((p: { id: string }) => p.id === id);
    expect(find(b.id).sortOrder).toBe(0);
    expect(find(a.id).sortOrder).toBe(1);
    tree = (
      await modeler.post(`/processes/${a.id}/move`).send({ parentId: s.id, index: 0 }).expect(200)
    ).body;
    expect(find(a.id)).toMatchObject({ parentId: s.id, category: 'SUPPORT', level: 2 });
    expect(
      (await modeler.post(`/processes/${s.id}/move`).send({ parentId: a.id, index: 0 })).body.code,
    ).toBe('INVALID_PARENT');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'MOVE' } })).toBe(2);
  });

  it('DELETE /processes/:id soft-deletes leaf processes (admin only)', async () => {
    const top = (await create(modeler, { code: 'C.01', nameEn: 'Top', category: 'CORE' })).body;
    const sub = (await create(modeler, { code: 'C.01.01', nameEn: 'Sub', parentId: top.id })).body;
    await modeler.delete(`/processes/${sub.id}`).expect(403);
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    expect((await admin.delete(`/processes/${top.id}`)).body.code).toBe('PROCESS_HAS_CHILDREN');
    await admin.delete(`/processes/${sub.id}`).expect(204);
    await admin.get(`/processes/${sub.id}`).expect(404);
    expect(await ctx.prisma.process.count()).toBe(2);
    // The code can be reused after deletion
    await create(modeler, { code: 'C.01.01', nameEn: 'Again', parentId: top.id }).expect(201);
  });

  it('reviewers have read-only access; viewers see the portal only', async () => {
    await createUser(ctx.prisma, 'portal@test.local', ['VIEWER']);
    const portalOnly = await loggedIn(ctx.app, 'portal@test.local');
    await portalOnly.get('/processes/tree').expect(403);
    await portalOnly.get('/processes').expect(403);
    const p = (await create(modeler, { code: 'C.01', nameEn: 'Top', category: 'CORE' })).body;
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    const detail = (await viewer.get(`/processes/${p.id}`).expect(200)).body;
    expect(detail).toMatchObject({ canEdit: false, canEditModel: false, canDelete: false });
    await create(viewer, { code: 'C.09', nameEn: 'X', category: 'CORE' }).expect(403);
    await viewer.patch(`/processes/${p.id}`).send({ nameEn: 'X' }).expect(403);
    await viewer.post(`/processes/${p.id}/move`).send({ parentId: null, index: 0 }).expect(403);
  });
});
