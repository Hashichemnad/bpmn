import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createApp, createUser, loggedIn, resetDb, type TestContext } from './helpers';
import { applyBatch, binary, itemsOf, upload } from './imports-fixtures';

const SAMPLES = join(__dirname, '../../../docs/samples/import');
const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });

/** Import tools step 7: full export package and restore into an empty installation (round trip). */
describe('Import Center — export package round trip (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const snapshot = async () => ({
    departments: await ctx.prisma.department.count(),
    processes: (
      await ctx.prisma.process.findMany({
        select: { code: true, nameEn: true, nameAr: true, level: true, status: true },
        orderBy: { code: 'asc' },
      })
    ).map((p) => JSON.stringify(p)),
    models: (await ctx.prisma.processModel.findMany({ orderBy: { processId: 'asc' } })).map(
      (m) => m.bpmnXml.length,
    ),
    versions: await ctx.prisma.processVersion.count(),
    pages: (
      await ctx.prisma.page.findMany({
        select: { titleEn: true, titleAr: true, contentEn: true, contentAr: true },
        orderBy: { titleEn: 'asc' },
      })
    ).map((p) => JSON.stringify(p)),
    attachments: await ctx.prisma.attachment.count(),
    pageLinks: await ctx.prisma.pageLink.count(),
    diagrams: (
      await ctx.prisma.diagram.findMany({
        select: { code: true, content: true },
        orderBy: { code: 'asc' },
      })
    ).map((d) => JSON.stringify(d)),
    diagramLinks: await ctx.prisma.diagramLink.count(),
    objects: await ctx.prisma.repoObject.count(),
    risks: await ctx.prisma.risk.count(),
    objectLinks: await ctx.prisma.objectLink.count(),
  });

  it('exports the whole repository and restores it into an empty installation', async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    await ctx.prisma.repoObject.create({ data: { type: 'ROLE', nameEn: 'Procurement Officer' } });
    const space = await ctx.prisma.space.create({ data: { key: 'QM', nameEn: 'Quality' } });
    for (const [kind, file, options] of [
      ['DEPARTMENTS', 'departments.xlsx', {}],
      ['PROCESS_HOUSE', 'process-house.xlsx', {}],
      ['BPMN', 'bpmn-diagrams.zip', {}],
      ['ARIS', 'aris-procurement.xml', {}],
      ['DMN', 'approval-authority.dmn', {}],
      ['WORD', 'C.01.02 إجراء تسجيل الطلبات (AR).docx', { spaceId: space.id }],
      ['CONFLUENCE', 'confluence-quality-manual.zip', { spaceId: space.id }],
    ] as const)
      await applyBatch(superAdmin, (await upload(superAdmin, kind, [sample(file)], options)).id);
    const before = await snapshot();
    expect(before.attachments).toBeGreaterThan(0);
    expect(before.diagrams.length).toBe(3);

    // Only Super Admins export everything.
    await admin.get('/repository-export').expect(403);
    const res = await superAdmin
      .get('/repository-export')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    const zip = await JSZip.loadAsync(res.body);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ format: 'processhub-export', version: 1 });
    expect(manifest.counts.Process).toBe(9);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining([
        'data/Process.json',
        'processes/C-01-02/C-01-02.bpmn',
        'excel/process-house.xlsx',
        'excel/grc-risks.xlsx',
      ]),
    );
    expect(Object.keys(zip.files).some((p) => /^pages\/QM\/.+\/ar\.md$/.test(p))).toBe(true);
    const users = await zip.file('data/User.json')!.async('string');
    expect(users).not.toContain('passwordHash');
    expect(users).not.toContain('totpSecretSealed');

    // A fresh installation: only the Super Admin.
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const fresh = await loggedIn(ctx.app, 'super@test.local');
    expect(
      (await fresh.get('/imports/kinds').expect(200)).body.map((k: { kind: string }) => k.kind),
    ).toContain('PACKAGE');
    const b = await upload(fresh, 'PACKAGE', [{ name: 'export.zip', data: res.body }]);
    expect(b.status).toBe('READY');
    expect(b.summary.blocking).toBe(0);
    await applyBatch(fresh, b.id);
    const after = await snapshot();
    expect(after).toEqual(before);
    // Users came back without passwords (invitation or SSO); the signed-in Super Admin kept theirs.
    const owner = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'owner@test.local' },
      include: { roles: { include: { role: true } } },
    });
    expect(owner.passwordHash).toBe('');
    expect(owner.roles.map((r) => r.role.key)).toEqual(['PROCESS_OWNER']);
    const attachment = await ctx.prisma.attachment.findFirstOrThrow();
    expect(ctx.storage.files.has(attachment.storageKey)).toBe(true);

    // The package cannot be restored over existing content.
    const again = await upload(fresh, 'PACKAGE', [{ name: 'export.zip', data: res.body }]);
    expect((await itemsOf(fresh, again.id))[0].issues[0].code).toBe('TARGET_NOT_EMPTY');
    await fresh.post(`/imports/${again.id}/apply`).expect(400);
  });

  it('rejects a tampered package', async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    const res = await superAdmin
      .get('/repository-export')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    const zip = await JSZip.loadAsync(res.body);
    zip.file('data/Process.json', '[{"id":"x"}]');
    const tampered = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    const b = await upload(superAdmin, 'PACKAGE', [{ name: 'export.zip', data: tampered }]);
    expect(b.status).toBe('FAILED');
    expect(b.issues[0].code).toBe('PACKAGE_CHECKSUM');
  });
});
