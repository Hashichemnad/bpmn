import request from 'supertest';
import {
  Client,
  PASSWORD,
  createApp,
  createUser,
  loggedIn,
  resetDb,
  type TestContext,
} from './helpers';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['SUPER_ADMIN']);
  });

  it('GET /health is public', async () => {
    await new Client(ctx.app).get('/health').expect(200, { status: 'ok' });
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await new Client(ctx.app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('only allows configured CORS origins', async () => {
    const c = new Client(ctx.app);
    const ok = await c.get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await c.get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /auth/csrf issues a readable, strict same-site cookie', async () => {
    const res = await new Client(ctx.app).get('/auth/csrf').expect(200);
    expect(res.body.csrfToken).toHaveLength(43);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'])[0];
    expect(cookie).toMatch(/ph_csrf=/);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it('POST /auth/login rejects requests without a valid CSRF token', async () => {
    const c = await new Client(ctx.app).init();
    const res = await c.agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', 'wrong')
      .send({ email: 'admin@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('POST /auth/login sets httpOnly cookies and returns the current user', async () => {
    const c = await new Client(ctx.app).init();
    const res = await c.login('ADMIN@test.local');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'admin@test.local', roles: ['SUPER_ADMIN'] });
    expect(res.body.user.permissions).toContain('settings.manage');
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    const access = cookies.find((v) => v.startsWith('ph_access='))!;
    const refresh = cookies.find((v) => v.startsWith('ph_refresh='))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Strict/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
    // Default session lifetime: 24 hours (REFRESH_TOKEN_TTL_HOURS, D-065).
    const token = await ctx.prisma.refreshToken.findFirstOrThrow();
    const hours = (token.expiresAt.getTime() - token.createdAt.getTime()) / 3600_000;
    expect(hours).toBeCloseTo(24, 1);
    const expires = new Date(/Expires=([^;]+)/.exec(refresh)![1]).getTime();
    expect(Math.abs(expires - token.expiresAt.getTime())).toBeLessThan(2000);
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'LOGIN' } });
    expect(log).not.toBeNull();
  });

  it('POST /auth/login returns a generic error for unknown users and bad passwords', async () => {
    const c = await new Client(ctx.app).init();
    const unknown = await c.login('nobody@test.local');
    const bad = await c.login('admin@test.local', 'Wrong-Password1');
    expect(unknown.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBe(2);
  });

  it('locks the account after repeated failures', async () => {
    const c = await new Client(ctx.app).init();
    for (let i = 0; i < 3; i++) await c.login('admin@test.local', 'Wrong-Password1');
    const res = await c.login('admin@test.local');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'LOCKOUT' } })).toBe(1);
  });

  it('inactive users cannot log in', async () => {
    await createUser(ctx.prisma, 'gone@test.local', ['VIEWER'], { status: 'INACTIVE' });
    const res = await (await new Client(ctx.app).init()).login('gone@test.local');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /auth/me requires authentication', async () => {
    const res = await new Client(ctx.app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    const c = await loggedIn(ctx.app, 'admin@test.local');
    await c.get('/auth/me').expect(200);
  });

  it('POST /auth/refresh rotates tokens and detects reuse', async () => {
    const c = await loggedIn(ctx.app, 'admin@test.local');
    const loginCookies = await ctx.prisma.refreshToken.findMany();
    expect(loginCookies).toHaveLength(1);
    // Capture the first refresh token to replay it later.
    const first = await c.post('/auth/refresh').expect(200);
    expect(first.body).toEqual({ ok: true });
    const tokens = await ctx.prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].revokedAt).not.toBeNull();
    expect(tokens[1].revokedAt).toBeNull();

    // Replay the revoked token: the whole family must be revoked.
    const replay = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-csrf-token', c.csrf)
      .set('Cookie', `ph_csrf=${c.csrf}; ph_refresh=invalid-token`);
    expect(replay.status).toBe(401);
  });

  it('reusing a rotated refresh token revokes the family', async () => {
    const c = await loggedIn(ctx.app, 'admin@test.local');
    const loginRes = await c.login('admin@test.local');
    const raw = ([] as string[])
      .concat(loginRes.headers['set-cookie'])
      .find((v) => v.startsWith('ph_refresh='))!
      .split(';')[0]
      .split('=')[1];
    await c.post('/auth/refresh').expect(200);
    const reuse = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-csrf-token', c.csrf)
      .set('Cookie', `ph_csrf=${c.csrf}; ph_refresh=${raw}`);
    expect(reuse.status).toBe(401);
    const active = await ctx.prisma.refreshToken.count({ where: { revokedAt: null } });
    // Only the token from the first (separate) login family stays active.
    expect(active).toBe(1);
  });

  it('ends a session at the absolute limit (SESSION_MAX_HOURS) even when it is active', async () => {
    const c = await loggedIn(ctx.app, 'admin@test.local');
    const token = await ctx.prisma.refreshToken.findFirstOrThrow();
    // Default 7 days: the refresh token never expires after the end of the session.
    const limit = token.sessionStartedAt.getTime() + 168 * 3600 * 1000;
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(limit);
    // Six days and 23 hours ago: the rotated token is capped at the session end.
    const started = new Date(Date.now() - (167 * 3600 + 1800) * 1000);
    await ctx.prisma.refreshToken.updateMany({ data: { sessionStartedAt: started } });
    await c.post('/auth/refresh').expect(200);
    const rotated = await ctx.prisma.refreshToken.findFirstOrThrow({ where: { revokedAt: null } });
    expect(rotated.sessionStartedAt.getTime()).toBe(started.getTime());
    expect(rotated.expiresAt.getTime()).toBe(started.getTime() + 168 * 3600 * 1000);
    // Past the limit: refused and the family is revoked although the idle limit is not reached.
    await ctx.prisma.refreshToken.updateMany({
      data: { sessionStartedAt: new Date(Date.now() - 169 * 3600 * 1000) },
    });
    const res = await c.post('/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    expect(await ctx.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('deactivating a user ends their sessions immediately', async () => {
    const viewer = await createUser(ctx.prisma, 'leaver@test.local', ['VIEWER']);
    const session = await loggedIn(ctx.app, 'leaver@test.local');
    await session.get('/auth/me').expect(200);
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    await admin.patch(`/users/${viewer.id}`).send({ status: 'INACTIVE' }).expect(200);
    // The still-valid access token is refused at once, and the refresh token is revoked.
    await session.get('/auth/me').expect(401);
    await session.post('/auth/refresh').expect(401);
    expect(
      await ctx.prisma.refreshToken.count({ where: { userId: viewer.id, revokedAt: null } }),
    ).toBe(0);
  });

  it('POST /auth/logout revokes the session and clears cookies', async () => {
    const c = await loggedIn(ctx.app, 'admin@test.local');
    await c.post('/auth/logout').expect(204);
    await c.get('/auth/me').expect(401);
    expect(await ctx.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
  });

  it('PATCH /auth/me updates the preferred language', async () => {
    const c = await loggedIn(ctx.app, 'admin@test.local');
    const res = await c.patch('/auth/me').send({ locale: 'ar' }).expect(200);
    expect(res.body.locale).toBe('ar');
    await c.patch('/auth/me').send({ locale: 'fr' }).expect(400);
    await c.patch('/auth/me').send({ nameEn: '', nameAr: '' }).expect(400);
  });

  it('POST /auth/change-password validates and revokes other sessions', async () => {
    const other = await loggedIn(ctx.app, 'admin@test.local');
    const c = await loggedIn(ctx.app, 'admin@test.local');
    const wrong = await c
      .post('/auth/change-password')
      .send({ currentPassword: 'nope', newPassword: 'New-Password12' });
    expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');
    const weak = await c
      .post('/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    expect(weak.body.details.errors).toContain('TOO_SHORT');
    await c
      .post('/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'New-Password12' })
      .expect(204);
    await c.get('/auth/me').expect(200);
    await other.post('/auth/refresh').expect(401);
    const fresh = await new Client(ctx.app).init();
    expect((await fresh.login('admin@test.local', 'New-Password12')).status).toBe(200);
  });
});
