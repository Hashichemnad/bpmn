import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  waitJob,
  type Client,
  type TestContext,
} from './helpers';
import { applyBatch, upload } from './imports-fixtures';
import { ONBOARDING } from './fixtures/ai-structures';

const SAMPLES = join(__dirname, '../../../docs/samples/import');
const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });

/** Import tools step 5: AI-assisted migration with a mocked provider (proposals only). */
describe('Import Center — AI-assisted migration (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let spaceId: string;
  let batchId: string;

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
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    await superAdmin
      .put('/ai/settings')
      .send({
        enabled: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        fastModel: 'claude-haiku-5-5',
        apiKey: 'sk-test-key',
        allowedRoles: ['ADMIN', 'SUPER_ADMIN'],
        userDailyLimit: 0,
        orgMonthlyLimit: 0,
        noticeEn: '',
        noticeAr: '',
      })
      .expect(200);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    spaceId = (await ctx.prisma.space.create({ data: { key: 'QM', nameEn: 'Quality' } })).id;
    const b = await upload(admin, 'WORD', [sample('C.01.01 SOP Handle enquiries (EN).docx')], {
      spaceId,
    });
    await applyBatch(admin, b.id);
    batchId = b.id;
  });

  const run = async (kind: string) => {
    const res = (await admin.post('/migration-ai/run').send({ kind, batchId }).expect(202)).body;
    const job = await waitJob(admin, res.jobId);
    expect(job.status).toBe('DONE');
    return (await admin.get(`/migration-ai/proposals?kind=${kind}&status=PENDING`).expect(200)).body
      .items;
  };

  it('drafts BPMN from an imported SOP into the review queue; accept creates a draft AI process linked to the page', async () => {
    ctx.ai.queue.push(ONBOARDING);
    const [proposal] = await run('SOP_TO_BPMN');
    expect(proposal).toMatchObject({ kind: 'SOP_TO_BPMN', sourceType: 'PAGE', status: 'PENDING' });
    expect(ctx.ai.requests[0].messages[0].text).toContain('Receive the enquiry');
    const detail = (await admin.get(`/migration-ai/proposals/${proposal.id}`).expect(200)).body;
    expect(detail.payload.bpmnXml).toContain('bpmn:definitions');
    // Nothing exists before a person accepts it.
    expect(await ctx.prisma.process.count()).toBe(0);
    const accepted = (
      await admin.post(`/migration-ai/proposals/${proposal.id}/accept`).send({}).expect(200)
    ).body;
    expect(accepted.status).toBe('ACCEPTED');
    const process = await ctx.prisma.process.findFirstOrThrow({
      include: { model: true, pageLinks: true },
    });
    expect(process).toMatchObject({ status: 'DRAFT', aiGenerated: true });
    expect(process.pageLinks).toHaveLength(1);
    await admin.post(`/migration-ai/proposals/${proposal.id}/accept`).send({}).expect(409);
    const usage = await ctx.prisma.aiUsage.findMany();
    expect(usage.map((u) => u.feature)).toEqual(['DOC_TO_PROCESS']);
  });

  it('extracts risks and controls as GRC drafts linked to the page', async () => {
    ctx.ai.queue.push({
      risks: [
        {
          nameEn: 'Enquiries not answered in time',
          nameAr: 'عدم الرد على الاستفسارات في الوقت المحدد',
          descriptionEn: '',
          descriptionAr: '',
          likelihood: 3,
          impact: 4,
          quote: 'Risk: enquiries are not answered in time.',
        },
      ],
      controls: [
        {
          nameEn: 'Daily review of open enquiries',
          nameAr: 'مراجعة يومية للاستفسارات المفتوحة',
          descriptionEn: '',
          descriptionAr: '',
          risks: [0],
          quote: 'the supervisor reviews open enquiries every morning',
        },
      ],
    });
    const [proposal] = await run('EXTRACT_GRC');
    await admin.post(`/migration-ai/proposals/${proposal.id}/accept`).send({}).expect(200);
    const risk = await ctx.prisma.repoObject.findFirstOrThrow({
      where: { type: 'RISK' },
      include: { risk: true, pageLinks: true },
    });
    expect(risk.risk).toMatchObject({ status: 'DRAFT', inherentLikelihood: 3, inherentImpact: 4 });
    expect(risk.pageLinks).toHaveLength(1);
    const control = await ctx.prisma.repoObject.findFirstOrThrow({
      where: { type: 'CONTROL' },
      include: { control: { include: { risks: true } } },
    });
    expect(control.control!.risks).toHaveLength(1);
    expect(await ctx.prisma.aiUsage.count({ where: { feature: 'EXTRACT_GRC' } })).toBe(1);
  });

  it('translates the missing language of imported pages for a human check; reject keeps the item unchanged', async () => {
    const page = await ctx.prisma.page.findFirstOrThrow({ where: { spaceId } });
    ctx.ai.queue.push({
      items: [
        { key: 'titleAr', text: 'معالجة الاستفسارات' },
        { key: 'contentAr', text: '<p dir="rtl">نص مترجم</p><script>x</script>' },
      ],
    });
    const [proposal] = await run('TRANSLATE');
    expect(proposal.status).toBe('PENDING');
    const detail = (await admin.get(`/migration-ai/proposals/${proposal.id}`).expect(200)).body;
    expect(detail.payload).toMatchObject({ kind: 'TRANSLATE', target: 'ar' });
    await admin.post(`/migration-ai/proposals/${proposal.id}/accept`).send({}).expect(200);
    const after = await ctx.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(after).toMatchObject({ titleAr: 'معالجة الاستفسارات', aiGenerated: true, version: 2 });
    expect(after.contentAr).toContain('نص مترجم');
    expect(after.contentAr).not.toContain('script');

    ctx.ai.queue.push({ items: [{ key: 'titleAr', text: 'x' }] });
    await ctx.prisma.page.update({ where: { id: page.id }, data: { titleAr: '', contentAr: '' } });
    const [second] = await run('TRANSLATE');
    await admin.post(`/migration-ai/proposals/${second.id}/reject`).expect(200);
    expect((await ctx.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).titleAr).toBe('');
  });

  it('respects permissions, AI settings and usage limits', async () => {
    await modeler.post('/migration-ai/run').send({ kind: 'TRANSLATE', batchId }).expect(403);
    await modeler.get('/migration-ai/proposals').expect(403);
    await ctx.prisma.setting.update({
      where: { key: 'ai' },
      data: {
        value: {
          ...((await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'ai' } }))
            .value as object),
          userDailyLimit: 1,
        },
      },
    });
    ctx.ai.queue.push({ items: [] });
    const first = (
      await admin.post('/migration-ai/run').send({ kind: 'TRANSLATE', batchId }).expect(202)
    ).body;
    await waitJob(admin, first.jobId);
    expect(
      (await admin.post('/migration-ai/run').send({ kind: 'TRANSLATE', batchId }).expect(429)).body
        .code,
    ).toBe('AI_USER_LIMIT');
  });
});
