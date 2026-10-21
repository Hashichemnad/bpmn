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
    expect(await ctx.prisma.page.count()).toBe(8);
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
  });
});
