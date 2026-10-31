import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';
import { applyBatch, itemsOf, upload } from './imports-fixtures';

const SAMPLES = join(__dirname, '../../../docs/samples/import');
const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });

/** Import tools step 4: Word, PDF, Confluence and Markdown into the wiki, links to processes. */
describe('Import Center — documents (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let spaceId: string;
  let processId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    spaceId = (await ctx.prisma.space.create({ data: { key: 'QM', nameEn: 'Quality' } })).id;
    processId = (
      await ctx.prisma.process.create({
        data: { code: 'C.01.01', nameEn: 'Handle enquiries', category: 'CORE', level: 3 },
      })
    ).id;
  });

  it('needs a space', async () => {
    const b = await upload(admin, 'WORD', [sample('C.01.01 SOP Handle enquiries (EN).docx')]);
    expect(b.status).toBe('FAILED');
    expect(b.issues[0].code).toBe('SPACE_REQUIRED');
  });

  it('converts Word SOPs (English and Arabic RTL) with images, tables, template sections and process links', async () => {
    const b = await upload(
      admin,
      'WORD',
      [
        sample('C.01.01 SOP Handle enquiries (EN).docx'),
        sample('C.01.02 إجراء تسجيل الطلبات (AR).docx'),
      ],
      { spaceId, pageTemplate: 'SOP', linkProcesses: true },
    );
    expect(b.status).toBe('READY');
    const items = await itemsOf(admin, b.id);
    const en = items.find((i) => i.nameEn.startsWith('C.01.01'))!;
    const ar = items.find((i) => i.nameAr.startsWith('C.01.02'))!;
    expect(en.facts).toMatchObject({ language: 'EN', images: 1, tables: 1 });
    expect(ar.facts).toMatchObject({ language: 'AR' });
    expect(en.suggestions).toEqual([
      expect.objectContaining({ kind: 'PROCESS', targetId: processId, accepted: true }),
    ]);
    await applyBatch(admin, b.id);
    const page = await ctx.prisma.page.findFirstOrThrow({
      where: { titleEn: { startsWith: 'C.01.01' } },
      include: { attachments: true, links: true, versions: true },
    });
    expect(page).toMatchObject({ status: 'DRAFT', spaceId, importBatchId: b.id, version: 1 });
    expect(page.contentEn).toContain('<table>');
    expect(page.contentEn).toContain('<ol>');
    expect(page.contentEn).toContain(`/api/v1/attachments/${page.attachments[0].id}/content`);
    expect(page.contentEn).toContain('href="https://example.org/policies"');
    expect(page.attachments[0].contentType).toBe('image/png');
    expect(page.links).toEqual([expect.objectContaining({ processId, targetType: 'PROCESS' })]);
    expect(page.versions[0].changeNote).toMatch(/^Imported from/);
    const arPage = await ctx.prisma.page.findFirstOrThrow({
      where: { titleAr: { startsWith: 'C.01.02' } },
    });
    expect(arPage.contentEn).toBe('');
    expect(arPage.contentAr).toContain('dir="rtl"');
    expect(arPage.textAr).toContain('استلام الطلب');
    // Re-import updates the same draft pages (new version), no duplicates.
    const again = await upload(admin, 'WORD', [sample('C.01.01 SOP Handle enquiries (EN).docx')], {
      spaceId,
    });
    expect((await itemsOf(admin, again.id))[0]).toMatchObject({
      action: 'UPDATE',
      matchBy: 'FILE_NAME',
    });
    await applyBatch(admin, again.id);
    expect(await ctx.prisma.page.count({ where: { spaceId, deletedAt: null } })).toBe(2);
    expect((await ctx.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).version).toBe(2);
  });

  it('splits a Word document by Heading 1', async () => {
    const b = await upload(admin, 'WORD', [sample('C.01.01 SOP Handle enquiries (EN).docx')], {
      spaceId,
      splitByHeading: true,
    });
    const items = await itemsOf(admin, b.id);
    expect(items.map((i) => i.nameEn)).toEqual([
      'C.01.01 Handle enquiries — Standard operating procedure',
      'Purpose',
      'Procedure',
      'Risks and controls',
    ]);
    await applyBatch(admin, b.id);
    const parent = await ctx.prisma.page.findFirstOrThrow({
      where: { titleEn: { startsWith: 'C.01.01' } },
      include: { children: true },
    });
    expect(parent.children).toHaveLength(3);
  });

  it('imports a text PDF with the original attached and flags scanned PDFs', async () => {
    const scanned = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    const b = await upload(
      admin,
      'PDF',
      [sample('S.02 Supplier onboarding guide.pdf'), { name: 'scan.pdf', data: scanned }],
      { spaceId },
    );
    const items = await itemsOf(admin, b.id);
    const guide = items.find((i) => i.key.startsWith('S.02'))!;
    expect(guide.facts).toMatchObject({ pages: 1 });
    const scan = items.find((i) => i.source === 'scan.pdf')!;
    expect(scan.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([expect.stringMatching(/PDF_NEEDS_MANUAL_WORK|PDF_UNREADABLE/)]),
    );
    if (scan.issues.some((i) => i.level === 'ERROR'))
      await admin
        .put(`/imports/${b.id}/items/${encodeURIComponent(scan.ref)}`)
        .send({ skip: true })
        .expect(200);
    await applyBatch(admin, b.id);
    const page = await ctx.prisma.page.findFirstOrThrow({
      where: { titleEn: { startsWith: 'S.02' } },
      include: { attachments: true },
    });
    expect(page.attachments[0]).toMatchObject({ contentType: 'application/pdf' });
    expect(page.contentEn).toContain('procurement officer checks the documents');
    expect(page.contentEn).toContain(`/api/v1/attachments/${page.attachments[0].id}/content`);
  });

  it('imports a Confluence space export: hierarchy, attachments, rewritten and broken links, no scripts', async () => {
    const b = await upload(admin, 'CONFLUENCE', [sample('confluence-quality-manual.zip')], {
      spaceId,
    });
    const items = await itemsOf(admin, b.id);
    expect(items.map((i) => i.nameEn).sort()).toEqual([
      'Document control',
      'Quality Manual',
      'Records retention',
    ]);
    const control = items.find((i) => i.nameEn === 'Document control')!;
    expect(control.issues).toEqual([
      expect.objectContaining({
        code: 'BROKEN_LINKS',
        params: expect.objectContaining({ count: 1 }),
      }),
    ]);
    expect(control.facts).toMatchObject({ attachments: 2 });
    await applyBatch(admin, b.id);
    const pages = await ctx.prisma.page.findMany({
      where: { spaceId },
      include: { attachments: true },
    });
    const byTitle = (t: string) => pages.find((p) => p.titleEn === t)!;
    const manual = byTitle('Quality Manual');
    expect(byTitle('Document control').parentId).toBe(manual.id);
    expect(byTitle('Records retention').parentId).toBe(byTitle('Document control').id);
    expect(manual.contentEn).toContain(
      `href="/docs/${spaceId}/pages/${byTitle('Document control').id}"`,
    );
    const doc = byTitle('Document control');
    expect(doc.attachments.map((a) => a.contentType).sort()).toEqual([
      'application/pdf',
      'image/png',
    ]);
    expect(doc.contentEn).not.toContain('<script');
    expect(doc.contentEn).not.toContain('Missing-page');
    // The process code in the text is offered as a link (not pre-accepted).
    expect(items.find((i) => i.nameEn === 'Quality Manual')!.suggestions[0]).toMatchObject({
      targetId: processId,
      accepted: false,
    });
  });

  it('imports a Markdown folder with its hierarchy and images; undo removes the pages', async () => {
    const b = await upload(admin, 'MARKDOWN', [sample('markdown-guides.zip')], { spaceId });
    const items = await itemsOf(admin, b.id);
    expect(items.map((i) => i.nameEn).sort()).toEqual(['Staff guides', 'Your first week']);
    await applyBatch(admin, b.id);
    const week = await ctx.prisma.page.findFirstOrThrow({
      where: { titleEn: 'Your first week' },
      include: { parent: true, attachments: true },
    });
    expect(week.parent!.titleEn).toBe('Staff guides');
    expect(week.attachments).toHaveLength(1);
    expect(week.contentEn).toContain('<table>');
    expect(week.contentEn).toContain(`/docs/${spaceId}/pages/${week.parentId}`);
    await admin.post(`/imports/${b.id}/undo`).expect(200);
    expect(await ctx.prisma.page.count({ where: { spaceId, deletedAt: null } })).toBe(0);
    expect(await ctx.prisma.attachment.count({ where: { deletedAt: null } })).toBe(0);
  });

  it('refuses macros and sanitises HTML in documents', async () => {
    const zip = new JSZip();
    zip.file(
      'evil.md',
      '# Evil\n\n<img src=x onerror=alert(1)><script>alert(1)</script>[x](javascript:alert(1))',
    );
    zip.file('macro.docm', 'PK');
    const b = await upload(
      admin,
      'MARKDOWN',
      [{ name: 'evil.zip', data: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) }],
      { spaceId },
    );
    await applyBatch(admin, b.id);
    const page = await ctx.prisma.page.findFirstOrThrow({ where: { titleEn: 'Evil' } });
    expect(page.contentEn).not.toMatch(/script|onerror|javascript:/i);
    const res = await upload(
      admin,
      'WORD',
      [{ name: 'sop.docm', data: Buffer.from('PK\x03\x04') }],
      { spaceId },
      400,
    );
    expect(res.code).toBe('MACRO_NOT_ALLOWED');
  });
});
