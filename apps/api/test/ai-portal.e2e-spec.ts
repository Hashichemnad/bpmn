import { structureToBpmn } from '../src/ai/bpmn/structure-to-bpmn';
import { ONBOARDING } from './fixtures/ai-structures';
import {
  createApp,
  createUser,
  loggedIn,
  parseSse,
  resetDb,
  type Client,
  type TestContext,
} from './helpers';

/**
 * AI assistant part C: analyse & improve, and the Knowledge Portal Q&A, which must only ever
 * use current publications the asking user may see.
 */
describe('AI analyse and portal Q&A (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: Client;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let viewer: Client;
  let ids: Record<string, string>;
  let processId: string;
  let spaces: Record<string, string>;
  let pages: Record<string, string>;

  const stream = async (c: Client, path: string, body: object) => {
    const res = await c.post(path).send(body).expect(200);
    const events = parseSse(res.text);
    const last = events[events.length - 1];
    return { events, last, result: last?.event === 'result' ? last.data : null };
  };
  const prompt = () => {
    const req = ctx.ai.requests[ctx.ai.requests.length - 1];
    return req.messages[req.messages.length - 1].text;
  };
  const aiSettings = (allowedRoles: string[]) =>
    superAdmin
      .put('/ai/settings')
      .send({
        enabled: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        fastModel: 'claude-haiku-5-5',
        apiKey: 'sk-test-key',
        allowedRoles,
        userDailyLimit: 0,
        orgMonthlyLimit: 0,
        noticeEn: '',
        noticeAr: '',
      })
      .expect(200);

  const publish = async (type: 'processes' | 'pages', id: string, label = 'v1.0') => {
    await modeler.post(`/governance/${type}/${id}/submit`).send({}).expect(200);
    const review = (await reviewer.get('/tasks').expect(200)).body.reviews.find(
      (r: { item: { entityId: string } }) => r.item.entityId === id,
    );
    await reviewer.post(`/reviews/${review.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    await modeler
      .post(`/governance/${type}/${id}/publish`)
      .send({ versionLabel: label })
      .expect(200);
  };
  const page = async (spaceId: string, titleEn: string, html: string) => {
    const id = (
      await modeler.post(`/spaces/${spaceId}/pages`).send({ titleEn, titleAr: titleEn }).expect(201)
    ).body.id as string;
    await modeler
      .put(`/pages/${id}`)
      .send({ titleEn, titleAr: titleEn, contentEn: html, contentAr: '', changeNote: 'v1' })
      .expect(200);
    return id;
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
    await aiSettings(['MODELER', 'REVIEWER', 'VIEWER', 'ADMIN']);

    const wf = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Review',
          steps: [{ nameEn: 'Review', assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }] }],
        })
        .expect(201)
    ).body.id;
    await admin
      .put('/governance/settings')
      .send({
        reviewIntervalMonths: 12,
        reminderDays: 14,
        reviewDueDays: 5,
        defaultWorkflowId: wf,
        categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
      })
      .expect(200);

    processId = (
      await admin
        .post('/processes')
        .send({
          code: 'S.09',
          nameEn: 'Employee Onboarding',
          nameAr: 'تهيئة الموظف',
          category: 'SUPPORT',
        })
        .expect(201)
    ).body.id;
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: structureToBpmn(ONBOARDING, { key: 'p' }), changeNote: 'v1' })
      .expect(201);

    spaces = {
      open: (await admin.post('/spaces').send({ key: 'IT', nameEn: 'IT Policies' }).expect(201))
        .body.id,
      closed: (await admin.post('/spaces').send({ key: 'HR', nameEn: 'HR Private' }).expect(201))
        .body.id,
    };
    pages = {
      laptop: await page(
        spaces.open,
        'Requesting IT equipment',
        '<p>To request a new laptop, open a ticket in the IT Service Desk portal under Hardware. Your line manager approves the request.</p>',
      ),
      draft: await page(
        spaces.open,
        'Draft laptop allowance',
        '<p>Secret draft: every employee gets a laptop budget of 9999.</p>',
      ),
      closed: await page(
        spaces.closed,
        'Executive laptop policy',
        '<p>Restricted: executives receive premium laptops.</p>',
      ),
    };
    await publish('pages', pages.laptop);
    await publish('pages', pages.closed);
    await publish('processes', processId);
    // Restricted after publishing: only the owner, managers and grantees may see it.
    await admin
      .put(`/spaces/${spaces.closed}/permissions`)
      .send({ viewRestricted: true, editRestricted: false, grants: [] })
      .expect(200);
  });

  describe('analyse & improve', () => {
    it('returns findings and plain-language warnings, dropping unknown element ids', async () => {
      ctx.ai.reply({
        summary: 'A clear flow with one missing control.',
        findings: [
          {
            kind: 'CONTROL',
            severity: 'HIGH',
            title: 'No approval before accounts are created',
            explanation: 'IT acts without a confirmed hire.',
            suggestion: 'Add an HR approval before "Create user accounts".',
            elementIds: ['Task_Accounts', 'Task_DoesNotExist'],
          },
        ],
        warnings: [
          {
            code: 'UNNAMED_ACTIVITY',
            elementId: 'Task_Laptop',
            explanation: 'Give the step a name.',
          },
          { code: 'NO_END_EVENT', elementId: '', explanation: 'Add an end event.' },
        ],
      });
      const { result } = await stream(modeler, '/ai/analyse', {
        processId,
        language: 'en',
        warnings: [
          { code: 'UNNAMED_ACTIVITY', elementId: 'Task_Laptop', elementName: 'Prepare laptop' },
        ],
        focus: 'Approval controls',
      });
      expect(result.findings[0]).toMatchObject({ kind: 'CONTROL', elementIds: ['Task_Accounts'] });
      expect(result.warnings).toEqual([
        {
          code: 'UNNAMED_ACTIVITY',
          elementId: 'Task_Laptop',
          explanation: 'Give the step a name.',
        },
        { code: 'NO_END_EVENT', elementId: null, explanation: 'Add an end event.' },
      ]);
      expect(prompt()).toContain('UNNAMED_ACTIVITY on [Task_Laptop] "Prepare laptop"');
      expect(prompt()).toContain('Approval controls');
      expect(prompt()).toContain('Step 1 [Task_Record]');
      // Viewers are portal-only: workspace processes cannot be analysed.
      await viewer.post('/ai/analyse').send({ processId, language: 'en' }).expect(403);
    });

    it('asks once to fix an invalid analysis', async () => {
      ctx.ai.reply(
        { summary: 'x', findings: [{ kind: 'NONSENSE' }], warnings: [] },
        { summary: 'Fine.', findings: [], warnings: [] },
      );
      const { result } = await stream(reviewer, '/ai/analyse', { processId, language: 'ar' });
      expect(result).toEqual({ summary: 'Fine.', findings: [], warnings: [] });
      expect(ctx.ai.requests).toHaveLength(2);
    });
  });

  describe('portal Q&A', () => {
    it('answers from published content only, with cited sources', async () => {
      ctx.ai.reply(
        'Open a ticket in the IT Service Desk portal under Hardware [1]. Your line manager approves it [1].',
      );
      const { events, result } = await stream(viewer, '/ai/portal/ask', {
        question: 'How do I request a new laptop?',
        language: 'en',
      });
      expect(events.some((e) => e.event === 'delta')).toBe(true);
      expect(result).toMatchObject({
        answered: true,
        answer: expect.stringContaining('IT Service Desk'),
        sources: [
          {
            ref: 1,
            type: 'PAGE',
            id: pages.laptop,
            titleEn: 'Requesting IT equipment',
            versionLabel: 'v1.0',
          },
        ],
      });
      const text = prompt();
      expect(text).toContain(
        '<source n="1" type="document" title="Requesting IT equipment" version="v1.0">',
      );
      // Never drafts, never restricted spaces the viewer cannot see.
      expect(text).not.toContain('9999');
      expect(text).not.toContain('premium');
      expect(text).not.toContain('Draft laptop allowance');
      const usage = await ctx.prisma.aiUsage.findFirstOrThrow({ where: { feature: 'PORTAL_QA' } });
      expect(usage.userId).toBe(ids.viewer);
    });

    it('a user with a grant on the restricted space gets that content too', async () => {
      await admin
        .put(`/spaces/${spaces.closed}/permissions`)
        .send({
          viewRestricted: true,
          editRestricted: false,
          grants: [{ principalType: 'USER', principalId: ids.viewer, access: 'VIEW' }],
        })
        .expect(200);
      ctx.ai.reply('Executives receive premium laptops [2].');
      await stream(viewer, '/ai/portal/ask', {
        question: 'Which laptop do executives get?',
        language: 'en',
      });
      expect(prompt()).toContain('premium');
    });

    it('uses the published process version, not the working copy', async () => {
      await modeler
        .put(`/processes/${processId}/model`)
        .send({
          bpmnXml: structureToBpmn(
            {
              ...ONBOARDING,
              nodes: ONBOARDING.nodes.map((n) =>
                n.id === 'Task_Welcome' ? { ...n, nameEn: 'SECRET DRAFT STEP' } : n,
              ),
            },
            { key: 'p' },
          ),
        })
        .expect(200);
      ctx.ai.reply('HR creates the employee record [1].');
      const { result } = await stream(viewer, '/ai/portal/ask', {
        question: 'What happens when a new employee is onboarded?',
        language: 'en',
      });
      expect(result.sources.map((s: { id: string }) => s.id)).toContain(processId);
      expect(prompt()).toContain('Welcome the new employee');
      expect(prompt()).not.toContain('SECRET DRAFT STEP');
    });

    it('says so when the content has no answer', async () => {
      // Nothing matches: no AI call at all.
      const none = await stream(viewer, '/ai/portal/ask', {
        question: 'Parking xyzzy',
        language: 'en',
      });
      expect(none.result).toEqual({ answer: '', answered: false, sources: [] });
      expect(ctx.ai.requests).toHaveLength(0);
      // Something matches but does not answer: the model says so, no sources are shown.
      ctx.ai.reply('[[NOT_FOUND]] The published content does not cover laptop colours.');
      const { result } = await stream(viewer, '/ai/portal/ask', {
        question: 'Which colour is the new laptop?',
        language: 'en',
      });
      expect(result).toEqual({
        answer: 'The published content does not cover laptop colours.',
        answered: false,
        sources: [],
      });
    });

    it('respects portal access and AI roles', async () => {
      await aiSettings(['MODELER']);
      const res = await viewer
        .post('/ai/portal/ask')
        .send({ question: 'How do I request a new laptop?', language: 'en' })
        .expect(403);
      expect(res.body.code).toBe('AI_NOT_ALLOWED');
      await aiSettings(['VIEWER', 'MODELER']);
      await admin
        .put('/portal/settings')
        .send({ access: { mode: 'RESTRICTED', departmentIds: [], roleKeys: ['MODELER'] } })
        .expect(200);
      await viewer
        .post('/ai/portal/ask')
        .send({ question: 'How do I request a new laptop?', language: 'en' })
        .expect(403);
      expect(ctx.ai.requests).toHaveLength(0);
    });
  });
});
