import './fixtures/sso-env';
import { SETTING_KEYS, type AuthSettingsInput } from '@processhub/shared';
import {
  Client,
  PASSWORD,
  createApp,
  createUser,
  loggedIn,
  resetDb,
  type TestContext,
} from './helpers';
import { MockIdp } from './fixtures/mock-idp';

const APP_URL = 'http://localhost:8080';

describe('Single sign-on with OpenID Connect (e2e, mocked identity provider)', () => {
  let ctx: TestContext;
  let idp: MockIdp;
  let admin: Client;

  beforeAll(async () => {
    idp = await new MockIdp().start();
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    await idp.stop();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@example.com', ['SUPER_ADMIN']);
    admin = await loggedIn(ctx.app, 'admin@example.com');
    idp.claims = {};
    idp.tamper = null;
  });

  const settings = (over: Partial<AuthSettingsInput> = {}): AuthSettingsInput => ({
    ssoEnabled: true,
    provider: 'OIDC',
    tenantId: '',
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret,
    buttonLabelEn: 'Company account',
    buttonLabelAr: 'حساب الشركة',
    allowedDomains: ['example.com'],
    autoCreateUsers: true,
    defaultRole: 'VIEWER',
    defaultDepartmentId: null,
    groupsClaim: 'groups',
    groupMappings: [],
    syncRolesOnLogin: false,
    localLoginEnabled: true,
    breakGlassUserId: null,
    mfaRequiredRoles: [],
    ...over,
  });

  const configure = async (over: Partial<AuthSettingsInput> = {}) =>
    admin.put('/settings/auth').send(settings(over)).expect(200);

  /** Browser round trip: start → provider → callback. Returns the client and final redirect. */
  async function signIn(
    claims: Record<string, unknown> = {},
    opts: { returnTo?: string; client?: Client; deny?: boolean } = {},
  ) {
    const c = opts.client ?? (await new Client(ctx.app).init());
    const qs = opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : '';
    const start = await c.get(`/auth/sso/start${qs}`).expect(302);
    const authUrl: string = start.headers.location;
    const back = opts.deny ? idp.deny(authUrl) : idp.authorize(authUrl, claims);
    expect(back.origin + back.pathname).toBe(`${APP_URL}/api/v1/auth/sso/callback`);
    const res = await c.agent.get(`${back.pathname}${back.search}`).expect(302);
    c.syncCsrf(res);
    return { c, start, res, location: res.headers.location as string };
  }

  const lastAudit = (action: string) =>
    ctx.prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });

  describe('Settings → Authentication', () => {
    it('is Super Admin only; the client secret is write-only and encrypted', async () => {
      await createUser(ctx.prisma, 'useradmin@example.com', ['ADMIN']);
      const other = await loggedIn(ctx.app, 'useradmin@example.com');
      await other.get('/settings/auth').expect(403);
      await other.put('/settings/auth').send(settings()).expect(403);

      const defaults = (await admin.get('/settings/auth').expect(200)).body;
      expect(defaults).toMatchObject({
        ssoEnabled: false,
        hasClientSecret: false,
        localLoginEnabled: true,
        redirectUri: `${APP_URL}/api/v1/auth/sso/callback`,
      });
      const res = await configure();
      expect(res.body.hasClientSecret).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(idp.clientSecret);
      const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: SETTING_KEYS.AUTH } });
      expect(JSON.stringify(row.value)).not.toContain(idp.clientSecret);
      expect((row.value as { clientSecretSealed: string }).clientSecretSealed).toMatch(/^v1\./);
      const audit = await lastAudit('UPDATE');
      expect(JSON.stringify(audit?.summary)).not.toContain(idp.clientSecret);
      expect(audit?.summary).toMatchObject({ credentialChanged: true });

      // Saving again without a secret keeps the stored one.
      const again = await admin
        .put('/settings/auth')
        .send({ ...settings(), clientSecret: '' })
        .expect(200);
      expect(again.body.hasClientSecret).toBe(true);
    });

    it('validates the configuration', async () => {
      const noSecret = await admin
        .put('/settings/auth')
        .send(settings({ clientSecret: undefined }))
        .expect(400);
      expect(noSecret.body.code).toBe('SSO_SECRET_REQUIRED');
      await admin
        .put('/settings/auth')
        .send(settings({ allowedDomains: [] }))
        .expect(400);
      await admin
        .put('/settings/auth')
        .send(settings({ provider: 'ENTRA', tenantId: 'contoso.onmicrosoft.com' }))
        .expect(400);
      const dep = await admin
        .put('/settings/auth')
        .send(settings({ defaultDepartmentId: '00000000-0000-4000-8000-000000000000' }))
        .expect(400);
      expect(dep.body.code).toBe('DEPARTMENT_NOT_FOUND');
    });

    it('publishes the sign-in options for the login page', async () => {
      const c = new Client(ctx.app);
      expect((await c.get('/auth/options').expect(200)).body).toEqual({
        ssoEnabled: false,
        ssoButtonLabelEn: '',
        ssoButtonLabelAr: '',
        localLoginEnabled: true,
      });
      await configure();
      expect((await c.get('/auth/options')).body).toMatchObject({
        ssoEnabled: true,
        ssoButtonLabelAr: 'حساب الشركة',
      });
    });

    it('tests the connection; internal addresses are blocked unless allowed', async () => {
      const ok = await admin.post('/settings/auth/test').send(settings()).expect(200);
      expect(ok.body).toMatchObject({ ok: true, issuer: idp.issuer });
      const blocked = await admin
        .post('/settings/auth/test')
        .send(settings({ issuer: 'http://10.1.2.3/realms/x' }))
        .expect(200);
      expect(blocked.body).toMatchObject({ ok: false, errorCode: 'SSO_HOST_BLOCKED' });
      expect(JSON.stringify(blocked.body)).not.toContain(idp.clientSecret);
    });
  });

  describe('sign-in', () => {
    it('redirects to the provider with PKCE, state and nonce in a Lax, http-only cookie', async () => {
      await configure();
      const c = await new Client(ctx.app).init();
      const res = await c.get('/auth/sso/start').expect(302);
      const url = new URL(res.headers.location);
      expect(url.origin).toBe(idp.issuer);
      expect(url.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/v1/auth/sso/callback`);
      expect(url.searchParams.get('scope')).toBe('openid profile email');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
      const cookie = ([] as string[]).concat(res.headers['set-cookie'])[0];
      expect(cookie).toMatch(/^ph_sso=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth\/sso/);
      // The cookie is encrypted: it does not reveal the state or verifier.
      expect(decodeURIComponent(cookie)).not.toContain(url.searchParams.get('state')!);
    });

    it('creates the user just in time with the default role and signs them in', async () => {
      await configure();
      const { c, location, res } = await signIn({}, { returnTo: '/processes?tab=1' });
      expect(location).toBe(`${APP_URL}/processes?tab=1`);
      const cookies = ([] as string[]).concat(res.headers['set-cookie']);
      expect(cookies.find((v) => v.startsWith('ph_access='))).toMatch(/SameSite=Strict/i);
      expect(cookies.some((v) => /^ph_sso=;/.test(v))).toBe(true);

      const me = (await c.get('/auth/me').expect(200)).body;
      expect(me).toMatchObject({
        email: 'new.user@example.com',
        nameEn: 'New User',
        roles: ['VIEWER'],
        hasPassword: false,
        ssoLinked: true,
      });
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: me.email } });
      expect(user).toMatchObject({
        ssoIssuer: idp.issuer,
        ssoSubject: 'subject-1',
        passwordHash: '',
      });
      expect((await lastAudit('CREATE'))?.summary).toMatchObject({
        source: 'SSO',
        roles: ['VIEWER'],
      });
      expect((await lastAudit('LOGIN'))?.summary).toMatchObject({
        method: 'SSO',
        issuer: idp.issuer,
      });
      // The token request used the secret and the PKCE verifier.
      const form = idp.tokenRequests.at(-1)!;
      expect(form.get('code_verifier')).toBeTruthy();
      // An SSO-only account cannot sign in with a password.
      expect((await new Client(ctx.app).login(me.email, PASSWORD)).status).toBe(401);
      // Unsafe return targets fall back to the start page.
      const evil = await signIn({}, { returnTo: 'https://evil.example/x' });
      expect(evil.location).toBe(`${APP_URL}/`);
    });

    it('maps directory groups to roles and a department; syncs them on later sign-ins', async () => {
      const dep = await ctx.prisma.department.create({
        data: { nameEn: 'Finance', nameAr: 'المالية' },
      });
      await configure({
        groupMappings: [
          { group: 'grp-editors', roles: ['MODELER'], departmentId: null },
          { group: 'grp-finance', roles: ['REVIEWER'], departmentId: dep.id },
        ],
        syncRolesOnLogin: true,
      });
      const first = await signIn({ groups: ['grp-editors', 'grp-finance', 'unrelated'] });
      const me = (await first.c.get('/auth/me')).body;
      expect([...me.roles].sort()).toEqual(['MODELER', 'REVIEWER']);
      expect(me.departmentId).toBe(dep.id);

      // Removed from both groups: back to the default role (department kept).
      const second = await signIn({ groups: [] });
      expect((await second.c.get('/auth/me')).body).toMatchObject({
        roles: ['VIEWER'],
        departmentId: dep.id,
      });
      expect((await lastAudit('UPDATE'))?.summary).toMatchObject({
        source: 'SSO_GROUPS',
        after: { roles: ['VIEWER'] },
      });

      // Entra ID group overage (too many groups in the token): roles are left unchanged.
      await signIn({ groups: ['grp-editors'] });
      const overage = await signIn({ _claim_names: { groups: 'src1' } });
      expect((await overage.c.get('/auth/me')).body.roles).toEqual(['MODELER']);
      expect((await lastAudit('LOGIN'))?.summary).toMatchObject({ groupsOverage: true });
    });

    it('without sync, mappings apply only when the user is created', async () => {
      await configure({
        groupMappings: [{ group: 'grp-editors', roles: ['MODELER'], departmentId: null }],
        syncRolesOnLogin: false,
      });
      await signIn({ groups: ['grp-editors'] });
      const again = await signIn({ groups: [] });
      expect((await again.c.get('/auth/me')).body.roles).toEqual(['MODELER']);
    });

    it('sync never removes Super Admin from the last Super Admin', async () => {
      await configure({
        groupMappings: [{ group: 'grp-editors', roles: ['MODELER'], departmentId: null }],
        syncRolesOnLogin: true,
      });
      const { c } = await signIn({ sub: 'admin-subject', email: 'admin@example.com', groups: [] });
      expect((await c.get('/auth/me')).body.roles.sort()).toEqual(['SUPER_ADMIN', 'VIEWER']);
    });

    it('links an existing local account by e-mail once, then by subject', async () => {
      await configure();
      const local = await createUser(ctx.prisma, 'sara@example.com', ['PROCESS_OWNER']);
      const { c } = await signIn({ sub: 'sara-sub', email: 'Sara@Example.com' });
      expect((await c.get('/auth/me')).body).toMatchObject({
        id: local.id,
        roles: ['PROCESS_OWNER'],
        hasPassword: true,
        ssoLinked: true,
      });
      expect((await lastAudit('UPDATE'))?.summary).toMatchObject({
        source: 'SSO',
        ssoLinked: true,
      });
      // A changed e-mail at the provider still finds the same account (by subject).
      const moved = await signIn({ sub: 'sara-sub', email: 'sara.k@example.com' });
      expect((await moved.c.get('/auth/me')).body.id).toBe(local.id);
      // Another identity claiming the same address is refused.
      const other = await signIn({ sub: 'someone-else', email: 'sara@example.com' });
      expect(other.location).toBe(`${APP_URL}/login?ssoError=SSO_ACCOUNT_CONFLICT`);
    });

    it.each([
      [{ email: 'x@other.com' }, {}, 'SSO_DOMAIN_NOT_ALLOWED'],
      [{ email: 'x@sub.example.com' }, {}, 'SSO_DOMAIN_NOT_ALLOWED'],
      [{ email: undefined, preferred_username: 'x@example.com' }, {}, 'SSO_EMAIL_MISSING'],
      [{ email_verified: false }, {}, 'SSO_EMAIL_MISSING'],
      [{}, { autoCreateUsers: false }, 'SSO_USER_NOT_FOUND'],
    ])('refuses %j with settings %j: %s', async (claims, over, code) => {
      await configure(over);
      const { c, location } = await signIn(claims);
      expect(location).toBe(`${APP_URL}/login?ssoError=${code}`);
      await c.get('/auth/me').expect(401);
      expect(await ctx.prisma.user.count()).toBe(1);
      expect((await lastAudit('LOGIN_FAILED'))?.summary).toMatchObject({
        method: 'SSO',
        reason: code,
      });
    });

    it('refuses inactive accounts', async () => {
      await configure();
      await createUser(ctx.prisma, 'gone@example.com', ['VIEWER'], { status: 'INACTIVE' });
      const { location } = await signIn({ email: 'gone@example.com' });
      expect(location).toBe(`${APP_URL}/login?ssoError=SSO_USER_INACTIVE`);
    });

    it.each(['audience', 'issuer', 'nonce', 'expired', 'foreign-key'] as const)(
      'rejects an ID token with a wrong %s',
      async (tamper) => {
        await configure();
        idp.tamper = tamper;
        const { c, location } = await signIn();
        expect(location).toBe(`${APP_URL}/login?ssoError=SSO_PROVIDER_ERROR`);
        await c.get('/auth/me').expect(401);
        expect(await ctx.prisma.user.count()).toBe(1);
      },
    );

    it('rejects a callback without the flow cookie or with another state (CSRF / replay)', async () => {
      await configure();
      const c = await new Client(ctx.app).init();
      const start = await c.get('/auth/sso/start').expect(302);
      const back = idp.authorize(start.headers.location);
      // Another browser (no flow cookie) receives the code: refused.
      const stranger = await new Client(ctx.app).init();
      const r1 = await stranger.agent.get(back.pathname + back.search).expect(302);
      expect(r1.headers.location).toBe(`${APP_URL}/login?ssoError=SSO_STATE_INVALID`);
      // Same browser, state changed: refused.
      const forged = new URL(back);
      forged.searchParams.set('state', 'forged');
      const r2 = await c.agent.get(forged.pathname + forged.search).expect(302);
      expect(r2.headers.location).toBe(`${APP_URL}/login?ssoError=SSO_STATE_INVALID`);
    });

    it('reports a cancelled sign-in and a disabled configuration', async () => {
      await configure();
      expect((await signIn({}, { deny: true })).location).toBe(
        `${APP_URL}/login?ssoError=SSO_CANCELLED`,
      );
      await configure({ ssoEnabled: false });
      const c = await new Client(ctx.app).init();
      const res = await c.get('/auth/sso/start').expect(302);
      expect(res.headers.location).toBe(`${APP_URL}/login?ssoError=SSO_DISABLED`);
    });

    it('a wrong client secret fails at the token endpoint without leaking the secret', async () => {
      await configure({ clientSecret: 'not-the-right-secret' });
      const { location } = await signIn();
      expect(location).toBe(`${APP_URL}/login?ssoError=SSO_PROVIDER_ERROR`);
      const audit = await lastAudit('LOGIN_FAILED');
      expect(JSON.stringify(audit?.summary)).not.toContain('not-the-right-secret');
      expect(JSON.stringify(audit?.summary)).toContain('invalid_client');
    });
  });

  describe('password sign-in turned off', () => {
    it('needs SSO and a valid break-glass Super Admin', async () => {
      const r1 = await admin
        .put('/settings/auth')
        .send(settings({ localLoginEnabled: false }))
        .expect(400);
      expect(r1.body.details ?? r1.body.code).toBeTruthy();
      const viewer = await createUser(ctx.prisma, 'viewer@example.com', ['VIEWER']);
      const r2 = await admin
        .put('/settings/auth')
        .send(settings({ localLoginEnabled: false, breakGlassUserId: viewer.id }))
        .expect(400);
      expect(r2.body.code).toBe('BREAK_GLASS_INVALID');
      const sa = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
      const r3 = await admin
        .put('/settings/auth')
        .send(settings({ ssoEnabled: false, localLoginEnabled: false, breakGlassUserId: sa.id }))
        .expect(400);
      expect(r3.body.code).toBe('SSO_REQUIRED_FOR_LOCAL_OFF');
    });

    it('only the break-glass account can use a password; others are told to use SSO', async () => {
      await createUser(ctx.prisma, 'local@example.com', ['MODELER']);
      const sa = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
      await configure({ localLoginEnabled: false, breakGlassUserId: sa.id });
      expect((await new Client(ctx.app).get('/auth/options')).body.localLoginEnabled).toBe(false);

      const c = await new Client(ctx.app).init();
      const wrong = await c.login('local@example.com', 'Wrong-Password1');
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      const refused = await c.login('local@example.com');
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('LOCAL_LOGIN_DISABLED');
      expect((await lastAudit('LOGIN_FAILED'))?.summary).toMatchObject({
        reason: 'LOCAL_LOGIN_DISABLED',
      });
      const breakGlass = await new Client(ctx.app).init();
      expect((await breakGlass.login('admin@example.com')).status).toBe(200);
      // SSO still works for everyone.
      const { c: ssoClient } = await signIn({ email: 'local@example.com', sub: 'local-sub' });
      await ssoClient.get('/auth/me').expect(200);
    });
  });
});
