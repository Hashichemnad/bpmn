import { VOLUME_PASSWORD, seedVolume } from '../prisma/seed-volume';
import { createApp, loggedIn, resetDb, type TestContext } from './helpers';

/**
 * The volume seed (final session, part A) at 1 % scale: keeps the script working when the schema
 * changes and checks that the seeded data is usable through the API.
 */
describe('Volume seed (e2e, 1 % scale)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates every kind of data and the API serves it', async () => {
    const counts = await seedVolume(ctx.prisma as never, {
      scale: 0.01,
      skip: new Set(),
      log: () => undefined,
      appContext: async () => ({ get: (t) => ctx.app.get(t), close: async () => undefined }),
    });
    for (const key of [
      'users',
      'processes',
      'publications',
      'pages',
      'risks',
      'controls',
      'controlTests',
      'kpiMeasurements',
      'importBatches',
      'miningEvents',
      'workflowCases',
    ])
      expect(counts[key]).toBeGreaterThan(0);
    await expect(
      seedVolume(ctx.prisma as never, { scale: 0.01, skip: new Set(), log: () => undefined }),
    ).rejects.toThrow('already holds volume data');

    const admin = await loggedIn(ctx.app, 'user0@volume.local', VOLUME_PASSWORD);
    expect((await admin.get('/processes/tree').expect(200)).body.length).toBeGreaterThan(10);
    expect((await admin.get('/grc/risks?page=1&pageSize=5').expect(200)).body.total).toBe(
      counts.risks,
    );
    await admin.get('/portal/home').expect(200);
    await admin.get('/workflow/dashboard').expect(200);
    await admin.get('/assurance/dashboard').expect(200);
    await admin.get('/kpis/scorecard').expect(200);
  });
});
