import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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
  it('treats a restored package as untrusted input (SEC-13)', async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    const space = await ctx.prisma.space.create({ data: { key: 'QM', nameEn: 'Quality' } });
    const page = await ctx.prisma.page.create({
      data: { spaceId: space.id, titleEn: 'SOP', contentEn: '<p>Hello</p>' },
    });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const att = await ctx.prisma.attachment.create({
      data: {
        pageId: page.id,
        fileName: 'a.png',
        contentType: 'image/png',
        size: png.length,
        storageKey: `attachments/${page.id}/x`,
      },
    });
    ctx.storage.files.set(att.storageKey, { data: png, contentType: 'image/png' });
    const res = await superAdmin
      .get('/repository-export')
      .buffer(true)
      .parse(binary as never)
      .expect(200);

    // A doctored package: credentials and SSO link on a new user, Super Admin for it and for the
    // existing account, an auth setting, script in a page and an attachment key that targets the logo.
    const zip = await JSZip.loadAsync(res.body);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const edit = async (path: string, fn: (rows: Record<string, unknown>[]) => unknown[]) => {
      const rows = JSON.parse(await zip.file(path)!.async('string'));
      const body = JSON.stringify(fn(rows));
      zip.file(path, body);
      const entry = manifest.files.find((f: { path: string }) => f.path === path);
      const sha = createHash('sha256').update(body).digest('hex');
      if (entry) Object.assign(entry, { sha256: sha, bytes: Buffer.byteLength(body) });
      else manifest.files.push({ path, sha256: sha, bytes: Buffer.byteLength(body) });
    };
    const intruder = '7d3c0a52-0000-4000-8000-000000000001';
    const superId = (
      await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'super@test.local' } })
    ).id;
    await edit('data/User.json', (rows) => [
      ...rows,
      {
        ...rows[0],
        id: intruder,
        email: 'intruder@evil.test',
        totpSecretSealed: 'v1:sealed',
        ssoIssuer: 'https://evil.test',
        ssoSubject: 'attacker',
      },
    ]);
    await edit('data/UserRole.json', () => [
      { userId: intruder, roleKey: 'SUPER_ADMIN' },
      { userId: intruder, roleKey: 'MODELER' },
      { userId: superId, roleKey: 'VIEWER' },
    ]);
    await edit('data/Setting.json', (rows) => [
      ...rows,
      { key: 'auth', value: { passwordLogin: false, mfaRequiredRoles: [] } },
    ]);
    await edit('data/Page.json', (rows) =>
      rows.map((r) => ({
        ...r,
        contentEn: '<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      })),
    );
    await edit('data/Attachment.json', (rows) =>
      rows.map((r) => ({ ...r, storageKey: 'branding/logo', contentType: 'text/html' })),
    );
    zip.file('manifest.json', JSON.stringify(manifest));
    const doctored = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));

    await resetDb(ctx.prisma);
    ctx.storage.files.clear();
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const fresh = await loggedIn(ctx.app, 'super@test.local');
    const freshSuper = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'super@test.local' },
    });
    const b = await upload(fresh, 'PACKAGE', [{ name: 'export.zip', data: doctored }]);
    expect(b.status).toBe('READY');
    await applyBatch(fresh, b.id);

    const restored = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'intruder@evil.test' },
      include: { roles: { include: { role: true } } },
    });
    expect(restored).toMatchObject({ passwordHash: '', totpSecretSealed: null, ssoSubject: null });
    expect(restored.roles.map((r) => r.role.key)).toEqual(['MODELER']);
    // Existing accounts keep their roles (the package used the old id; the new one is different
    // anyway, and roles are only restored for users the package created).
    const roles = await ctx.prisma.userRole.findMany({ where: { userId: freshSuper.id } });
    expect(roles).toHaveLength(1);
    const auth = await ctx.prisma.setting.findUnique({ where: { key: 'auth' } });
    expect(auth?.value ?? {}).not.toHaveProperty('passwordLogin');
    expect(auth?.updatedById ?? null).toBeNull();
    const restoredPage = await ctx.prisma.page.findFirstOrThrow();
    expect(restoredPage.contentEn).not.toMatch(/script|onerror/);
    const restoredAtt = await ctx.prisma.attachment.findFirstOrThrow();
    expect(restoredAtt.storageKey).toBe(`attachments/${restoredAtt.pageId}/${restoredAtt.id}`);
    expect(restoredAtt.contentType).toBe('image/png');
    expect(ctx.storage.files.has('branding/logo')).toBe(false);
  });
});
