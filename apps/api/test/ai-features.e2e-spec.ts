import { structureToBpmn } from '../src/ai/bpmn/structure-to-bpmn';
import { ONBOARDING, ONBOARDING_REFINED } from './fixtures/ai-structures';
import {
  createApp,
  createUser,
  loggedIn,
  parseSse,
  resetDb,
  type Client,
  type TestContext,
} from './helpers';

/** AI assistant part B: refine with chat, documentation ↔ process, summaries. */
describe('AI features (e2e)', () => {
  let ctx: TestContext;
  let modeler: Client;
  let reviewer: Client;
  let processId: string;
  let xml: string;

  const stream = async (c: Client, path: string, body: object) => {
    const res = await c.post(path).send(body).expect(200);
    const events = parseSse(res.text);
    const last = events[events.length - 1];
    return { events, last, result: last?.event === 'result' ? last.data : null };
  };
  const lastPrompt = () => {
    const req = ctx.ai.requests[ctx.ai.requests.length - 1];
    return req.messages[req.messages.length - 1].text;
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
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    await superAdmin
      .put('/ai/settings')
      .send({
        enabled: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        fastModel: 'claude-haiku-5-5',
        apiKey: 'sk-test-key',
        allowedRoles: ['MODELER', 'REVIEWER', 'SUPER_ADMIN'],
        userDailyLimit: 0,
        orgMonthlyLimit: 0,
        noticeEn: '',
        noticeAr: '',
      })
      .expect(200);
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');

    const role = await ctx.prisma.repoObject.create({
      data: { type: 'ROLE', nameEn: 'HR Officer', nameAr: 'موظف الموارد البشرية' },
    });
    await ctx.prisma.repoObject.create({
      data: { type: 'ROLE', nameEn: 'Finance Manager', nameAr: 'المدير المالي' },
    });
    processId = (
      await ctx.prisma.process.create({
        data: {
          code: 'S.09',
          nameEn: 'Employee Onboarding',
          nameAr: 'تهيئة الموظف',
          descriptionEn: 'From offer to first week.',
          category: 'SUPPORT',
        },
      })
    ).id;
    xml = structureToBpmn(ONBOARDING, { key: 'v1' });
    await modeler.put(`/processes/${processId}/model`).send({ bpmnXml: xml }).expect(200);
    await modeler
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Record', repoObjectId: role.id, relation: 'PERFORMS' })
      .expect(201);
  });

  describe('refine with chat', () => {
    it('applies an instruction as a reviewable proposal, keeping ids', async () => {
      ctx.ai.reply(ONBOARDING_REFINED);
      const { result } = await stream(modeler, '/ai/refine-process', {
        processId,
        bpmnXml: xml,
        instruction: 'Add an approval step by the finance manager after step 2',
        language: 'en',
        history: [
          { role: 'user', text: 'Rename the lanes' },
          { role: 'assistant', text: 'Done.' },
        ],
      });
      expect(result.bpmnXml).toContain('Task_FinApprove');
      expect(result.bpmnXml).toContain('Lane_FIN');
      expect(result.bpmnXml).toContain('id="Task_Record"');
      expect(result.explanation).toContain('finance manager');
      // Flow ids of unchanged connections are reused.
      const flowId = /id="(Flow_[^"]+)" sourceRef="Start" targetRef="Task_Record"/.exec(xml)![1];
      expect(result.bpmnXml).toContain(`id="${flowId}" sourceRef="Start"`);
      // The process and pool keep their ids, so the visual compare matches them.
      for (const id of ['Process_v1', 'Participant_v1', 'Collaboration_v1', 'Definitions_v1'])
        expect(result.bpmnXml).toContain(`id="${id}"`);
      // Links are only proposed for new elements.
      expect(
        result.suggestedLinks.map((l: { elementId: string; object: { nameEn: string } }) => [
          l.elementId,
          l.object.nameEn,
        ]),
      ).toEqual([['Task_FinApprove', 'Finance Manager']]);
      expect(result.dropped).toBe(0);
      // The model saw the history, the current structure and the instruction.
      const req = ctx.ai.requests[0];
      expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(lastPrompt()).toContain('"id":"Task_Record"');
      expect(lastPrompt()).toContain('finance manager after step 2');
      expect(lastPrompt()).toContain('"nameEn":"Employee Onboarding"');
      // Nothing was saved.
      const model = (await modeler.get(`/processes/${processId}/model`).expect(200)).body;
      expect(model.bpmnXml).toBe(xml);
      expect((await ctx.prisma.aiUsage.findFirstOrThrow()).feature).toBe('REFINE_PROCESS');
    });

    it('reports elements it cannot carry and needs edit rights', async () => {
      const withNote = xml.replace(
        '</bpmn:process>',
        '<bpmn:textAnnotation id="Note_1"><bpmn:text>Hi</bpmn:text></bpmn:textAnnotation></bpmn:process>',
      );
      ctx.ai.reply(ONBOARDING);
      const { result } = await stream(modeler, '/ai/refine-process', {
        processId,
        bpmnXml: withNote,
        instruction: 'Rename nothing',
        language: 'en',
      });
      expect(result.dropped).toBe(1);
      await reviewer
        .post('/ai/refine-process')
        .send({ processId, bpmnXml: xml, instruction: 'Add a step', language: 'en' })
        .expect(403);
      await modeler
        .post('/ai/refine-process')
        .send({ processId, bpmnXml: '<!DOCTYPE x><x/>', instruction: 'Add a step', language: 'en' })
        .expect(400);
    });
  });

  describe('documentation ↔ process', () => {
    it('writes an SOP from the process with its links, sanitised and embedding the diagram', async () => {
      ctx.ai.reply({
        titleEn: 'Employee Onboarding — SOP',
        titleAr: 'إجراء تهيئة الموظف',
        htmlEn:
          '<h2>1. Purpose</h2><p>Onboard staff.</p><script>alert(1)</script><p style="x" onclick="y">ok</p>',
        htmlAr: '<h2>١. الغرض</h2><p>تهيئة الموظفين.</p>',
      });
      const { result } = await stream(modeler, '/ai/generate-doc', {
        processId,
        template: 'SOP',
        instructions: 'For new employees',
      });
      expect(result.titleEn).toBe('Employee Onboarding — SOP');
      expect(result.contentEn).toMatch(
        new RegExp(
          `^<div data-type="bpmn-diagram" data-process-id="${processId}"></div><h2>1. Purpose</h2>`,
        ),
      );
      expect(result.contentEn).not.toMatch(/script|onclick|style=/);
      expect(result.contentAr).toContain('<h2>١. الغرض</h2>');
      const prompt = lastPrompt();
      expect(prompt).toContain('S.09 Employee Onboarding');
      expect(prompt).toContain('role HR Officer / موظف الموارد البشرية (PERFORMS)');
      expect(prompt).toContain('performed by HR Officer');
      expect(prompt).toContain('For new employees');
      await reviewer.post('/ai/generate-doc').send({ processId, template: 'SOP' }).expect(403);
    });

    it('drafts a process from a page the user can read', async () => {
      const space = await ctx.prisma.space.create({
        data: { key: 'QM', nameEn: 'Quality', viewRestricted: false },
      });
      const page = await ctx.prisma.page.create({
        data: {
          spaceId: space.id,
          titleEn: 'Onboarding procedure',
          contentEn: '<h2>Steps</h2><p>HR creates the record. IT prepares the laptop.</p>',
          contentAr: '',
          version: 1,
        },
      });
      ctx.ai.reply(ONBOARDING);
      const { result } = await stream(modeler, '/ai/doc-to-process', {
        pageId: page.id,
        language: 'ar',
      });
      expect(result.counts.lanes).toBe(3);
      // The Arabic version is empty, so the English text was used.
      expect(lastPrompt()).toContain('HR creates the record.');
      expect(lastPrompt()).toContain('Write the explanation in Arabic');
      await reviewer
        .post('/ai/doc-to-process')
        .send({ pageId: page.id, language: 'en' })
        .expect(403);

      const closed = await ctx.prisma.space.create({
        data: { key: 'HR', nameEn: 'HR', viewRestricted: true },
      });
      const secret = await ctx.prisma.page.create({
        data: { spaceId: closed.id, titleEn: 'Secret', contentEn: '<p>x</p>', version: 1 },
      });
      const res = await modeler
        .post('/ai/doc-to-process')
        .send({ pageId: secret.id, language: 'en' });
      expect([403, 404]).toContain(res.status);
    });

    it('does not send imported documents while "AI on imported documents" is off (SEC-35)', async () => {
      const space = await ctx.prisma.space.create({ data: { key: 'IMP', nameEn: 'Imported' } });
      const batch = await ctx.prisma.importBatch.create({ data: { kind: 'WORD' } });
      const page = await ctx.prisma.page.create({
        data: {
          spaceId: space.id,
          titleEn: 'Imported SOP',
          contentEn: '<p>Confidential imported text.</p>',
          version: 1,
          importBatchId: batch.id,
        },
      });
      const before = ctx.ai.requests.length;
      const res = await modeler
        .post('/ai/doc-to-process')
        .send({ pageId: page.id, language: 'en' })
        .expect(403);
      expect(res.body.code).toBe('AI_IMPORTS_DISABLED');
      await ctx.prisma.process.update({
        where: { id: processId },
        data: { importBatchId: batch.id },
      });
      const sum = await modeler
        .post('/ai/summarise')
        .send({ type: 'PROCESS', id: processId, language: 'en' })
        .expect(403);
      expect(sum.body.code).toBe('AI_IMPORTS_DISABLED');
      expect(ctx.ai.requests.length).toBe(before);
      await ctx.prisma.process.update({ where: { id: processId }, data: { importBatchId: null } });
    });
  });

  describe('summaries', () => {
    it('summarises the current process (streamed, fast model)', async () => {
      ctx.ai.reply('Onboards new staff.\n- HR creates the record\n- IT prepares accounts');
      const { events, result } = await stream(modeler, '/ai/summarise', {
        type: 'PROCESS',
        id: processId,
        language: 'en',
      });
      expect(events.filter((e) => e.event === 'delta').length).toBeGreaterThan(0);
      expect(result).toMatchObject({ kind: 'SUMMARY', noChanges: false });
      expect(result.text).toContain('HR creates the record');
      expect(ctx.ai.requests[0].model).toBe('claude-haiku-5-5');
      expect(lastPrompt()).toContain('Step 1 [Task_Record] Create employee record');
    });

    it('explains what changed between versions, and skips the AI when nothing did', async () => {
      await modeler
        .post(`/processes/${processId}/versions`)
        .send({ bpmnXml: xml, changeNote: 'v1' })
        .expect(201);
      const v2 = structureToBpmn(ONBOARDING_REFINED, { key: 'v2' });
      await modeler
        .post(`/processes/${processId}/versions`)
        .send({ bpmnXml: v2, changeNote: 'v2' })
        .expect(201);
      ctx.ai.reply('A finance approval was added.\n- New step: Approve equipment budget');
      const { result } = await stream(reviewer, '/ai/summarise', {
        type: 'PROCESS',
        id: processId,
        language: 'en',
        compare: { from: 1, to: 2 },
      });
      expect(result).toMatchObject({ kind: 'CHANGES', from: 1, to: 2, noChanges: false });
      const prompt = lastPrompt();
      expect(prompt).toContain('Lane added: Finance Manager / المدير المالي');
      expect(prompt).toContain('Added userTask: Approve equipment budget');
      expect(prompt).toContain('Removed connection: Create user accounts');
      expect(ctx.ai.requests[0].model).toBe('claude-sonnet-5-5');

      await modeler
        .post(`/processes/${processId}/versions`)
        .send({ bpmnXml: v2, changeNote: 'same' })
        .expect(201);
      const same = await stream(reviewer, '/ai/summarise', {
        type: 'PROCESS',
        id: processId,
        language: 'ar',
        compare: { from: 2, to: 3 },
      });
      expect(same.result).toMatchObject({ noChanges: true, text: '' });
      expect(ctx.ai.requests).toHaveLength(1);
      await reviewer
        .post('/ai/summarise')
        .send({ type: 'PROCESS', id: processId, language: 'en', compare: { from: 3, to: 2 } })
        .expect(400);
    });

    it('summarises page changes and respects space restrictions', async () => {
      const space = await ctx.prisma.space.create({ data: { key: 'IT', nameEn: 'IT' } });
      const page = await ctx.prisma.page.create({
        data: { spaceId: space.id, titleEn: 'Laptop policy', contentEn: '<p>B</p>', version: 2 },
      });
      const v = {
        titleEn: 'Laptop policy',
        titleAr: '',
        contentAr: '',
        dirEn: 'ltr',
        dirAr: 'rtl',
        changeNote: 'x',
      };
      await ctx.prisma.pageVersion.createMany({
        data: [
          { ...v, pageId: page.id, versionNumber: 1, contentEn: '<p>A</p><p>Keep</p>' },
          { ...v, pageId: page.id, versionNumber: 2, contentEn: '<p>B</p><p>Keep</p>' },
        ],
      });
      ctx.ai.reply('The rule changed from A to B.');
      const { result } = await stream(modeler, '/ai/summarise', {
        type: 'PAGE',
        id: page.id,
        language: 'en',
        compare: { from: 1, to: 2 },
      });
      expect(result.text).toBe('The rule changed from A to B.');
      expect(lastPrompt()).toContain('- A\n+ B');
      expect(lastPrompt()).not.toContain('- Keep');

      await ctx.prisma.space.update({ where: { id: space.id }, data: { viewRestricted: true } });
      await modeler
        .post('/ai/summarise')
        .send({ type: 'PAGE', id: page.id, language: 'en' })
        .expect(404);
    });
  });
});
