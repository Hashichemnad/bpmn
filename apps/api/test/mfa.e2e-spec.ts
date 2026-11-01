import { SETTING_KEYS } from '@processhub/shared';
import {
  Client,
  PASSWORD,
  createApp,
  createUser,
  loggedIn,
  resetDb,
  withDefaultAuthSettings,
  type TestContext,
} from './helpers';
import { totpCode } from '../src/auth/totp';
import { AUTH_DEFAULTS } from '../src/auth/auth-settings.service';

describe('Two-factor authentication (e2e)', () => {
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
    await createUser(ctx.prisma, 'user@test.local', ['MODELER']);
  });

  /** A fresh code: forget the last used time step so the current code is accepted again. */
  const code = async (email: string, secret: string) => {
    await ctx.prisma.user.update({ where: { email }, data: { totpLastStep: null } });
    return totpCode(secret);
  };

  /** Enrols the user through the profile endpoints; returns the secret and recovery codes. */
  async function enrol(c: Client, email = 'user@test.local') {
    const setup = await c.post('/auth/mfa/setup').send({ password: PASSWORD }).expect(200);
    const secret: string = setup.body.secret;
    const enabled = await c
      .post('/auth/mfa/enable')
      .send({ code: totpCode(secret) })
      .expect(200);
    return { secret, recoveryCodes: enabled.body.recoveryCodes as string[], email };
  }

  async function auditActions(userId?: string) {
    const rows = await ctx.prisma.auditLog.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.action);
  }

  it('enrols with a QR code URI, stores the secret encrypted and returns 10 recovery codes', async () => {
    const c = await loggedIn(ctx.app, 'user@test.local');
    expect((await c.get('/auth/mfa').expect(200)).body).toMatchObject({
      enabled: false,
      required: false,
      available: true,
    });
    await c.post('/auth/mfa/setup').send({ password: 'wrong' }).expect(400);
    const setup = await c.post('/auth/mfa/setup').send({ password: PASSWORD }).expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/ProcessHub:user%40test\.local\?/);
    // Not enabled until a code from the app confirms it.
    expect((await c.get('/auth/mfa')).body.enabled).toBe(false);
    await c.post('/auth/mfa/enable').send({ code: '000000' }).expect(400);
    const res = await c
      .post('/auth/mfa/enable')
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);
    expect(res.body.recoveryCodes).toHaveLength(10);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'user@test.local' } });
    expect(user.totpSecretSealed).toMatch(/^v1\./);
    expect(user.totpSecretSealed).not.toContain(setup.body.secret);
    expect(user.totpPendingSealed).toBeNull();
    const hashes = await ctx.prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(hashes.map((h) => h.codeHash)).not.toContain(res.body.recoveryCodes[0]);
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect((await c.get('/auth/me')).body.mfaEnabled).toBe(true);
    expect(await auditActions(user.id)).toContain('MFA_ENABLE');
  });

  it('password sign-in then needs a code; no session before the second step', async () => {
    const { secret } = await enrol(await loggedIn(ctx.app, 'user@test.local'));
    const c = await new Client(ctx.app).init();
    const res = await c.login('user@test.local');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfa: 'VERIFY' });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((v) => v.startsWith('ph_access='))).toBe(false);
    const mfaCookie = cookies.find((v) => v.startsWith('ph_mfa='))!;
    expect(mfaCookie).toMatch(/HttpOnly/i);
    expect(mfaCookie).toMatch(/SameSite=Strict/i);
    await c.get('/auth/me').expect(401);
    // The challenge is not an access token.
    const challenge = mfaCookie.split(';')[0].split('=')[1];
    await c.agent.get('/api/v1/auth/me').set('Cookie', `ph_access=${challenge}`).expect(401);

    await c.post('/auth/login/mfa').send({ code: '12345' }).expect(400);
    const ok = await c
      .post('/auth/login/mfa')
      .send({ code: await code('user@test.local', secret) })
      .expect(200);
    expect(ok.body.user.email).toBe('user@test.local');
    c.syncCsrf(ok);
    await c.get('/auth/me').expect(200);
    const login = await ctx.prisma.auditLog.findFirst({
      where: { action: 'LOGIN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(login?.summary).toMatchObject({ method: 'PASSWORD', mfa: 'TOTP' });
  });

  it('refuses a replayed code, a missing challenge and counts wrong codes towards lockout', async () => {
    const { secret } = await enrol(await loggedIn(ctx.app, 'user@test.local'));
    const fresh = await code('user@test.local', secret);

    const first = await new Client(ctx.app).init();
    await first.login('user@test.local');
    await first.post('/auth/login/mfa').send({ code: fresh }).expect(200);

    const replay = await new Client(ctx.app).init();
    await replay.login('user@test.local');
    const r = await replay.post('/auth/login/mfa').send({ code: fresh }).expect(401);
    expect(r.body.code).toBe('MFA_CODE_INVALID');

    const noChallenge = await new Client(ctx.app).init();
    const n = await noChallenge.post('/auth/login/mfa').send({ code: fresh }).expect(401);
    expect(n.body.code).toBe('MFA_CHALLENGE_EXPIRED');

    // LOGIN_MAX_ATTEMPTS = 3 in tests: one failure above, two more lock the account.
    await replay.post('/auth/login/mfa').send({ code: '000000' }).expect(401);
    await replay.post('/auth/login/mfa').send({ code: '000001' }).expect(401);
    const locked = await replay
      .post('/auth/login/mfa')
      .send({ code: await code('user@test.local', secret) })
      .expect(401);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'user@test.local' } });
    expect(await auditActions(user.id)).toEqual(expect.arrayContaining(['LOCKOUT']));
    const reasons = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'LOGIN_FAILED', userId: user.id } })
    ).map((a) => (a.summary as { reason: string }).reason);
    expect(reasons).toEqual(expect.arrayContaining(['BAD_MFA_CODE', 'LOCKED']));
  });

  it('a correct password does not reset the failure counter while the code is pending', async () => {
    const { secret } = await enrol(await loggedIn(ctx.app, 'user@test.local'));
    for (let i = 0; i < 3; i++) {
      const c = await new Client(ctx.app).init();
      expect((await c.login('user@test.local')).body).toEqual({ mfa: 'VERIFY' });
      await c.post('/auth/login/mfa').send({ code: '000000' }).expect(401);
    }
    const c = await new Client(ctx.app).init();
    const res = await c.login('user@test.local');
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    expect(secret).toBeTruthy();
  });

  it('recovery codes work once each (case and dashes ignored)', async () => {
    const { recoveryCodes } = await enrol(await loggedIn(ctx.app, 'user@test.local'));
    const c = await new Client(ctx.app).init();
    await c.login('user@test.local');
    const typed = recoveryCodes[0].toLowerCase().replace(/-/g, ' ');
    const ok = await c.post('/auth/login/mfa').send({ recoveryCode: typed }).expect(200);
    c.syncCsrf(ok);
    expect((await c.get('/auth/mfa')).body.recoveryCodesLeft).toBe(9);

    const again = await new Client(ctx.app).init();
    await again.login('user@test.local');
    await again.post('/auth/login/mfa').send({ recoveryCode: recoveryCodes[0] }).expect(401);
    const login = await ctx.prisma.auditLog.findFirst({
      where: { action: 'LOGIN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(login?.summary).toMatchObject({ mfa: 'RECOVERY_CODE' });
  });

  it('new recovery codes and turning 2FA off need the password and a current code', async () => {
    const c = await loggedIn(ctx.app, 'user@test.local');
    const { secret, recoveryCodes } = await enrol(c);
    await c
      .post('/auth/mfa/recovery-codes')
      .send({ password: 'wrong', code: await code('user@test.local', secret) })
      .expect(400);
    const regen = await c
      .post('/auth/mfa/recovery-codes')
      .send({ password: PASSWORD, code: await code('user@test.local', secret) })
      .expect(200);
    expect(regen.body.recoveryCodes).toHaveLength(10);
    expect(regen.body.recoveryCodes).not.toContain(recoveryCodes[0]);

    await c.post('/auth/mfa/disable').send({ password: PASSWORD, code: '000000' }).expect(400);
    await c
      .post('/auth/mfa/disable')
      .send({ password: PASSWORD, code: await code('user@test.local', secret) })
      .expect(204);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'user@test.local' } });
    expect(user.totpSecretSealed).toBeNull();
    expect(await ctx.prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await auditActions(user.id)).toEqual(
      expect.arrayContaining(['MFA_RECOVERY_CODES', 'MFA_DISABLE']),
    );
    // Back to one-step sign-in.
    const again = await new Client(ctx.app).init();
    expect((await again.login('user@test.local')).body.user.email).toBe('user@test.local');
  });

  describe('shipped defaults (D-061)', () => {
    beforeEach(async () => {
      await withDefaultAuthSettings(ctx.prisma);
      await createUser(ctx.prisma, 'admin2@test.local', ['ADMIN']);
      await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER', 'REVIEWER']);
    });

    it('Super Admin and Admin must set up 2FA at their first password sign-in', async () => {
      for (const email of ['admin@test.local', 'admin2@test.local']) {
        const c = await new Client(ctx.app).init();
        expect((await c.login(email)).body).toEqual({ mfa: 'SETUP' });
        await c.get('/auth/me').expect(401);
      }
    });

    it('other roles sign in with a password only; 2FA stays optional', async () => {
      for (const email of ['user@test.local', 'owner@test.local']) {
        const c = await loggedIn(ctx.app, email);
        expect((await c.get('/auth/mfa').expect(200)).body).toMatchObject({
          enabled: false,
          required: false,
        });
      }
    });

    it('Settings → Authentication shows the defaults: admin roles need 2FA, roles not synced', async () => {
      const c = await new Client(ctx.app).init();
      await c.login('admin@test.local');
      const setup = await c.post('/auth/login/mfa/setup').expect(200);
      const done = await c
        .post('/auth/login/mfa/setup/confirm')
        .send({ code: totpCode(setup.body.secret) })
        .expect(200);
      c.syncCsrf(done);
      expect((await c.get('/settings/auth').expect(200)).body).toMatchObject({
        mfaRequiredRoles: ['SUPER_ADMIN', 'ADMIN'],
        syncRolesOnLogin: false,
        requireIdpMfa: false,
        localLoginEnabled: true,
      });
    });
  });

  describe('required for a role', () => {
    beforeEach(async () => {
      await ctx.prisma.setting.update({
        where: { key: SETTING_KEYS.AUTH },
        data: { value: { ...AUTH_DEFAULTS, mfaRequiredRoles: ['MODELER'] } },
      });
    });

    it('members without 2FA set it up during sign-in, then get a session', async () => {
      const c = await new Client(ctx.app).init();
      expect((await c.login('user@test.local')).body).toEqual({ mfa: 'SETUP' });
      // A set-up challenge cannot be used as a verify challenge.
      await c.post('/auth/login/mfa').send({ code: '123456' }).expect(401);
      await c.get('/auth/me').expect(401);
      const setup = await c.post('/auth/login/mfa/setup').expect(200);
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:/);
      await c.post('/auth/login/mfa/setup/confirm').send({ code: '000000' }).expect(400);
      const done = await c
        .post('/auth/login/mfa/setup/confirm')
        .send({ code: totpCode(setup.body.secret) })
        .expect(200);
      expect(done.body.user.mfaEnabled).toBe(true);
      expect(done.body.recoveryCodes).toHaveLength(10);
      c.syncCsrf(done);
      const status = (await c.get('/auth/mfa').expect(200)).body;
      expect(status).toMatchObject({ enabled: true, required: true });
      // Required: cannot be turned off by the user.
      await c
        .post('/auth/mfa/disable')
        .send({ password: PASSWORD, code: await code('user@test.local', setup.body.secret) })
        .expect(403);
    });

    it('roles that do not require it sign in directly', async () => {
      const c = await new Client(ctx.app).init();
      expect((await c.login('admin@test.local')).body.user.email).toBe('admin@test.local');
    });
  });

  it('an admin can reset a user’s 2FA (sessions end); only a Super Admin can reset a Super Admin', async () => {
    const userClient = await loggedIn(ctx.app, 'user@test.local');
    await enrol(userClient);
    await createUser(ctx.prisma, 'useradmin@test.local', ['ADMIN']);
    const admin = await loggedIn(ctx.app, 'useradmin@test.local');
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'user@test.local' } });
    const list = await admin.get('/users').expect(200);
    expect(list.body.items.find((u: { id: string }) => u.id === user.id).mfaEnabled).toBe(true);

    await userClient.post('/users/' + user.id + '/mfa/reset').expect(403);
    await admin.post(`/users/${user.id}/mfa/reset`).expect(204);
    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totpEnabledAt).toBeNull();
    expect(
      await ctx.prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'MFA_RESET' } });
    expect(entry.entityId).toBe(user.id);

    const superAdmin = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'admin@test.local' },
    });
    await admin.post(`/users/${superAdmin.id}/mfa/reset`).expect(403);
    const sa = await loggedIn(ctx.app, 'admin@test.local');
    await sa.post(`/users/${superAdmin.id}/mfa/reset`).expect(204);
  });

  it('is not available for accounts without a password (single sign-on)', async () => {
    const c = await loggedIn(ctx.app, 'user@test.local');
    await ctx.prisma.user.update({
      where: { email: 'user@test.local' },
      data: { passwordHash: '' },
    });
    expect((await c.get('/auth/mfa')).body.available).toBe(false);
    const res = await c.post('/auth/mfa/setup').send({ password: PASSWORD }).expect(400);
    expect(res.body.code).toBe('MFA_NOT_AVAILABLE');
    // And such an account cannot sign in with any password.
    const other = await new Client(ctx.app).init();
    expect((await other.login('user@test.local', '')).status).toBe(400);
    expect((await other.login('user@test.local')).body.code).toBe('INVALID_CREDENTIALS');
  });
  describe('sessions (SEC-37, SEC-38)', () => {
    it('a role that requires 2FA ends a session without 2FA at the next refresh', async () => {
      const c = await loggedIn(ctx.app, 'user@test.local');
      await ctx.prisma.setting.update({
        where: { key: SETTING_KEYS.AUTH },
        data: { value: { ...AUTH_DEFAULTS, mfaRequiredRoles: ['MODELER'] } },
      });
      expect((await c.post('/auth/refresh')).status).toBe(401);
      expect(
        await ctx.prisma.refreshToken.count({
          where: { user: { email: 'user@test.local' }, revokedAt: null },
        }),
      ).toBe(0);
    });

    it('signs out everywhere, ending access tokens at once', async () => {
      const a = await loggedIn(ctx.app, 'user@test.local');
      const b = await loggedIn(ctx.app, 'user@test.local');
      await new Promise((r) => setTimeout(r, 1100)); // tokens of an earlier second
      await a.post('/auth/sessions/revoke-all').expect(204);
      await b.get('/auth/me').expect(401);
      expect((await b.post('/auth/refresh')).status).toBe(401);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'LOGOUT', summary: { path: ['everywhere'], equals: true } },
      });
      expect(audit).not.toBeNull();
      // A new sign-in (a later second) works.
      await new Promise((r) => setTimeout(r, 1100));
      const again = await loggedIn(ctx.app, 'user@test.local');
      await again.get('/auth/me').expect(200);
    });

    it('administrators end the sessions of a user; only Super Admins those of a Super Admin', async () => {
      await createUser(ctx.prisma, 'admin2@test.local', ['ADMIN']);
      const victim = await loggedIn(ctx.app, 'user@test.local');
      const admin = await loggedIn(ctx.app, 'admin2@test.local');
      const userId = (
        await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'user@test.local' } })
      ).id;
      const superId = (
        await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })
      ).id;
      await new Promise((r) => setTimeout(r, 1100));
      await admin.post(`/users/${userId}/sessions/revoke`).expect(204);
      await victim.get('/auth/me').expect(401);
      await admin.post(`/users/${superId}/sessions/revoke`).expect(403);
      // An Admin cannot reset another administrator's password (account takeover).
      const peer = (
        await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin2@test.local' } })
      ).id;
      await createUser(ctx.prisma, 'admin3@test.local', ['ADMIN']);
      const admin3 = await loggedIn(ctx.app, 'admin3@test.local');
      await admin3
        .post(`/users/${peer}/reset-password`)
        .send({ newPassword: 'Another-Password1' })
        .expect(403);
    });
  });
});
