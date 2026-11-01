import { Logger } from '@nestjs/common';
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

  describe('secrets', () => {
    const GIT_TOKEN = 'ghp_SecretGitToken1234567890';
    const SMTP_PASSWORD = 'Smtp-Secret-Password-42';
    const AI_KEY = 'sk-ant-secret-ai-key-0987654321';
    const SSO_SECRET = 'Sso-Client-Secret-Value-777';

    it('never appear in API responses, audit entries, stored settings or logs', async () => {
      const logged: string[] = [];
      const spies = (['log', 'warn', 'error'] as const).map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        }),
      );
      try {
        const admin = await loggedIn(ctx.app, 'admin@sec.local');
        // Every secret is stored, then used in a failing call whose error echoes it.
        ctx.git.validToken = GIT_TOKEN;
        await admin
          .put('/integrations/git')
          .send({
            enabled: true,
            provider: 'github',
            repository: 'acme/bpm',
            branch: 'main',
            token: GIT_TOKEN,
            syncProcesses: true,
            syncPages: true,
            trigger: 'MANUAL',
          })
          .expect(200);
        ctx.git.failNext = new (await import('../src/integrations/providers/types')).GitError(
          'GIT_AUTH_FAILED',
          `HTTP 401: Bad credentials (${GIT_TOKEN})`,
        );
        // Content to export, so the sync really commits (and fails).
        const space = await admin
          .post('/spaces')
          .send({ key: 'SECR', nameEn: 'S', nameAr: 'س' })
          .expect(201);
        await admin
          .post(`/spaces/${space.body.id}/pages`)
          .send({ titleEn: 'P', titleAr: 'ص' })
          .expect(201);
        await admin.post('/integrations/git/sync').send({}).expect(202);
        await new Promise((r) => setTimeout(r, 300));
        await admin
          .put('/settings/email')
          .send({
            enabled: true,
            host: 'smtp.example.com',
            port: 587,
            fromAddress: 'hub@sec.local',
            fromName: 'Hub',
            username: 'u',
            password: SMTP_PASSWORD,
          })
          .expect(200);
        ctx.mail.failNext = true; // the fake echoes the password in its error
        const test = await admin.post('/settings/email/test').send({ to: 'x@sec.local' });
        expect(test.body.ok).toBe(false);
        await admin
          .put('/ai/settings')
          .send({
            enabled: true,
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            fastModel: 'claude-haiku-5-5',
            allowedRoles: ['SUPER_ADMIN'],
            userDailyLimit: 0,
            orgMonthlyLimit: 0,
            noticeEn: 'n',
            noticeAr: 'ن',
            apiKey: AI_KEY,
          })
          .expect(200);
        const created = await admin
          .post('/users')
          .send({
            email: 'new@sec.local',
            nameEn: 'New',
            nameAr: 'جديد',
            password: 'Initial-Password1',
            roles: ['VIEWER'],
          })
          .expect(201);
        await admin
          .post(`/users/${created.body.id}/reset-password`)
          .send({ newPassword: 'Another-Password2' })
          .expect(204);

        const sso = {
          ssoEnabled: true,
          provider: 'ENTRA',
          tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
          issuer: '',
          clientId: 'client-id',
          clientSecret: SSO_SECRET,
          buttonLabelEn: '',
          buttonLabelAr: '',
          allowedDomains: ['sec.local'],
          autoCreateUsers: true,
          defaultRole: 'VIEWER',
          defaultDepartmentId: null,
          groupsClaim: 'groups',
          groupMappings: [],
          syncRolesOnLogin: false,
          requireIdpMfa: false,
          localLoginEnabled: true,
          breakGlassUserId: null,
          mfaRequiredRoles: [],
        };
        await admin.put('/settings/auth').send(sso).expect(200);
        // Points at an address that is blocked (SSRF policy): the failure must not echo the secret.
        const ssoTest = await admin
          .post('/settings/auth/test')
          .send({ ...sso, provider: 'OIDC', issuer: 'https://10.9.9.9/x', clientSecret: '' })
          .expect(200);
        expect(ssoTest.body.ok).toBe(false);
        // TOTP secret: shown once in the set-up response, never stored or returned in clear afterwards.
        const totp = await admin.post('/auth/mfa/setup').send({ password: PASSWORD }).expect(200);
        const TOTP_SECRET: string = totp.body.secret;
        await admin
          .post('/auth/mfa/enable')
          .send({ code: (await import('../src/auth/totp')).totpCode(TOTP_SECRET) })
          .expect(200);

        const responses = await Promise.all(
          [
            '/settings/auth',
            '/auth/mfa',
            '/integrations/git',
            '/integrations/git/status',
            '/settings',
            '/settings/email',
            '/ai/settings',
            '/users',
            `/users/${created.body.id}`,
            '/auth/me',
            '/audit-logs?pageSize=100',
          ].map(async (path) => `${path} ${JSON.stringify((await admin.get(path)).body)}`),
        );
        const audit = await ctx.prisma.auditLog.findMany();
        const settingsRows = await ctx.prisma.setting.findMany();
        const syncItems = await ctx.prisma.gitSyncItem.findMany();
        const users = await ctx.prisma.user.findMany();
        const forbidden = [
          GIT_TOKEN,
          SMTP_PASSWORD,
          AI_KEY,
          SSO_SECRET,
          TOTP_SECRET,
          'Initial-Password1',
          'Another-Password2',
          '$argon2',
        ];
        const haystacks = {
          responses: responses.join('\n'),
          audit: JSON.stringify(audit),
          settings: JSON.stringify(settingsRows),
          gitSyncItems: JSON.stringify(syncItems),
          users: JSON.stringify(users.map(({ passwordHash: _p, ...u }) => u)),
          ssoTest: JSON.stringify(ssoTest.body),
          logs: logged.join('\n'),
        };
        for (const [where, text] of Object.entries(haystacks)) {
          for (const secret of forbidden)
            expect([where, text.includes(secret)]).toEqual([where, false]);
        }
        // The failures were recorded (so the scrubbed messages were really checked).
        expect(haystacks.logs).toContain('***');
        expect(test.body.error).toContain('***');
      } finally {
        spies.forEach((s) => s.mockRestore());
        // Later tests sign in as this admin with a password only.
        await ctx.prisma.user.update({
          where: { email: 'admin@sec.local' },
          data: { totpEnabledAt: null, totpSecretSealed: null },
        });
      }
    });

    it('refresh tokens are stored hashed only', async () => {
      const c = await new Client(ctx.app).init();
      const res = await c.login('admin@sec.local');
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((x) => x.startsWith('ph_refresh='))!;
      const token = decodeURIComponent(cookie.split(';')[0].slice('ph_refresh='.length));
      const rows = await ctx.prisma.refreshToken.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain(token);
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
