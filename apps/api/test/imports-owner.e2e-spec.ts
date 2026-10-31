import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';
import { applyBatch, itemsOf, upload, waitBatch, xlsx } from './imports-fixtures';

const SAMPLES = join(__dirname, '../../../docs/samples/import');
const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });
const bpmn = (name: string) => ({ name, data: Buffer.from(sampleBpmn(['Task_A', 'Task_B'])) });

/**
 * Product owner decision D-164: Process Owners import diagrams and documents for the processes they
 * own and the wiki spaces they can edit; everything else stays with Admins, full export / restore
 * with Super Admins. Owners only see and undo their own batches.
 */
describe('Import Center — Process Owner imports (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let owner: Client;
  let otherOwner: Client;
  let modeler: Client;
  let ownerId: string;
  let ownParentId: string;
  let foreignId: string;
  let openSpaceId: string;
  let closedSpaceId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const o = await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    const o2 = await createUser(ctx.prisma, 'owner2@test.local', ['PROCESS_OWNER']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    ownerId = o.id;
    admin = await loggedIn(ctx.app, 'admin@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    otherOwner = await loggedIn(ctx.app, 'owner2@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    const mk = (code: string, nameEn: string, ownerOf: string, parentId?: string) =>
      ctx.prisma.process.create({
        data: { code, nameEn, category: 'CORE', ownerId: ownerOf, parentId, level: 1 },
      });
    ownParentId = (await mk('C.01', 'Customer services', o.id)).id;
    await mk('C.01.01', 'Handle enquiries', o.id, ownParentId);
    foreignId = (await mk('S.05', 'Payroll', o2.id)).id;
    openSpaceId = (await ctx.prisma.space.create({ data: { key: 'OPEN', nameEn: 'Open' } })).id;
    closedSpaceId = (
      await ctx.prisma.space.create({
        data: { key: 'HR', nameEn: 'HR', editRestricted: true, ownerId: o2.id },
      })
    ).id;
  });

  it('lists only diagram and document kinds for an owner; nothing for a modeler', async () => {
    const kinds = (await owner.get('/imports/kinds').expect(200)).body as { kind: string }[];
    expect(kinds.map((k) => k.kind).sort()).toEqual(
      ['BPMN', 'CONFLUENCE', 'MARKDOWN', 'PDF', 'VISIO', 'WORD'].sort(),
    );
    await modeler.get('/imports/kinds').expect(403);
    await modeler.get('/imports').expect(403);
  });

  it('refuses structure, users, library, GRC, KPI and package imports for an owner', async () => {
    const data = await xlsx(['Code'], [['X']]);
    for (const kind of [
      'PROCESS_HOUSE',
      'DEPARTMENTS',
      'USERS',
      'EA_APPLICATIONS',
      'GRC_RISKS',
      'KPI_KPIS',
      'ARIS',
      'DMN',
      'PACKAGE',
    ])
      await upload(owner, kind, [{ name: 'x.xlsx', data }], {}, 403);
    await owner.get('/imports/templates/USERS?locale=en').expect(403);
    // Full export and restore stay with Super Admins.
    await owner.get('/repository-export').expect(403);
    await admin.get('/repository-export').expect(403);
  });

  it('imports a BPMN diagram into an own process and undoes the own batch', async () => {
    const b = await upload(owner, 'BPMN', [bpmn('C.01.01 Handle enquiries.bpmn')]);
    expect(b.status).toBe('READY');
    const [item] = await itemsOf(owner, b.id);
    expect(item).toMatchObject({ action: 'UPDATE', matchBy: 'CODE' });
    await applyBatch(owner, b.id);
    const p = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'C.01.01' },
      include: { model: true },
    });
    expect(p.model!.bpmnXml).toContain('Task_A');
    await owner.post(`/imports/${b.id}/undo`).expect(200);
  });

  it("blocks another owner's process and a new process without an own parent", async () => {
    const b = await upload(owner, 'BPMN', [
      bpmn('S.05 Payroll.bpmn'),
      bpmn('Brand new process.bpmn'),
    ]);
    const items = await itemsOf(owner, b.id);
    const foreign = items.find((i) => i.key.startsWith('S.05'))!;
    expect(foreign).toMatchObject({ action: 'SKIP', matchId: foreignId });
    expect(foreign.issues.map((i) => i.code)).toContain('NOT_OWN_PROCESS');
    const fresh = items.find((i) => i.key.startsWith('Brand'))!;
    expect(fresh.issues.map((i) => i.code)).toContain('OWN_PARENT_REQUIRED');
    expect((await owner.post(`/imports/${b.id}/apply`).expect(400)).body.code).toBe(
      'IMPORT_HAS_ERRORS',
    );
    // With an own parent, new processes are created under it and owned by the owner.
    await owner.put(`/imports/${b.id}/options`).send({ parentProcessId: ownParentId }).expect(200);
    await waitBatch(owner, b.id);
    await owner
      .put(`/imports/${b.id}/items/${encodeURIComponent(foreign.ref)}`)
      .send({ skip: true })
      .expect(200);
    const done = await applyBatch(owner, b.id);
    expect(done.status).toBe('APPLIED');
    const created = await ctx.prisma.process.findFirstOrThrow({
      where: { importBatchId: b.id },
    });
    expect(created).toMatchObject({ parentId: ownParentId, ownerId });
    expect(
      (await ctx.prisma.processModel.findUnique({ where: { processId: foreignId } })) ?? null,
    ).toBeNull();
  });

  it("refuses another owner's parent; new processes are always owned by the importing owner", async () => {
    await upload(owner, 'BPMN', [bpmn('x.bpmn')], { parentProcessId: foreignId }, 403);
    const other = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'owner2@test.local' } });
    const b = await upload(owner, 'BPMN', [bpmn('x.bpmn')], {
      parentProcessId: ownParentId,
      defaultOwnerId: other.id,
    });
    expect(b.options.defaultOwnerId).toBe(ownerId);
    await owner
      .put(`/imports/${b.id}/options`)
      .send({ parentProcessId: ownParentId, defaultOwnerId: other.id })
      .expect(200);
    expect((await waitBatch(owner, b.id)).options.defaultOwnerId).toBe(ownerId);
  });

  it('imports documents only into spaces the owner can edit', async () => {
    const doc = sample('C.01.01 SOP Handle enquiries (EN).docx');
    await upload(owner, 'WORD', [doc], { spaceId: closedSpaceId }, 403);
    const b = await upload(owner, 'WORD', [doc], { spaceId: openSpaceId });
    expect(b.status).toBe('READY');
    await applyBatch(owner, b.id);
    expect(await ctx.prisma.page.count({ where: { spaceId: openSpaceId } })).toBe(1);
  });

  it('shows owners only their own batches; Admins see all', async () => {
    const mine = await upload(owner, 'BPMN', [bpmn('C.01.01 Handle enquiries.bpmn')]);
    const theirs = await upload(otherOwner, 'BPMN', [bpmn('S.05 Payroll.bpmn')]);
    const list = (await owner.get('/imports').expect(200)).body.items as { id: string }[];
    expect(list.map((b) => b.id)).toEqual([mine.id]);
    await owner.get(`/imports/${theirs.id}`).expect(404);
    await owner.get(`/imports/${theirs.id}/items`).expect(404);
    await owner.post(`/imports/${theirs.id}/apply`).expect(404);
    await owner.post(`/imports/${theirs.id}/undo`).expect(404);
    await owner.delete(`/imports/${theirs.id}`).expect(404);
    const all = (await admin.get('/imports').expect(200)).body.items as { id: string }[];
    expect(all.map((b) => b.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it('keeps migration bulk actions, AI migration and settings changes with Admins', async () => {
    await owner.post('/migration/bulk').send({}).expect(403);
    await owner
      .post('/migration-ai/run')
      .send({ kind: 'TRANSLATE', confirmExternal: true })
      .expect(403);
    await owner.put('/imports/settings').send({ ssoWelcomeEmail: false }).expect(403);
    expect((await owner.get('/imports/settings').expect(200)).body).toMatchObject({
      allowAiOnImportedDocuments: false,
    });
  });
});
