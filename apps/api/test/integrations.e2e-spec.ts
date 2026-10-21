import { SETTING_KEYS } from '@processhub/shared';
import { GitError } from '../src/integrations/providers/types';
import { GitSyncService } from '../src/integrations/git-sync.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

describe('Git integration (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let modeler: Client;
  let sync: GitSyncService;

  const settings = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    provider: 'github',
    repository: 'acme/bpm',
    branch: 'main',
    folder: 'export',
    token: 'good-token',
    syncProcesses: true,
    syncPages: true,
    trigger: 'ON_VERSION',
    ...over,
  });

  /** Lets event listeners run, then waits for the sync queue to drain. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 30));
      await sync.whenIdle();
    }
  };

  const newProcess = async (code = 'C.01', nameEn = 'Sales') =>
    (await modeler.post('/processes').send({ code, nameEn, nameAr: 'المبيعات', category: 'CORE' }))
      .body.id as string;

  const version = (id: string, changeNote = 'First', ids = ['Task_1']) =>
    modeler
      .post(`/processes/${id}/versions`)
      .send({ bpmnXml: sampleBpmn(ids), changeNote })
      .expect(201);

  beforeAll(async () => {
    ctx = await createApp();
    sync = ctx.app.get(GitSyncService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await sync.whenIdle();
    await resetDb(ctx.prisma);
    ctx.git.files.clear();
    ctx.git.commits.length = 0;
    ctx.git.failNext = null;
    await createUser(ctx.prisma, 'root@test.local', ['SUPER_ADMIN'], { nameEn: 'Root Admin' });
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER'], { nameEn: 'Mona Modeler' });
    superAdmin = await loggedIn(ctx.app, 'root@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
  });

  it('stores settings with the token encrypted and never returns it', async () => {
    const defaults = (await superAdmin.get('/integrations/git').expect(200)).body;
    expect(defaults).toMatchObject({ enabled: false, hasToken: false, encryptionAvailable: true });
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    await admin.get('/integrations/git').expect(403);
    await admin.put('/integrations/git').send(settings()).expect(403);

    await superAdmin
      .put('/integrations/git')
      .send(settings({ token: undefined }))
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('GIT_TOKEN_REQUIRED'));
    await superAdmin
      .put('/integrations/git')
      .send(settings({ repository: 'nope' }))
      .expect(400);

    const saved = (await superAdmin.put('/integrations/git').send(settings()).expect(200)).body;
    expect(saved).toMatchObject({ enabled: true, hasToken: true, folder: 'export' });
    expect(JSON.stringify(saved)).not.toContain('good-token');
    const row = await ctx.prisma.setting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.GIT_INTEGRATION },
    });
    expect(JSON.stringify(row.value)).not.toContain('good-token');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Integration' },
    });
    expect(JSON.stringify(audit.summary)).not.toMatch(/good-token|tokenSealed/);
    expect(audit.summary).toMatchObject({ credentialChanged: true });

    // Saving without a token keeps the stored one
    const again = (
      await superAdmin
        .put('/integrations/git')
        .send(settings({ token: '', branch: 'develop' }))
        .expect(200)
    ).body;
    expect(again).toMatchObject({ hasToken: true, branch: 'develop' });
    const cleared = (
      await superAdmin
        .put('/integrations/git')
        .send(settings({ enabled: false, clearToken: true }))
        .expect(200)
    ).body;
    expect(cleared.hasToken).toBe(false);
  });

  it('tests the connection without leaking the token', async () => {
    let res = (await superAdmin.post('/integrations/git/test').send(settings()).expect(200)).body;
    expect(res).toEqual({ ok: true, code: null, message: null, defaultBranch: 'main' });
    res = (
      await superAdmin
        .post('/integrations/git/test')
        .send(settings({ token: 'wrong-token' }))
        .expect(200)
    ).body;
    expect(res).toMatchObject({ ok: false, code: 'GIT_AUTH_FAILED' });
    expect(res.message).not.toContain('wrong-token');
    res = (await superAdmin.post('/integrations/git/test').send(settings({ branch: 'x' }))).body;
    expect(res.code).toBe('GIT_BRANCH_NOT_FOUND');
  });

  it('does nothing while the integration is disabled', async () => {
    await superAdmin
      .put('/integrations/git')
      .send(settings({ enabled: false }))
      .expect(200);
    await version(await newProcess());
    await settle();
    expect(ctx.git.commits).toHaveLength(0);
    expect(await ctx.prisma.gitSyncItem.count()).toBe(0);
  });

  it('commits every new process version as .bpmn + .json, authored by the user', async () => {
    await superAdmin.put('/integrations/git').send(settings()).expect(200);
    const parent = await newProcess('C.02', 'Order to Cash');
    const child = (
      await modeler
        .post('/processes')
        .send({ code: 'C.02.03', nameEn: 'Order Handling', parentId: parent })
    ).body.id;
    await version(child, 'Added approval');
    await settle();

    expect(ctx.git.commits).toHaveLength(1);
    const commit = ctx.git.commits[0];
    expect(commit.message).toBe('Update C.02.03 Order Handling — v1: Added approval');
    expect(commit.author).toEqual({ name: 'Mona Modeler', email: 'modeler@test.local' });
    const base = 'export/processes/core/C.02-order-to-cash/C.02.03-order-handling';
    expect(ctx.git.files.get(`${base}/C.02.03.bpmn`)).toContain('Task_1');
    const meta = JSON.parse(ctx.git.files.get(`${base}/C.02.03.json`)!);
    expect(meta).toMatchObject({
      code: 'C.02.03',
      version: 1,
      changeNote: 'Added approval',
      bpmnFile: 'C.02.03.bpmn',
    });

    // A rename moves the files in the next commit (old paths removed)
    await modeler.patch(`/processes/${child}`).send({ nameEn: 'Order Processing' }).expect(200);
    await version(child, 'Renamed', ['Task_1', 'Task_2']);
    await settle();
    expect(ctx.git.commits).toHaveLength(2);
    expect(ctx.git.files.has(`${base}/C.02.03.bpmn`)).toBe(false);
    expect(
      ctx.git.files.has(
        'export/processes/core/C.02-order-to-cash/C.02.03-order-processing/C.02.03.bpmn',
      ),
    ).toBe(true);

    const status = (await superAdmin.get('/integrations/git/status').expect(200)).body;
    expect(status.counts).toMatchObject({ SUCCESS: 1, FAILED: 0, PENDING: 0 });
    expect(status.items[0]).toMatchObject({
      entityType: 'PROCESS',
      status: 'SUCCESS',
      version: 2,
      commitSha: 'sha2',
      title: expect.objectContaining({ code: 'C.02.03' }),
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SYNC' } })).toBe(2);
  });

  it('exports wiki pages as Markdown with front-matter and removes deleted pages', async () => {
    await superAdmin
      .put('/integrations/git')
      .send(settings({ folder: '' }))
      .expect(200);
    const processId = await newProcess();
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    const spaceId = (await admin.post('/spaces').send({ key: 'QM', nameEn: 'Quality' })).body.id;
    const page = (
      await modeler
        .post(`/spaces/${spaceId}/pages`)
        .send({ titleEn: 'Document Control', titleAr: 'ضبط الوثائق' })
    ).body;
    await version(processId);
    await modeler
      .put(`/pages/${page.id}`)
      .send({
        titleEn: 'Document Control',
        titleAr: 'ضبط الوثائق',
        contentEn: `<h2>Scope</h2><div data-type="bpmn-diagram" data-process-id="${processId}"></div>`,
        contentAr: '<p>النطاق</p>',
        changeNote: 'Scope added',
      })
      .expect(200);
    await settle();

    const dir = `docs/QM/document-control-${page.id.slice(0, 8)}`;
    const en = ctx.git.files.get(`${dir}/index.en.md`)!;
    expect(en).toContain(`id: "${page.id}"`);
    expect(en).toContain('language: "en"');
    expect(en).toContain('version: 2');
    expect(en).toContain('## Scope');
    expect(en).toContain('](../../../processes/core/C.01-sales/C.01.bpmn)');
    expect(ctx.git.files.get(`${dir}/index.ar.md`)).toContain('# ضبط الوثائق');
    expect(ctx.git.commits.at(-1)!.message).toBe(
      'Update page QM / Document Control — v2: Scope added',
    );

    await modeler.delete(`/pages/${page.id}`).expect(204);
    await settle();
    expect(ctx.git.files.has(`${dir}/index.en.md`)).toBe(false);
    expect(await ctx.prisma.gitSyncItem.count({ where: { entityType: 'PAGE' } })).toBe(0);

    // Pages in view-restricted spaces are never exported
    await admin
      .put(`/spaces/${spaceId}/permissions`)
      .send({ viewRestricted: true, editRestricted: false, grants: [] });
    await modeler.post(`/spaces/${spaceId}/pages`).send({ titleEn: 'Secret' }).expect(404);
    const secret = (await admin.post(`/spaces/${spaceId}/pages`).send({ titleEn: 'Secret' })).body;
    await settle();
    expect([...ctx.git.files.keys()].some((p) => p.includes(secret.id.slice(0, 8)))).toBe(false);
  });

  it('manual trigger: versions wait for "Sync now", which makes one commit', async () => {
    await superAdmin
      .put('/integrations/git')
      .send(settings({ trigger: 'MANUAL' }))
      .expect(200);
    const a = await newProcess('C.01', 'Sales');
    const b = await newProcess('C.02', 'Billing');
    await version(a);
    await version(b);
    await settle();
    expect(ctx.git.commits).toHaveLength(0);
    let status = (await superAdmin.get('/integrations/git/status')).body;
    expect(status.counts.PENDING).toBe(2);

    await modeler.post('/integrations/git/sync').send({}).expect(403);
    const queued = (
      await superAdmin.post('/integrations/git/sync').send({ scope: 'processes' }).expect(202)
    ).body;
    expect(queued.queued).toBe(2);
    await settle();
    expect(ctx.git.commits).toHaveLength(1);
    expect(ctx.git.commits[0].message).toBe('Sync from ProcessHub: 2 processes, 0 pages');
    expect(ctx.git.commits[0].author.email).toBe('root@test.local');
    status = (await superAdmin.get('/integrations/git/status')).body;
    expect(status.counts).toMatchObject({ SUCCESS: 2, PENDING: 0 });

    // Nothing changed: no empty commit
    await superAdmin.post('/integrations/git/sync').send({}).expect(202);
    await settle();
    expect(ctx.git.commits).toHaveLength(1);
  });

  it('records failures with a translatable code and retries', async () => {
    await superAdmin.put('/integrations/git').send(settings()).expect(200);
    ctx.git.failNext = new GitError('GIT_RATE_LIMITED', 'HTTP 429: slow down good-token');
    await version(await newProcess());
    await settle();
    let status = (await superAdmin.get('/integrations/git/status')).body;
    expect(status.items[0]).toMatchObject({ status: 'FAILED', errorCode: 'GIT_RATE_LIMITED' });
    expect(status.items[0].errorMessage).toBe('HTTP 429: slow down ***');
    const failure = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'SYNC' } });
    expect(failure.summary).toMatchObject({ status: 'FAILED', errorCode: 'GIT_RATE_LIMITED' });

    await superAdmin.post(`/integrations/git/items/${status.items[0].id}/retry`).expect(202);
    await settle();
    status = (await superAdmin.get('/integrations/git/status')).body;
    expect(status.items[0]).toMatchObject({ status: 'SUCCESS', errorCode: null });
    expect(ctx.git.commits).toHaveLength(1);
  });
});
