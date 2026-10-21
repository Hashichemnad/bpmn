import { createApp, createUser, loggedIn, resetDb, type TestContext } from './helpers';

describe('Audit log (e2e)', () => {
  let ctx: TestContext;

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
  });

  it('GET /audit-logs lists newest first with filters', async () => {
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    await admin.post('/departments').send({ nameEn: 'Finance' }).expect(201);
    const all = (await admin.get('/audit-logs').expect(200)).body;
    expect(all.items[0]).toMatchObject({ action: 'CREATE', entityType: 'Department' });
    expect(all.items[0].user.email).toBe('admin@test.local');
    expect(all.items[1].action).toBe('LOGIN');

    const logins = (await admin.get('/audit-logs?action=LOGIN').expect(200)).body;
    expect(logins.total).toBe(1);
    const byEntity = (await admin.get('/audit-logs?entityType=Department').expect(200)).body;
    expect(byEntity.total).toBe(1);
    const future = (
      await admin.get(`/audit-logs?from=${new Date(Date.now() + 3600_000).toISOString()}`)
    ).body;
    expect(future.total).toBe(0);
    await admin.get('/audit-logs?action=HACK').expect(400);
  });

  it('is restricted to holders of audit.read', async () => {
    const modeler = await loggedIn(ctx.app, 'modeler@test.local');
    await modeler.get('/audit-logs').expect(403);
  });
});
