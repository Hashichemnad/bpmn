import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { Client, createApp, createUser, loggedIn, resetDb, type TestContext } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Settings (e2e)', () => {
  let ctx: TestContext;
  let root: Client;

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
    root = await loggedIn(ctx.app, 'root@test.local');
  });

  it('GET /settings/public works without login', async () => {
    const res = await new Client(ctx.app).get('/settings/public').expect(200);
    expect(res.body).toEqual({
      orgNameEn: '',
      orgNameAr: '',
      defaultLocale: 'en',
      hasLogo: false,
      logoVersion: null,
      diagramTheme: DEFAULT_DIAGRAM_THEME,
      diagramThemeCustomised: false,
    });
  });

  it('only Super Admin can read and update settings', async () => {
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    await admin.get('/settings').expect(403);
    await admin.patch('/settings').send({ orgNameEn: 'X' }).expect(403);
    const res = await root
      .patch('/settings')
      .send({ orgNameEn: 'Acme', orgNameAr: 'أكمي', defaultLocale: 'ar' })
      .expect(200);
    expect(res.body).toMatchObject({ orgNameEn: 'Acme', orgNameAr: 'أكمي', defaultLocale: 'ar' });
    expect(res.body.integrations).toEqual({ git: { enabled: false, provider: 'github' } });
    const pub = await new Client(ctx.app).get('/settings/public');
    expect(pub.body.defaultLocale).toBe('ar');
    await root.patch('/settings').send({ defaultLocale: 'de' }).expect(400);
    expect(await ctx.prisma.auditLog.count({ where: { entityType: 'Setting' } })).toBe(1);
  });

  it('uploads, serves and removes a PNG logo', async () => {
    const up = await root
      .post('/settings/logo')
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body.hasLogo).toBe(true);
    const logo = await new Client(ctx.app).get('/settings/logo').expect(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
    await root.delete('/settings/logo').expect(200);
    await new Client(ctx.app).get('/settings/logo').expect(404);
    expect(ctx.storage.files.size).toBe(0);
  });

  it('sanitises SVG logos and rejects disguised files', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="4"/></svg>',
    );
    await root
      .post('/settings/logo')
      .attach('file', svg, { filename: 'logo.svg', contentType: 'image/svg+xml' })
      .expect(201);
    const stored = [...ctx.storage.files.values()][0];
    expect(stored.contentType).toBe('image/svg+xml');
    expect(stored.data.toString()).not.toMatch(/script|onload/);

    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await root
      .post('/settings/logo')
      .attach('file', html, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect((await root.post('/settings/logo')).body.code).toBe('FILE_REQUIRED');
  });

  it('rejects oversized logos', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
    const res = await root
      .post('/settings/logo')
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });
});
