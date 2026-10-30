import {
  PASSWORD,
  createApp,
  createUser,
  loggedIn,
  resetDb,
  Client,
  type TestContext,
} from './helpers';

describe('Users & roles (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'root@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    superAdmin = await loggedIn(ctx.app, 'root@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
  });

  it('GET /users lists, searches and paginates', async () => {
    const res = await admin.get('/users?pageSize=2&sort=email').expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].email).toBe('admin@test.local');
    const search = await admin.get('/users?q=view').expect(200);
    expect(search.body.items.map((u: { email: string }) => u.email)).toEqual(['viewer@test.local']);
    const byRole = await admin.get('/users?role=SUPER_ADMIN').expect(200);
    expect(byRole.body.total).toBe(1);
  });

  it('GET /users is forbidden for viewers', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    const res = await viewer.get('/users');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('GET /users/:id validates ids', async () => {
    await admin.get('/users/not-a-uuid').expect(400);
    await admin.get('/users/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('POST /users creates a user with roles and writes an audit entry', async () => {
    const res = await admin
      .post('/users')
      .send({
        email: 'New@Test.local',
        nameEn: 'New',
        nameAr: 'جديد',
        password: 'Valid-Password1',
        roles: ['MODELER'],
        locale: 'ar',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      email: 'new@test.local',
      roles: ['MODELER'],
      locale: 'ar',
      status: 'ACTIVE',
    });
    expect(res.body.passwordHash).toBeUndefined();
    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'CREATE', entityType: 'User', entityId: res.body.id },
    });
    expect(JSON.stringify(log?.summary)).not.toMatch(/password/i);
    const c = await new Client(ctx.app).init();
    expect((await c.login('new@test.local', 'Valid-Password1')).status).toBe(200);
  });

  it('POST /users rejects weak passwords, duplicates and invalid input', async () => {
    const base = { email: 'x@test.local', nameEn: 'X', roles: ['VIEWER'] };
    expect((await admin.post('/users').send({ ...base, password: 'weak' })).body.code).toBe(
      'WEAK_PASSWORD',
    );
    expect(
      (
        await admin
          .post('/users')
          .send({ ...base, email: 'viewer@test.local', password: 'Valid-Password1' })
      ).body.code,
    ).toBe('EMAIL_TAKEN');
    expect(
      (await admin.post('/users').send({ ...base, roles: ['GOD'], password: 'Valid-Password1' }))
        .body.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('only a Super Admin can grant Super Admin', async () => {
    const body = {
      email: 'sa@test.local',
      nameEn: 'SA',
      password: 'Valid-Password1',
      roles: ['SUPER_ADMIN'],
    };
    await admin.post('/users').send(body).expect(403);
    await superAdmin.post('/users').send(body).expect(201);
  });

  it('PATCH /users/:id updates roles and deactivation revokes access', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    const target = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'viewer@test.local' },
    });
    const res = await admin
      .patch(`/users/${target.id}`)
      .send({ roles: ['REVIEWER', 'VIEWER'] })
      .expect(200);
    expect(res.body.roles.sort()).toEqual(['REVIEWER', 'VIEWER']);
    await admin.patch(`/users/${target.id}`).send({ status: 'INACTIVE' }).expect(200);
    await viewer.get('/auth/me').expect(401);
    const c = await new Client(ctx.app).init();
    expect((await c.login('viewer@test.local')).status).toBe(401);
  });

  it('users cannot deactivate themselves and the last Super Admin is protected', async () => {
    const root = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'root@test.local' } });
    const self = await superAdmin.patch(`/users/${root.id}`).send({ status: 'INACTIVE' });
    expect(self.body.code).toBe('CANNOT_CHANGE_OWN_ACCESS');
    await admin.patch(`/users/${root.id}`).send({ nameEn: 'Hacked' }).expect(403);
  });

  it('POST /users/:id/reset-password and /unlock', async () => {
    const target = await ctx.prisma.user.update({
      where: { email: 'viewer@test.local' },
      data: { lockedUntil: new Date(Date.now() + 600_000) },
    });
    const locked = await admin.get(`/users/${target.id}`).expect(200);
    expect(locked.body.lockedUntil).not.toBeNull();
    const unlocked = await admin.post(`/users/${target.id}/unlock`).expect(200);
    expect(unlocked.body.lockedUntil).toBeNull();
    await admin
      .post(`/users/${target.id}/reset-password`)
      .send({ newPassword: 'weak' })
      .expect(400);
    await admin
      .post(`/users/${target.id}/reset-password`)
      .send({ newPassword: 'Reset-Password1' })
      .expect(204);
    const c = await new Client(ctx.app).init();
    expect((await c.login('viewer@test.local', PASSWORD)).status).toBe(401);
    expect((await c.login('viewer@test.local', 'Reset-Password1')).status).toBe(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PASSWORD_RESET' } })).toBe(1);
  });

  it('GET /roles lists the eight system roles with permissions', async () => {
    const res = await admin.get('/roles').expect(200);
    expect(res.body.map((r: { key: string }) => r.key)).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'PROCESS_OWNER',
      'MODELER',
      'REVIEWER',
      'AUDITOR',
      'RISK_OFFICER',
      'VIEWER',
    ]);
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.get('/roles').expect(403);
  });
});
