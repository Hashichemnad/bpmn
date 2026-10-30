import { main as runSeed } from '../prisma/seed';
import { createApp, resetDb, type TestContext } from './helpers';

describe('Seed (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates demo documentation once and is idempotent', async () => {
    await resetDb(ctx.prisma);
    Object.assign(process.env, {
      SEED_ADMIN_EMAIL: 'seed-admin@test.local',
      SEED_ADMIN_PASSWORD: 'Seed-Password1',
      SEED_DEMO_DATA: 'true',
    });
    await runSeed();
    await runSeed();

    expect(await ctx.prisma.pageTemplate.count({ where: { isSystem: true } })).toBe(6);
    const spaces = await ctx.prisma.space.findMany({ orderBy: { key: 'asc' } });
    expect(spaces.map((s) => s.key)).toEqual(['ITP', 'QM']);
    // 8 documentation demo pages + the published IT equipment page for the portal assistant.
    expect(await ctx.prisma.page.count()).toBe(9);
    const equipment = await ctx.prisma.publication.findFirstOrThrow({
      where: { titleEn: 'Requesting IT Equipment', current: true },
    });
    expect(equipment.textEn).toContain('IT Service Desk');
    const req = await ctx.prisma.page.findFirstOrThrow({
      where: { titleEn: 'Purchase Requisition Procedure' },
      include: { versions: true, links: true },
    });
    expect(req.version).toBe(3);
    expect(req.versions).toHaveLength(3);
    expect(req.versions.find((v) => v.versionNumber === 3)?.label).toBe(
      'v1.0 – approved by committee',
    );
    expect(req.links.some((l) => l.embedded)).toBe(true);
    const pr = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'S.01.01' },
      include: { versions: true },
    });
    expect(pr.versions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);

    // Arabic and English content is searchable
    const hits = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Page" WHERE "searchVector" @@ (to_tsquery('arabic', 'الميزانية:*') || to_tsquery('english', 'budget:*'))`;
    expect(Number(hits[0].n)).toBeGreaterThan(0);

    // Phase 3: demo users, workflows and every lifecycle state.
    const demo = await ctx.prisma.user.findMany({
      where: { email: { endsWith: '@processhub.local' } },
      include: { roles: { include: { role: true } } },
    });
    expect(demo.map((u) => [u.email, u.roles[0].role.key]).sort()).toEqual([
      ['audit@processhub.local', 'INTERNAL_AUDIT'],
      ['auditor@processhub.local', 'AUDITOR'],
      ['modeler@processhub.local', 'MODELER'],
      ['owner@processhub.local', 'PROCESS_OWNER'],
      ['reviewer@processhub.local', 'REVIEWER'],
      ['risk@processhub.local', 'RISK_OFFICER'],
      ['viewer@processhub.local', 'VIEWER'],
    ]);
    // Phase 4.1: risks, controls and requirements linked to steps, incl. a critical residual
    // risk without an effective control.
    // Phase 4.2: test plans with a failed test → issue, an engagement with two findings, an RCSA campaign.
    expect(await ctx.prisma.controlTestPlan.count()).toBe(2);
    expect(await ctx.prisma.controlTest.count({ where: { conclusion: 'NOT_EFFECTIVE' } })).toBe(1);
    expect(await ctx.prisma.issue.count()).toBe(2);
    expect(await ctx.prisma.auditFinding.count()).toBe(2);
    expect(await ctx.prisma.surveyProposal.count({ where: { status: 'PENDING' } })).toBe(4);
    expect(await ctx.prisma.risk.count()).toBe(10);
    expect(await ctx.prisma.control.count()).toBe(12);
    expect(await ctx.prisma.requirement.count()).toBe(6);
    const uncovered = await ctx.prisma.risk.findFirstOrThrow({
      where: { object: { code: 'RSK-02' } },
      include: { controls: { include: { control: true } } },
    });
    expect(uncovered.residualLikelihood! * uncovered.residualImpact!).toBeGreaterThanOrEqual(16);
    expect(uncovered.controls.every((c) => c.control.effectiveness === 'NOT_ASSESSED')).toBe(true);
    // Two demo workflows + the base "GRC change approval" workflow (D-106).
    expect(await ctx.prisma.workflow.count()).toBe(3);
    // AI assistant: suggestion chips for the demo, disabled until a key is entered.
    const ai = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'ai' } });
    expect(ai.value).toMatchObject({ enabled: false, apiKeySealed: null });
    expect(Object.keys((ai.value as { suggestions: object }).suggestions)).toHaveLength(6);
    const statuses = (await ctx.prisma.process.findMany()).map((p) => p.status);
    for (const s of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] as const) {
      expect(statuses).toContain(s);
    }
    expect((await ctx.prisma.page.findMany()).map((p) => p.status)).toEqual(
      expect.arrayContaining(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED']),
    );
    const reqPub = await ctx.prisma.publication.findFirstOrThrow({
      where: { code: 'S.01.01', current: true },
      include: { links: true },
    });
    expect(reqPub.versionNumber).toBe(1);
    expect(reqPub.links.length).toBeGreaterThan(0);
    expect(await ctx.prisma.review.count({ where: { status: 'CHANGES_REQUESTED' } })).toBe(1);
    expect(await ctx.prisma.reviewTask.count({ where: { status: 'PENDING' } })).toBeGreaterThan(1);
    const overdue = await ctx.prisma.process.findFirstOrThrow({ where: { code: 'M.01' } });
    expect(overdue.nextReviewAt!.getTime()).toBeLessThan(Date.now());
    expect(await ctx.prisma.comment.count()).toBeGreaterThan(2);
    expect(await ctx.prisma.notification.count()).toBeGreaterThan(5);
    expect(await ctx.prisma.feedback.count()).toBe(2);
    expect(await ctx.prisma.setting.findUnique({ where: { key: 'portal' } })).not.toBeNull();
    // Dictionary (B2): approved bilingual terms with synonyms and one proposal.
    const terms = await ctx.prisma.repoObject.findMany({ where: { type: 'TERM' } });
    expect(terms.filter((t) => t.status === 'APPROVED')).toHaveLength(5);
    expect(terms.filter((t) => t.status === 'DRAFT').map((t) => t.nameEn)).toEqual([
      'Steering committee',
    ]);
    expect(terms.every((t) => t.nameEn && t.nameAr)).toBe(true);
  });
});
