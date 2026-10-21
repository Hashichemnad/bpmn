import { CSRF_HEADER } from '@processhub/shared';
import {
  Client,
  createApp,
  createUser,
  loggedIn,
  PASSWORD,
  resetDb,
  type TestContext,
} from './helpers';

/** Phase 6 security review: HTTP-level protections (headers, CSRF, cookies). */
describe('Security hardening (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@sec.local', ['SUPER_ADMIN']);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('CSRF', () => {
    it('rejects state-changing requests from a foreign Origin even with a matching token', async () => {
      const c = await new Client(ctx.app).init();
      const res = await c
        .post('/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ email: 'admin@sec.local', password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_INVALID');
      // A sibling sub-domain that could plant the CSRF cookie is foreign too.
      const sibling = await c
        .post('/auth/login')
        .set('Origin', 'http://evil.127.0.0.1.nip.io')
        .send({ email: 'admin@sec.local', password: PASSWORD });
      expect(sibling.status).toBe(403);
      const opaque = await c
        .post('/auth/login')
        .set('Origin', 'null')
        .send({ email: 'admin@sec.local', password: PASSWORD });
      expect(opaque.status).toBe(403);
    });

    it('accepts configured origins and the same host', async () => {
      const c = await new Client(ctx.app).init();
      await c
        .post('/auth/login')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'admin@sec.local', password: PASSWORD })
        .expect(200);
      const same = await new Client(ctx.app).init();
      await same
        .post('/auth/login')
        .set('Host', 'processhub.example:8080')
        .set('Origin', 'https://processhub.example:8080')
        .send({ email: 'admin@sec.local', password: PASSWORD })
        .expect(200);
    });

    it('rejects cross-site requests without an Origin header', async () => {
      const c = await new Client(ctx.app).init();
      const res = await c
        .post('/auth/login')
        .set('Sec-Fetch-Site', 'cross-site')
        .send({ email: 'admin@sec.local', password: PASSWORD });
      expect(res.status).toBe(403);
    });

    it('rejects a token that does not match the cookie', async () => {
      const admin = await loggedIn(ctx.app, 'admin@sec.local');
      const res = await admin.agent
        .patch('/api/v1/auth/me')
        .set(CSRF_HEADER, 'x'.repeat(43))
        .send({ locale: 'ar' });
      expect(res.status).toBe(403);
    });
  });

  describe('headers and cookies', () => {
    it('API responses carry strict security headers', async () => {
      const res = await new Client(ctx.app).get('/health').expect(200);
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('session cookies are httpOnly, SameSite=Strict and path-scoped', async () => {
      const c = await new Client(ctx.app).init();
      const res = await c.login('admin@sec.local');
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const access = cookies.find((x) => x.startsWith('ph_access='))!;
      const refresh = cookies.find((x) => x.startsWith('ph_refresh='))!;
      for (const cookie of [access, refresh]) {
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Strict/i);
      }
      expect(access).toMatch(/Path=\/api(;|$)/);
      expect(refresh).toMatch(/Path=\/api\/v1\/auth(;|$)/);
    });

    it('errors never expose stack traces or internals', async () => {
      const admin = await loggedIn(ctx.app, 'admin@sec.local');
      const res = await admin.get('/processes/not-a-uuid').expect(400);
      expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'statusCode']);
      const unknown = await admin.get('/no-such-route').expect(404);
      expect(JSON.stringify(unknown.body)).not.toMatch(/at .*\.js|node_modules/);
    });
  });
});
