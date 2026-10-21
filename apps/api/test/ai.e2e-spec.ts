import { AiError } from '../src/ai/providers/types';
import { MALFORMED, ONBOARDING } from './fixtures/ai-structures';
import {
  createApp,
  createUser,
  loggedIn,
  parseSse,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

const KEY = 'sk-test-key';

/** AI assistant platform (M16, part A): settings, access, limits, usage, generate and translate. */
describe('AI assistant (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let viewer: Client;
  let ids: Record<string, string>;

  const settings = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    fastModel: 'claude-haiku-5-5',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'PROCESS_OWNER', 'MODELER', 'REVIEWER', 'VIEWER'],
    userDailyLimit: 0,
    orgMonthlyLimit: 0,
    noticeEn: 'Notice',
    noticeAr: 'تنبيه',
    suggestions: {
      GENERATE_PROCESS: [{ en: 'Build an onboarding process', ar: 'أنشئ عملية تهيئة' }],
    },
    ...over,
  });
  const enable = async (over: Record<string, unknown> = {}) =>
    superAdmin
      .put('/ai/settings')
      .send({ apiKey: KEY, ...settings(over) })
      .expect(200);

  /** Posts to a streamed AI endpoint and returns the parsed events. */
  const stream = async (c: Client, path: string, body: object) => {
    const res = await c.post(path).send(body).expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.text);
    const last = events[events.length - 1];
    return { events, last, result: last?.event === 'result' ? last.data : null };
  };

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.ai.queue = [];
    ctx.ai.requests = [];
    const users = {
      superAdmin: await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']),
      admin: await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']),
      modeler: await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']),
      reviewer: await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']),
      viewer: await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']),
    };
    ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id]));
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
  });

  describe('settings and access', () => {
    it('is disabled by default: no AI for anyone, the rest works as before', async () => {
      const st = (await modeler.get('/ai/status').expect(200)).body;
      expect(st).toMatchObject({ available: false, reason: 'DISABLED', suggestions: {} });
      const res = await modeler
        .post('/ai/generate-process')
        .send({ description: 'Employee onboarding', language: 'en' })
        .expect(403);
      expect(res.body.code).toBe('AI_DISABLED');
      await modeler
        .post('/ai/translate')
        .send({ kind: 'fields', target: 'ar', fields: [{ key: 'name', text: 'Hello' }] })
        .expect(403);
      expect(ctx.ai.requests).toHaveLength(0);
    });

    it('Super Admins configure it; the API key is encrypted and never returned', async () => {
      await admin.get('/ai/settings').expect(403);
      await modeler.put('/ai/settings').send(settings()).expect(403);
      const res = await superAdmin.put('/ai/settings').send(settings()).expect(400);
      expect(res.body.code).toBe('AI_KEY_REQUIRED');

      const dto = (await enable()).body;
      expect(dto).toMatchObject({ enabled: true, hasApiKey: true, encryptionAvailable: true });
      expect(JSON.stringify(dto)).not.toContain(KEY);
      expect(JSON.stringify((await superAdmin.get('/ai/settings').expect(200)).body)).not.toContain(
        KEY,
      );
      const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'ai' } });
      expect(JSON.stringify(row.value)).not.toContain(KEY);
      expect((row.value as { apiKeySealed: string }).apiKeySealed).toMatch(/^v1\./);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'Setting', entityId: 'ai' },
      });
      expect(JSON.stringify(audit.summary)).not.toContain(KEY);
      expect(audit.summary).toMatchObject({ credentialChanged: true });

      // Saving without a new key keeps the stored one.
      await superAdmin
        .put('/ai/settings')
        .send(settings({ model: 'claude-opus-5-5' }))
        .expect(200);
      ctx.ai.reply('OK');
      const test = (await superAdmin.post('/ai/settings/test').send(settings()).expect(200)).body;
      expect(test).toMatchObject({ ok: true, code: null });
      expect(ctx.ai.requests[0].apiKey).toBe(KEY);

      // A wrong key typed into the form is reported, never echoed.
      const bad = (
        await superAdmin
          .post('/ai/settings/test')
          .send({ ...settings(), apiKey: 'sk-wrong' })
          .expect(200)
      ).body;
      expect(bad).toMatchObject({ ok: false, code: 'AI_AUTH_FAILED' });
      expect(JSON.stringify(bad)).not.toContain('sk-wrong');
      // Tests do not count against the limits.
      expect((await modeler.get('/ai/status').expect(200)).body.usedToday).toBe(0);
    });

    it('only roles allowed in the settings may use it', async () => {
      await enable({ allowedRoles: ['MODELER'] });
      expect((await modeler.get('/ai/status').expect(200)).body).toMatchObject({
        available: true,
        noticeEn: 'Notice',
        suggestions: { GENERATE_PROCESS: [{ en: 'Build an onboarding process' }] },
      });
      const v = (await viewer.get('/ai/status').expect(200)).body;
      expect(v).toMatchObject({ available: false, reason: 'NOT_ALLOWED', noticeEn: '' });
      const res = await reviewer
        .post('/ai/translate')
        .send({ kind: 'fields', target: 'ar', fields: [{ key: 'n', text: 'Hi' }] })
        .expect(403);
      expect(res.body.code).toBe('AI_NOT_ALLOWED');
    });

    it('enforces the daily per-user and the monthly organisation limits', async () => {
      await enable({ userDailyLimit: 1 });
      const body = { kind: 'fields', target: 'ar', fields: [{ key: 'n', text: 'Hello' }] };
      ctx.ai.reply({ items: [{ id: 'n', text: 'مرحبا', description: '' }] });
      await stream(modeler, '/ai/translate', body);
      const res = await modeler.post('/ai/translate').send(body).expect(429);
      expect(res.body.code).toBe('AI_USER_LIMIT');
      expect((await modeler.get('/ai/status').expect(200)).body).toMatchObject({
        usedToday: 1,
        dailyLimit: 1,
      });

      await enable({ userDailyLimit: 0, orgMonthlyLimit: 1 });
      const org = await reviewer.post('/ai/translate').send(body).expect(429);
      expect(org.body.code).toBe('AI_ORG_LIMIT');
    });
  });

  describe('generate a process from text', () => {
    beforeEach(async () => {
      await enable();
      await ctx.prisma.repoObject.createMany({
        data: [
          { type: 'ROLE', nameEn: 'HR Officer', nameAr: 'موظف الموارد البشرية' },
          { type: 'ROLE', nameEn: 'IT Support', nameAr: 'الدعم الفني' },
          { type: 'SYSTEM', code: 'SAP', nameEn: 'SAP HR', nameAr: 'ساب للموارد البشرية' },
        ],
      });
    });

    it('returns valid BPMN with lanes, layout, bilingual labels and suggested links', async () => {
      ctx.ai.reply(ONBOARDING);
      const { events, result } = await stream(modeler, '/ai/generate-process', {
        description: 'Build a process for employee onboarding with HR, IT and the line manager',
        language: 'en',
      });
      expect(events.some((e) => e.event === 'progress')).toBe(true);
      expect(result).toMatchObject({
        nameEn: 'Employee Onboarding',
        nameAr: 'تهيئة الموظف الجديد',
        warnings: [],
        counts: { lanes: 3, tasks: 5, gateways: 1, events: 2, flows: 8 },
      });
      const xml: string = result.bpmnXml;
      expect(xml).toContain('<bpmn:laneSet');
      expect(xml).toContain('<bpmn:collaboration');
      expect(xml).toContain('ph:nameAr="إنشاء سجل الموظف"');
      expect(xml).toContain('<bpmndi:BPMNShape id="Task_Record_di"');
      expect(xml).toContain('<bpmndi:BPMNEdge');
      // Links are proposed for lanes and systems found in the library, the rest is reported.
      const links = result.suggestedLinks.map(
        (l: { elementId: string; relation: string; object: { nameEn: string } }) =>
          `${l.elementId}:${l.relation}:${l.object.nameEn}`,
      );
      expect(links).toEqual(
        expect.arrayContaining([
          'Task_Record:PERFORMS:HR Officer',
          'Task_Accounts:PERFORMS:IT Support',
          'Task_Laptop:PERFORMS:IT Support',
          'Task_Record:SUPPORTS:SAP HR',
        ]),
      );
      expect(result.unmatched).toEqual([
        { type: 'ROLE', nameEn: 'Line Manager', nameAr: 'المدير المباشر' },
      ]);

      // The prompt carried the library and the user's text; structured output was requested.
      const req = ctx.ai.requests[0];
      expect(req.model).toBe('claude-sonnet-5-5');
      expect(req.jsonSchema).toBeDefined();
      expect(req.messages[0].text).toContain('HR Officer | موظف الموارد البشرية');
      expect(req.messages[0].text).toContain('<request>');

      const usage = await ctx.prisma.aiUsage.findFirstOrThrow();
      expect(usage).toMatchObject({
        userId: ids.modeler,
        feature: 'GENERATE_PROCESS',
        model: 'claude-sonnet-5-5',
        status: 'SUCCESS',
        inputTokens: 1000,
      });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'AI_REQUEST' } });
      expect(audit).toMatchObject({ entityType: 'AI', entityId: usage.id, userId: ids.modeler });
      expect(audit.summary).toMatchObject({ feature: 'GENERATE_PROCESS', status: 'SUCCESS' });
      expect(JSON.stringify(audit.summary)).not.toContain('onboarding');
    });

    it('asks the model once to fix malformed output', async () => {
      ctx.ai.reply(MALFORMED.notJson, ONBOARDING);
      const { result } = await stream(modeler, '/ai/generate-process', {
        description: 'Employee onboarding',
        language: 'ar',
      });
      expect(result.nameEn).toBe('Employee Onboarding');
      expect(ctx.ai.requests).toHaveLength(2);
      const repair = ctx.ai.requests[1].messages;
      expect(repair[repair.length - 1].text).toContain('not valid JSON');
      const usage = await ctx.prisma.aiUsage.findMany();
      expect(usage).toHaveLength(1);
      expect(usage[0].inputTokens).toBe(2000);
    });

    it.each(Object.entries(MALFORMED))(
      'rejects invalid output that is not fixed (%s)',
      async (_name, bad) => {
        ctx.ai.reply(bad, bad);
        const { last } = await stream(modeler, '/ai/generate-process', {
          description: 'Employee onboarding',
          language: 'en',
        });
        expect(last).toEqual({
          event: 'error',
          data: { code: 'AI_INVALID_OUTPUT', message: 'AI_INVALID_OUTPUT' },
        });
        expect(await ctx.prisma.aiUsage.findFirstOrThrow()).toMatchObject({
          status: 'INVALID_OUTPUT',
          errorCode: 'AI_INVALID_OUTPUT',
        });
      },
    );

    it('reports provider errors without details and logs them', async () => {
      ctx.ai.reply(new AiError('AI_RATE_LIMITED', 'HTTP 429 secret details'));
      const { last } = await stream(modeler, '/ai/generate-process', {
        description: 'Employee onboarding',
        language: 'en',
      });
      expect(last.data).toEqual({ code: 'AI_RATE_LIMITED', message: 'AI_RATE_LIMITED' });
      expect((await ctx.prisma.aiUsage.findFirstOrThrow()).status).toBe('ERROR');
    });

    it('needs the right to create processes or to edit the target model', async () => {
      const body = { description: 'Employee onboarding', language: 'en' };
      await reviewer.post('/ai/generate-process').send(body).expect(403);
      const p = await ctx.prisma.process.create({
        data: { code: 'S.09', nameEn: 'Onboarding', category: 'SUPPORT' },
      });
      await reviewer
        .post('/ai/generate-process')
        .send({ ...body, processId: p.id })
        .expect(403);
      await modeler
        .post('/ai/generate-process')
        .send({ ...body, processId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
      await modeler
        .post('/ai/generate-process')
        .send({ description: 'x', language: 'en' })
        .expect(400);
      expect(ctx.ai.requests).toHaveLength(0);
    });

    it('marks saved AI output until a person edits it', async () => {
      const p = await ctx.prisma.process.create({
        data: { code: 'S.09', nameEn: 'Onboarding', category: 'SUPPORT' },
      });
      ctx.ai.reply(ONBOARDING);
      const { result } = await stream(modeler, '/ai/generate-process', {
        description: 'Employee onboarding',
        language: 'en',
        processId: p.id,
      });
      await modeler
        .put(`/processes/${p.id}/model`)
        .send({ bpmnXml: result.bpmnXml, aiGenerated: true })
        .expect(200);
      expect((await modeler.get(`/processes/${p.id}`).expect(200)).body.aiGenerated).toBe(true);
      // The saved model opens in the modeler and keeps its labels.
      const model = (await modeler.get(`/processes/${p.id}/model`).expect(200)).body;
      expect(model.bpmnXml).toContain('Lane_HR');
      await modeler
        .put(`/processes/${p.id}/model`)
        .send({ bpmnXml: sampleBpmn(['Edited']) })
        .expect(200);
      expect((await modeler.get(`/processes/${p.id}`).expect(200)).body.aiGenerated).toBe(false);
    });
  });

  describe('translate', () => {
    beforeEach(() => enable());

    it('translates form fields with the library terminology as glossary', async () => {
      await ctx.prisma.repoObject.create({
        data: { type: 'ROLE', nameEn: 'Purchasing Officer', nameAr: 'مسؤول المشتريات' },
      });
      ctx.ai.reply({
        items: [
          { id: 'nameEn', text: 'طلب الشراء', description: '' },
          { id: 'descriptionEn', text: 'يقدّم مسؤول المشتريات الطلب.', description: '' },
        ],
      });
      const { result } = await stream(modeler, '/ai/translate', {
        kind: 'fields',
        target: 'ar',
        fields: [
          { key: 'nameEn', text: 'Purchase request' },
          { key: 'descriptionEn', text: 'The purchasing officer submits the request.' },
          { key: 'empty', text: '  ' },
        ],
      });
      expect(result.fields).toEqual({
        nameEn: 'طلب الشراء',
        descriptionEn: 'يقدّم مسؤول المشتريات الطلب.',
      });
      const req = ctx.ai.requests[0];
      expect(req.model).toBe('claude-haiku-5-5');
      expect(req.messages[0].text).toContain('Purchasing Officer → مسؤول المشتريات');
    });

    it('fills only the missing language of BPMN labels', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D"><bpmn:process id="P">
<bpmn:task id="A" name="Check budget" ph:nameEn="Check budget" ph:nameAr="" ph:descriptionEn="Compare with plan" />
<bpmn:task id="B" name="Approve" ph:nameEn="Approve" ph:nameAr="اعتماد" />
</bpmn:process></bpmn:definitions>`;
      ctx.ai.reply({
        items: [{ id: 'A', text: 'التحقق من الميزانية', description: 'المقارنة بالخطة' }],
      });
      const { result } = await stream(modeler, '/ai/translate', {
        kind: 'bpmn',
        target: 'ar',
        bpmnXml: xml,
      });
      expect(result.elements).toEqual([
        {
          id: 'A',
          source: 'Check budget',
          name: 'التحقق من الميزانية',
          description: 'المقارنة بالخطة',
        },
      ]);
      expect(ctx.ai.requests[0].messages[0].text).not.toContain('"B"');

      // Nothing missing: no AI request at all.
      const none = await stream(modeler, '/ai/translate', {
        kind: 'bpmn',
        target: 'en',
        bpmnXml: xml
          .replace('ph:nameAr=""', 'ph:nameAr="س"')
          .replace(' ph:descriptionEn="Compare with plan"', ''),
      });
      expect(none.result.elements).toEqual([]);
      expect(ctx.ai.requests).toHaveLength(1);
    });

    it('rejects a translation that misses items, and sanitises translated pages', async () => {
      ctx.ai.reply({ items: [] }, { items: [] });
      const { last } = await stream(modeler, '/ai/translate', {
        kind: 'fields',
        target: 'en',
        fields: [{ key: 'name', text: 'طلب شراء' }],
      });
      expect(last.data.code).toBe('AI_INVALID_OUTPUT');

      ctx.ai.reply({
        title: 'إجراء الشراء',
        html: '<h2>الغرض</h2><p onclick="steal()">نص</p><script>alert(1)</script><img src="javascript:x">',
      });
      const { result } = await stream(modeler, '/ai/translate', {
        kind: 'page',
        target: 'ar',
        title: 'Purchase procedure',
        html: '<h2>Purpose</h2><p>Text</p>',
      });
      expect(result.title).toBe('إجراء الشراء');
      expect(result.html).toContain('<h2>الغرض</h2>');
      expect(result.html).not.toMatch(/script|onclick|javascript:/);
      expect(ctx.ai.requests[2].model).toBe('claude-sonnet-5-5');
    });
  });

  it('usage report: totals per user, feature, model and month', async () => {
    await enable();
    ctx.ai.reply({ items: [{ id: 'n', text: 'مرحبا', description: '' }] }, ONBOARDING);
    await stream(modeler, '/ai/translate', {
      kind: 'fields',
      target: 'ar',
      fields: [{ key: 'n', text: 'Hello' }],
    });
    await stream(admin, '/ai/generate-process', { description: 'Onboarding', language: 'en' });
    await modeler.get('/ai/usage').expect(403);
    const r = (await admin.get('/ai/usage').expect(200)).body;
    expect(r.totals).toMatchObject({ requests: 2, inputTokens: 2000, errors: 0 });
    expect(r.byFeature.map((f: { feature: string }) => f.feature).sort()).toEqual([
      'GENERATE_PROCESS',
      'TRANSLATE',
    ]);
    expect(r.byUser).toHaveLength(2);
    expect(r.byModel.map((m: { model: string }) => m.model).sort()).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
    ]);
    expect(r.byMonth).toHaveLength(12);
    expect(r.byMonth[11].requests).toBe(2);
    await admin.get('/ai/usage?month=2026-13').expect(400);
    const auditor = await createUser(ctx.prisma, 'auditor@test.local', ['AUDITOR']);
    expect(auditor.id).toBeDefined();
    await (await loggedIn(ctx.app, 'auditor@test.local')).get('/ai/usage').expect(200);
  });
});
