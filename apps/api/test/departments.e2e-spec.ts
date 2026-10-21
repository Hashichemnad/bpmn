import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

describe('Departments (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
  });

  it('creates, lists, updates and deletes a hierarchy', async () => {
    const fin = (await admin.post('/departments').send({ nameEn: 'Finance', nameAr: 'المالية', code: 'FIN' }).expect(201)).body;
    const proc = (await admin.post('/departments').send({ nameAr: 'المشتريات', parentId: fin.id }).expect(201)).body;
    expect(proc).toMatchObject({ parentId: fin.id, nameEn: '', nameAr: 'المشتريات' });

    const list = (await admin.get('/departments').expect(200)).body;
    expect(list).toHaveLength(2);

    const updated = (await admin.patch(`/departments/${proc.id}`).send({ nameEn: 'Procurement' }).expect(200)).body;
    expect(updated.nameEn).toBe('Procurement');

    // Parent with children cannot be deleted
    expect((await admin.delete(`/departments/${fin.id}`)).body.code).toBe('DEPARTMENT_IN_USE');
    await admin.delete(`/departments/${proc.id}`).expect(204);
    await admin.delete(`/departments/${fin.id}`).expect(204);
    expect((await admin.get('/departments')).body).toHaveLength(0);
    expect(await ctx.prisma.auditLog.count({ where: { entityType: 'Department' } })).toBe(5);
  });

  it('prevents cycles and requires a name', async () => {
    const a = (await admin.post('/departments').send({ nameEn: 'A' })).body;
    const b = (await admin.post('/departments').send({ nameEn: 'B', parentId: a.id })).body;
    expect((await admin.patch(`/departments/${a.id}`).send({ parentId: b.id })).body.code).toBe('INVALID_PARENT');
    expect((await admin.patch(`/departments/${a.id}`).send({ parentId: a.id })).body.code).toBe('INVALID_PARENT');
    expect((await admin.post('/departments').send({ code: 'X' })).body.code).toBe('VALIDATION_ERROR');
  });

  it('blocks deleting departments with users', async () => {
    const d = (await admin.post('/departments').send({ nameEn: 'HR' })).body;
    await ctx.prisma.user.update({ where: { email: 'viewer@test.local' }, data: { departmentId: d.id } });
    expect((await admin.delete(`/departments/${d.id}`)).status).toBe(409);
    expect((await admin.get('/departments')).body[0].userCount).toBe(1);
  });

  it('viewers can read but not change departments', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.get('/departments').expect(200);
    await viewer.post('/departments').send({ nameEn: 'X' }).expect(403);
  });
});
