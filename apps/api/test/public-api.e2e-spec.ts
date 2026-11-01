import request from 'supertest';
import { ApiKeysService } from '../src/public-api/api-keys.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

describe('Public REST API with API keys (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;
  let modeler: Client;
  let ownerId: string;
  let deptA: string;
  let deptB: string;
  let published: string;
  let draft: string;
  let otherDept: string;

  const pub = (path: string, key?: string) => {
    const r = request(ctx.app.getHttpServer()).get(`/api/public/v1${path}`);
    return key ? r.set('X-API-Key', key) : r;
  };

  const newKey = async (over: Record<string, unknown> = {}) => {
    const res = await superAdmin
      .post('/integrations/api-keys')
      .send({ name: 'BI', ownerId, scopes: ['processes:read'], ...over })
      .expect(201);
    return res.body as { secret: string; key: { id: string; prefix: string } };
  };

  const processRow = async (code: string, nameEn: string, departmentId: string) => {
    const p = await ctx.prisma.process.create({
      data: { code, nameEn, nameAr: `${nameEn} ع`, category: 'CORE', departmentId, level: 1 },
    });
    await ctx.prisma.processModel.create({
      data: { processId: p.id, bpmnXml: sampleBpmn(['Draft_Task']) },
    });
    return p.id;
  };

  const publish = async (processId: string, titleEn: string) => {
    await ctx.prisma.processVersion.create({
      data: {
        processId,
        versionNumber: 1,
        bpmnXml: sampleBpmn(['Published_Task']),
        changeNote: 'v1',
      },
    });
    await ctx.prisma.publication.create({
      data: {
        entityType: 'PROCESS',
        entityId: processId,
        versionNumber: 1,
        versionLabel: '1.0',
        code: 'C.01',
        titleEn,
        titleAr: 'منشور',
        approvedAt: new Date('2026-10-01T08:00:00Z'),
      },
    });
    await ctx.prisma.process.update({ where: { id: processId }, data: { status: 'PUBLISHED' } });
  };

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    deptA = (await ctx.prisma.department.create({ data: { nameEn: 'Finance', nameAr: 'المالية' } }))
      .id;
    deptB = (await ctx.prisma.department.create({ data: { nameEn: 'HR', nameAr: 'الموارد' } })).id;
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    ownerId = (await createUser(ctx.prisma, 'owner@test.local', ['VIEWER'])).id;
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    published = await processRow('C.01', 'Draft title', deptA);
    await publish(published, 'Published title');
    draft = await processRow('C.02', 'Only a draft', deptA);
    otherDept = await processRow('S.01', 'HR process', deptB);
    await publish(otherDept, 'HR published');
  });

  it('Super Admins manage keys; Admins only see them; the secret is shown once and stored hashed', async () => {
    const { secret, key } = await newKey({ scopes: ['processes:read', 'kpis:read'] });
    expect(secret).toMatch(/^phk_[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(secret.startsWith(key.prefix)).toBe(true);
    const row = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(row.secretHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(secret.split('_')[2]);
    // Default expiry: one year.
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(364 * 86_400_000);

    const listed = (await admin.get('/integrations/api-keys').expect(200)).body;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(listed[0]).toMatchObject({ status: 'ACTIVE', scopes: ['processes:read', 'kpis:read'] });
    await admin
      .post('/integrations/api-keys')
      .send({ name: 'x', ownerId, scopes: ['processes:read'] })
      .expect(403);
    await admin.post(`/integrations/api-keys/${key.id}/revoke`).expect(403);
    await modeler.get('/integrations/api-keys').expect(403);

    const audit = await ctx.prisma.auditLog.findMany({ where: { entityType: 'ApiKey' } });
    expect(audit.map((a) => a.action)).toEqual(['CREATE']);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it('refuses expiry dates beyond the configured maximum and unknown owners', async () => {
    await superAdmin
      .post('/integrations/api-keys')
      .send({
        name: 'x',
        ownerId,
        scopes: ['processes:read'],
        expiresAt: new Date(Date.now() + 800 * 86_400_000).toISOString(),
      })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('API_KEY_EXPIRY_TOO_LONG'));
    await superAdmin
      .put('/integrations/api-settings')
      .send({ maxKeyDays: 900, usageRetentionDays: 30 })
      .expect(200);
    await newKey({ expiresAt: new Date(Date.now() + 800 * 86_400_000).toISOString() });
    await superAdmin
      .post('/integrations/api-keys')
      .send({
        name: 'x',
        ownerId: '00000000-0000-4000-8000-000000000000',
        scopes: ['processes:read'],
      })
      .expect(400);
  });

  it('authenticates with X-API-Key or Bearer, never with the session cookie', async () => {
    const { secret } = await newKey();
    await pub('/me').expect(401);
    await pub('/me', 'phk_notakey').expect(401);
    await pub('/me', secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A')).expect(401);
    const me = await pub('/me', secret).expect(200);
    expect(me.body).toMatchObject({ name: 'BI', scopes: ['processes:read'], content: 'PUBLISHED' });
    await request(ctx.app.getHttpServer())
      .get('/api/public/v1/me')
      .set('Authorization', `Bearer ${secret}`)
      .expect(200);
    // A signed-in Super Admin's cookies are not an API key.
    await superAdmin.agent.get('/api/public/v1/processes').expect(401);
    // The internal API does not accept keys.
    await request(ctx.app.getHttpServer())
      .get('/api/v1/processes')
      .set('X-API-Key', secret)
      .expect(401);
  });

  it('published keys see the published version only; workspace keys see drafts', async () => {
    const { secret } = await newKey();
    const list = await pub('/processes', secret).expect(200);
    expect(list.body.total).toBe(2);
    const item = list.body.items.find((p: { id: string }) => p.id === published);
    expect(item).toMatchObject({
      nameEn: 'Published title',
      nameAr: 'منشور',
      status: 'PUBLISHED',
      publishedVersion: { versionNumber: 1, label: '1.0' },
    });
    expect(list.body.items.some((p: { id: string }) => p.id === draft)).toBe(false);
    await pub(`/processes/${draft}`, secret).expect(404);
    const xml = await pub(`/processes/${published}/bpmn`, secret).expect(200);
    expect(xml.headers['content-type']).toContain('application/xml');
    expect(xml.text).toContain('Published_Task');
    expect(xml.text).not.toContain('Draft_Task');
    const house = await pub('/process-house', secret).expect(200);
    expect(house.body.CORE.map((n: { id: string }) => n.id).sort()).toEqual(
      [published, otherDept].sort(),
    );

    const ws = await newKey({ content: 'WORKSPACE' });
    const all = await pub('/processes', ws.secret).expect(200);
    expect(all.body.total).toBe(3);
    const wsXml = await pub(`/processes/${draft}/bpmn`, ws.secret).expect(200);
    expect(wsXml.text).toContain('Draft_Task');
    const filtered = await pub('/processes?status=DRAFT', ws.secret).expect(200);
    expect(filtered.body.items.map((p: { id: string }) => p.id)).toEqual([draft]);
  });

  it('supports ETag / If-Modified-Since, paging and validation', async () => {
    const { secret } = await newKey();
    const first = await pub('/processes?pageSize=1', secret).expect(200);
    expect(first.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(first.body.items).toHaveLength(1);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\//);
    await pub('/processes?pageSize=1', secret).set('If-None-Match', etag).expect(304);
    const lastModified = first.headers['last-modified'] as string;
    expect(lastModified).toBeTruthy();
    await pub('/processes?pageSize=1', secret).set('If-Modified-Since', lastModified).expect(304);
    await pub('/processes?pageSize=1', secret)
      .set('If-Modified-Since', new Date(Date.parse(lastModified) - 60_000).toUTCString())
      .expect(200);
    await pub('/processes?pageSize=500', secret).expect(400);
    await pub('/processes/not-a-uuid', secret).expect(400);
    const later = await pub(
      `/processes?updatedSince=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
      secret,
    ).expect(200);
    expect(later.body.total).toBe(0);
  });

  it('draws the SVG through the renderer in the requested language', async () => {
    const { secret } = await newKey();
    const svg = await pub(`/processes/${published}/svg?lang=ar`, secret)
      .buffer(true)
      .parse((res, cb) => {
        let d = '';
        res.on('data', (c: Buffer) => (d += c.toString()));
        res.on('end', () => cb(null, d));
      })
      .expect(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('>ar<');
    expect(ctx.renderer.calls.at(-1)).toMatchObject({ kind: 'bpmn', locale: 'ar', format: 'svg' });
    ctx.renderer.on = false;
    try {
      await pub(`/processes/${published}/svg`, secret)
        .expect(503)
        .expect((r) => expect(r.body.code).toBe('RENDERER_UNAVAILABLE'));
    } finally {
      ctx.renderer.on = true;
    }
  });

  it('enforces scopes and the department filter', async () => {
    const { secret } = await newKey({ departmentIds: [deptB] });
    const list = await pub('/processes', secret).expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([otherDept]);
    await pub(`/processes/${published}`, secret).expect(404);
    for (const path of [
      '/risks',
      '/kpis',
      '/applications',
      '/pages',
      '/diagrams',
      '/objects',
      '/workflow/statistics',
      '/workflow/cases',
    ]) {
      const res = await pub(path, secret).expect(403);
      expect(res.body.code).toBe('API_SCOPE_MISSING');
    }
    const stats = await newKey({ scopes: ['workflow:read'] });
    await pub('/workflow/statistics', stats.secret).expect(200);
    await pub('/workflow/cases', stats.secret).expect(403);
  });

  it('revoked, expired, rotated keys, inactive owners and other addresses are refused', async () => {
    const a = await newKey();
    await superAdmin.post(`/integrations/api-keys/${a.key.id}/revoke`).expect(200);
    expect((await pub('/me', a.secret).expect(401)).body.code).toBe('API_KEY_REVOKED');

    const b = await newKey();
    await ctx.prisma.apiKey.update({
      where: { id: b.key.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await pub('/me', b.secret).expect(401)).body.code).toBe('API_KEY_EXPIRED');

    const c = await newKey();
    const rotated = (await superAdmin.post(`/integrations/api-keys/${c.key.id}/rotate`).expect(200))
      .body;
    expect(rotated.secret).not.toBe(c.secret);
    await pub('/me', c.secret).expect(401);
    await pub('/me', rotated.secret).expect(200);

    const d = await newKey({ ipAllowList: ['10.9.9.9', '192.168.0.0/16'] });
    expect((await pub('/me', d.secret).expect(403)).body.code).toBe('API_KEY_IP_NOT_ALLOWED');
    await superAdmin
      .patch(`/integrations/api-keys/${d.key.id}`)
      .send({ ipAllowList: ['127.0.0.1', '::1'] })
      .expect(200);
    await pub('/me', d.secret).expect(200);

    const e = await newKey();
    await ctx.prisma.user.update({ where: { id: ownerId }, data: { status: 'INACTIVE' } });
    expect((await pub('/me', e.secret).expect(401)).body.code).toBe('API_KEY_OWNER_INACTIVE');

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { entityType: 'ApiKey' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['CREATE', 'REVOKE', 'ROTATE', 'UPDATE']));
  });

  it('limits calls per key and minute and logs every call with its route template', async () => {
    const { secret, key } = await newKey({ rateLimitPerMinute: 2 });
    const ok = await pub('/me', secret).expect(200);
    expect(ok.headers['x-ratelimit-limit']).toBe('2');
    await pub(`/processes/${published}`, secret).expect(200);
    const limited = await pub('/me', secret).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Another key has its own budget.
    const other = await newKey();
    await pub('/me', other.secret).expect(200);

    await ctx.app.get(ApiKeysService).flush();
    const usage = (await admin.get(`/integrations/api-keys/${key.id}/usage`).expect(200)).body;
    const paths = usage.recent.map(
      (r: { path: string; status: number }) => `${r.status} ${r.path}`,
    );
    expect(paths).toEqual(expect.arrayContaining(['200 /me', '200 /processes/:id', '429 /me']));
    expect(JSON.stringify(usage)).not.toContain(published);
    expect(usage.days[0].calls).toBe(3);
    const errors = (
      await admin.get(`/integrations/api-keys/${key.id}/usage?status=errors`).expect(200)
    ).body;
    expect(errors.recent).toHaveLength(1);
    const k = (await admin.get(`/integrations/api-keys/${key.id}`).expect(200)).body;
    expect(k.lastUsedAt).toBeTruthy();
  });

  it('publishes an OpenAPI document of the public API only', async () => {
    const doc = await request(ctx.app.getHttpServer()).get('/api/public/docs-json').expect(200);
    const paths = Object.keys(doc.body.paths as Record<string, unknown>);
    expect(paths).toContain('/api/public/v1/processes/{id}/bpmn');
    expect(paths.filter((p) => !p.startsWith('/api/public/v1/'))).toEqual([]);
    expect(doc.body.components.securitySchemes.apiKey).toMatchObject({
      in: 'header',
      name: 'X-API-Key',
    });
  });

  it('serves the reporting feed (reporting:read): flat paged tables for Power BI', async () => {
    const plain = await newKey();
    await pub('/reporting/processes', plain.secret).expect(403);
    const { secret } = await newKey({ scopes: ['reporting:read'], content: 'WORKSPACE' });
    const tables = (await pub('/reporting', secret).expect(200)).body as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('workflow-sla');
    for (const t of tables) {
      const res = await pub(`/reporting/${t.name}?pageSize=1000`, secret).expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 1000 });
      expect(Array.isArray(res.body.items)).toBe(true);
    }
    await pub('/reporting/unknown', secret).expect(400);
    await pub('/reporting/processes?pageSize=5000', secret).expect(400);

    const processes = (await pub('/reporting/processes', secret).expect(200)).body;
    expect(processes.total).toBe(3);
    const row = processes.items.find((r: { processId: string }) => r.processId === published);
    expect(row).toMatchObject({
      code: 'C.01',
      status: 'PUBLISHED',
      publishedVersion: 1,
      lastApprovedAt: '2026-10-01T08:00:00.000Z',
      departmentEn: 'Finance',
      departmentAr: 'المالية',
    });
    // Flat rows only: no nested objects (Power BI expands columns directly).
    expect(Object.values(row).every((v) => v === null || typeof v !== 'object')).toBe(true);

    // KPI values carry their RAG status.
    const kpi = await ctx.prisma.repoObject.create({
      data: {
        type: 'KPI',
        code: 'KPI-1',
        nameEn: 'On time',
        nameAr: 'في الوقت',
        kpi: {
          create: {
            unit: '%',
            target: 95,
            redThreshold: 80,
            status: 'ACTIVE',
            departmentId: deptA,
          },
        },
      },
    });
    await ctx.prisma.kpiMeasurement.create({
      data: { kpiId: kpi.id, period: '2026-09', periodStart: new Date('2026-09-01'), value: 70 },
    });
    const values = (await pub('/reporting/kpi-measurements', secret).expect(200)).body;
    expect(values.items[0]).toMatchObject({
      kpiId: kpi.id,
      period: '2026-09',
      value: 70,
      target: 95,
      rag: 'RED',
    });

    // A published-content key with a department filter sees less.
    const narrow = await newKey({ scopes: ['reporting:read'], departmentIds: [deptB] });
    const few = (await pub('/reporting/processes', narrow.secret).expect(200)).body;
    expect(few.items.map((r: { processId: string }) => r.processId)).toEqual([otherDept]);
    expect((await pub('/reporting/kpis', narrow.secret).expect(200)).body.total).toBe(0);
  });
});
