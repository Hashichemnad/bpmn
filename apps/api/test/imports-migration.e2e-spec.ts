import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';
import { applyBatch, binary, upload } from './imports-fixtures';

const SAMPLES = join(__dirname, '../../../docs/samples/import');
const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });

/** Import tools step 6: migration dashboard, review queue bulk actions, owners' imported drafts. */
describe('Import Center — migration tracker (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let owner: Client;
  let ownerId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    ownerId = (await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'])).id;
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    await applyBatch(admin, (await upload(admin, 'DEPARTMENTS', [sample('departments.xlsx')])).id);
    await applyBatch(
      admin,
      (await upload(admin, 'PROCESS_HOUSE', [sample('process-house.xlsx')])).id,
    );
    await applyBatch(admin, (await upload(admin, 'BPMN', [sample('bpmn-diagrams.zip')])).id);
  });

  it('counts imported content per department and branch with its problems; exports Excel', async () => {
    const d = (await admin.get('/migration/dashboard').expect(200)).body;
    expect(d.totals).toMatchObject({ total: 9, draft: 9, noOwner: 9 });
    expect(d.totals.missingAr).toBe(0);
    const core = d.branches.find((b: { code: string }) => b.code === 'C');
    expect(core.counts.total).toBe(4);
    const csd = d.departments.find((g: { nameEn: string }) => g.nameEn === 'Customer Services');
    expect(csd.counts.total).toBe(3);
    expect(d.byType.PROCESS.total).toBe(9);
    expect(d.batches).toMatchObject({ total: 3, applied: 3 });
    // Processes without a diagram are listed as such.
    const noModel = (await admin.get('/migration/items?problem=NO_MODEL&pageSize=100').expect(200))
      .body;
    expect(noModel.total).toBe(6);
    const all = (await admin.get('/migration/dashboard?scope=ALL').expect(200)).body;
    expect(all.totals.total).toBeGreaterThanOrEqual(9);
    const xlsx = await admin
      .get('/migration/dashboard/export?locale=ar')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['حسب الإدارة', 'حسب الفرع', 'العناصر']);
    await owner.get('/migration/dashboard').expect(200); // governance dashboard permission
    const viewer = await loggedIn(ctx.app, 'viewer@test.local');
    await viewer.get('/migration/dashboard').expect(403);
    await owner.post('/migration/bulk').send({ action: 'VALIDATE', items: [] }).expect(403);
  });

  it('assigns owners in bulk; owners see their imported drafts in My tasks; validate and submit', async () => {
    const items = (await admin.get('/migration/items?type=PROCESS&pageSize=100').expect(200)).body
      .items as { id: string; code: string }[];
    const pick = items.filter((i) => ['C.01.01', 'S.02', 'C'].includes(i.code));
    const res = (
      await admin
        .post('/migration/bulk')
        .send({
          action: 'ASSIGN_OWNER',
          ownerId,
          items: pick.map((i) => ({ type: 'PROCESS', id: i.id })),
        })
        .expect(200)
    ).body;
    expect(res).toMatchObject({ done: 3, failed: [] });
    const mine = (await owner.get('/migration/my-drafts').expect(200)).body;
    expect(mine.map((i: { code: string }) => i.code).sort()).toEqual(['C', 'C.01.01', 'S.02']);

    const validated = (
      await admin
        .post('/migration/bulk')
        .send({ action: 'VALIDATE', items: pick.map((i) => ({ type: 'PROCESS', id: i.id })) })
        .expect(200)
    ).body;
    const c = pick.find((i) => i.code === 'C')!;
    expect(validated.issues.find((x: { id: string }) => x.id === c.id).problems).toContain(
      'NO_MODEL',
    );

    const themed = (
      await admin
        .post('/migration/bulk')
        .send({ action: 'APPLY_THEME', items: pick.map((i) => ({ type: 'PROCESS', id: i.id })) })
        .expect(200)
    ).body;
    expect(themed.done + themed.unchanged).toBe(3);

    const s02 = pick.find((i) => i.code === 'S.02')!;
    const submitted = (
      await admin
        .post('/migration/bulk')
        .send({
          action: 'SUBMIT',
          note: 'Imported, please review',
          items: [{ type: 'PROCESS', id: s02.id }],
        })
        .expect(200)
    ).body;
    expect(submitted.done + submitted.failed.length).toBe(1);
    if (submitted.done)
      expect((await ctx.prisma.process.findUniqueOrThrow({ where: { id: s02.id } })).status).toBe(
        'IN_REVIEW',
      );
    await admin
      .post('/migration/bulk')
      .send({ action: 'ASSIGN_OWNER', items: [{ type: 'PROCESS', id: s02.id }] })
      .expect(400);
  });
});
