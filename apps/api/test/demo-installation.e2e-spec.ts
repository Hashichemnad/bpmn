import request from 'supertest';
import { SETTING_KEYS } from '@processhub/shared';
import { demoSeedAllowed, seedIntegrationsDemo } from '../prisma/seed-integrations';
import { recordDemoInstallation } from '../prisma/seed-demo-marker';
import { createApp, createUser, loggedIn, resetDb, type TestContext } from './helpers';

/** D-180: random demo API key shown once, never without SEED_DEMO_DATA, admin warning banner. */
describe('Demo installation (e2e)', () => {
  let ctx: TestContext;
  const saved = { SEED_DEMO_DATA: process.env.SEED_DEMO_DATA, NODE_ENV: process.env.NODE_ENV };

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    process.env.SEED_DEMO_DATA = saved.SEED_DEMO_DATA;
    process.env.NODE_ENV = saved.NODE_ENV;
    await ctx.app.close();
  });
  afterEach(() => {
    process.env.SEED_DEMO_DATA = saved.SEED_DEMO_DATA;
    process.env.NODE_ENV = saved.NODE_ENV;
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'plain@test.local', ['VIEWER']);
    // Demo users as the seed creates them (SEED_DEMO_EMAIL_DOMAIN default).
    await createUser(ctx.prisma, 'owner@processhub.local', ['PROCESS_OWNER']);
    await createUser(ctx.prisma, 'viewer@processhub.local', ['VIEWER']);
  });

  const quiet = () => {
    const lines: string[] = [];
    return { lines, log: (l: string) => lines.push(l) };
  };

  it('never creates a demo key unless SEED_DEMO_DATA=true (production included)', async () => {
    for (const [nodeEnv, flag] of [
      ['production', undefined],
      ['production', 'false'],
      ['production', ''],
      ['development', undefined],
    ] as const) {
      process.env.NODE_ENV = nodeEnv;
      if (flag === undefined) delete process.env.SEED_DEMO_DATA;
      else process.env.SEED_DEMO_DATA = flag;
      expect(demoSeedAllowed()).toBe(false);
      const out = quiet();
      const res = await seedIntegrationsDemo(ctx.prisma, null, out.log);
      expect(res).toEqual({ apiKeyIds: [], apiKey: null });
      expect(out.lines).toEqual([]);
    }
    expect(await ctx.prisma.apiKey.count()).toBe(0);
    expect(await ctx.prisma.webhook.count()).toBe(0);
  });

  it('generates a random key, shows it once in the seed output and stores only its hash', async () => {
    process.env.SEED_DEMO_DATA = 'true';
    process.env.NODE_ENV = 'production';
    const out = quiet();
    const first = await seedIntegrationsDemo(ctx.prisma, null, out.log);
    expect(first.apiKey).toMatch(/^phk_[A-Za-z0-9]+_[A-Za-z0-9_-]{43}$/);
    expect(first.apiKey).not.toContain('DemoKey');
    // Shown exactly once, in the seed output.
    const shown = out.lines.join('\n');
    expect(shown.split(first.apiKey!).length - 1).toBe(1);
    expect(shown).toContain('Demo API key (shown only once)');
    // Stored as a hash only; the demo webhook secret is random too.
    const row = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: first.apiKeyIds[0] } });
    expect(JSON.stringify(row)).not.toContain(first.apiKey!.split('_')[2]);
    expect(row).toMatchObject({ content: 'PUBLISHED', revokedAt: null });
    expect(row.scopes.every((s) => s.endsWith(':read'))).toBe(true);
    // The key works against the public API.
    await request(ctx.app.getHttpServer())
      .get('/api/public/v1/me')
      .set('X-API-Key', first.apiKey!)
      .expect(200);
    // Once per installation: a second seed run creates nothing.
    expect((await seedIntegrationsDemo(ctx.prisma, null, quiet().log)).apiKeyIds).toEqual([]);
    // A fresh installation gets a different key.
    await ctx.prisma.webhookDelivery.deleteMany();
    await ctx.prisma.webhook.deleteMany();
    await ctx.prisma.reportSubscription.deleteMany();
    await ctx.prisma.apiKeyUsage.deleteMany();
    await ctx.prisma.apiKey.deleteMany();
    const second = await seedIntegrationsDemo(ctx.prisma, null, quiet().log);
    expect(second.apiKey).toBeTruthy();
    expect(second.apiKey).not.toBe(first.apiKey);
  });

  it('administrators see the warning until the demo is removed; a Super Admin confirms it', async () => {
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    const plain = await loggedIn(ctx.app, 'plain@test.local');
    // No demo seeded: no warning.
    expect((await admin.get('/settings/demo-status').expect(200)).body).toMatchObject({
      warning: false,
      demoData: false,
    });

    process.env.SEED_DEMO_DATA = 'true';
    const seeded = await seedIntegrationsDemo(ctx.prisma, null, quiet().log);
    await recordDemoInstallation(ctx.prisma, { apiKeyIds: seeded.apiKeyIds });
    const status = (await admin.get('/settings/demo-status').expect(200)).body;
    expect(status).toMatchObject({
      warning: true,
      demoData: true,
      activeDemoUsers: 2,
      activeDemoApiKeys: 1,
      clearedAt: null,
    });
    await plain.get('/settings/demo-status').expect(403);
    // Only a Super Admin confirms, and only once demo users and keys are switched off.
    await admin.post('/settings/demo-status/clear').expect(403);
    const refused = await superAdmin.post('/settings/demo-status/clear').expect(409);
    expect(refused.body.code).toBe('DEMO_STILL_ACTIVE');

    await ctx.prisma.apiKey.update({
      where: { id: seeded.apiKeyIds[0] },
      data: { revokedAt: new Date() },
    });
    await ctx.prisma.user.updateMany({
      where: { email: { endsWith: '@processhub.local' } },
      data: { status: 'INACTIVE' },
    });
    // Demo content not yet confirmed removed: still warned.
    expect((await admin.get('/settings/demo-status').expect(200)).body).toMatchObject({
      warning: true,
      demoData: true,
      activeDemoUsers: 0,
      activeDemoApiKeys: 0,
    });
    const cleared = (await superAdmin.post('/settings/demo-status/clear').expect(200)).body;
    expect(cleared).toMatchObject({ warning: false, demoData: false });
    expect(cleared.clearedAt).toBeTruthy();
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityType: 'Setting', entityId: SETTING_KEYS.DEMO_INSTALLATION },
    });
    expect(audit?.summary).toMatchObject({ demoRemovedConfirmed: true });

    // Re-running the seed without creating anything keeps it cleared …
    await recordDemoInstallation(ctx.prisma, { apiKeyIds: [] });
    expect((await admin.get('/settings/demo-status').expect(200)).body.warning).toBe(false);
    // … a new demo key puts the warning back.
    const extra = await ctx.prisma.apiKey.create({
      data: {
        name: 'Another demo key',
        prefix: 'Extra0000001',
        secretHash: 'x'.repeat(64),
        ownerId: (await ctx.prisma.user.findFirstOrThrow()).id,
        scopes: ['processes:read'],
        content: 'PUBLISHED',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await recordDemoInstallation(ctx.prisma, { apiKeyIds: [extra.id] });
    expect((await admin.get('/settings/demo-status').expect(200)).body).toMatchObject({
      warning: true,
      activeDemoApiKeys: 1,
    });
  });
});
