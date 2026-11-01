import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Test } from 'supertest';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

const PMS01 = readFileSync(
  join(__dirname, '../../../docs/samples/PMS-01-Program-Request-Approval.bpmn'),
  'utf8',
);

const binary = (r: Test): Test =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('HTML and PowerPoint exports (e2e)', () => {
  let ctx: TestContext;
  let viewer: Client;
  let modeler: Client;
  let risk: Client;
  let processId: string;
  let draftId: string;
  let pageId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const owner = await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'], {
      nameEn: 'Omar Owner',
    });
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'risk@test.local', ['RISK_OFFICER']);
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    risk = await loggedIn(ctx.app, 'risk@test.local');
    const p = await ctx.prisma.process.create({
      data: {
        code: 'PMS.01',
        nameEn: 'Program request <script>alert(1)</script>',
        nameAr: 'طلب البرنامج',
        category: 'CORE',
        ownerId: owner.id,
        status: 'PUBLISHED',
      },
    });
    processId = p.id;
    await ctx.prisma.processModel.create({ data: { processId, bpmnXml: PMS01 } });
    await ctx.prisma.processVersion.create({
      data: { processId, versionNumber: 1, bpmnXml: PMS01, changeNote: 'v1' },
    });
    await ctx.prisma.publication.create({
      data: {
        entityType: 'PROCESS',
        entityId: processId,
        versionNumber: 1,
        versionLabel: '1.0',
        code: 'PMS.01',
        titleEn: 'Program request <script>alert(1)</script>',
        titleAr: 'طلب البرنامج',
        approvedAt: new Date('2026-10-01T08:00:00Z'),
        approverIds: [owner.id],
      },
    });
    const space = await ctx.prisma.space.create({
      data: { key: 'SOP', nameEn: 'SOPs', nameAr: 'الإجراءات' },
    });
    const html =
      '<p>Step one <a href="/processes/x">internal</a> <a href="https://example.com">external</a></p><img src="/api/v1/attachments/00000000-0000-4000-8000-000000000000/content">';
    const page = await ctx.prisma.page.create({
      data: {
        spaceId: space.id,
        titleEn: 'Request SOP',
        titleAr: 'إجراء الطلب',
        contentEn: html,
        contentAr: '<p>الخطوة الأولى</p>',
        status: 'PUBLISHED',
        version: 1,
      },
    });
    pageId = page.id;
    await ctx.prisma.pageVersion.create({
      data: {
        pageId,
        versionNumber: 1,
        titleEn: 'Request SOP',
        titleAr: 'إجراء الطلب',
        contentEn: html,
        contentAr: '<p>الخطوة الأولى</p>',
        changeNote: '',
        dirEn: 'ltr',
        dirAr: 'rtl',
      },
    });
    await ctx.prisma.publication.create({
      data: {
        entityType: 'PAGE',
        entityId: pageId,
        versionNumber: 1,
        titleEn: 'Request SOP',
        titleAr: 'إجراء الطلب',
      },
    });
    await ctx.prisma.pageLink.create({ data: { pageId, processId, targetType: 'PROCESS' } });
    draftId = (
      await ctx.prisma.process.create({
        data: {
          code: 'PMS.02',
          nameEn: 'Draft only',
          nameAr: 'مسودة',
          category: 'CORE',
          parentId: processId,
        },
      })
    ).id;
    await ctx.prisma.processModel.create({ data: { processId: draftId, bpmnXml: PMS01 } });
    ctx.renderer.calls = [];
  });

  const zipOf = async (c: Client, body: Record<string, unknown>, status = 200) => {
    const res = await binary(c.post('/exports/html').send(body)).expect(status);
    return status === 200 ? JSZip.loadAsync(res.body as Buffer) : null;
  };

  it('exports a published process as an offline website (both languages, no network, sanitised)', async () => {
    const zip = (await zipOf(viewer, { scope: 'PROCESS', id: processId }))!;
    const names = Object.keys(zip.files);
    const root = names[0].split('/')[0];
    expect(names).toEqual(
      expect.arrayContaining([
        `${root}/index.html`,
        `${root}/processes/${processId}.html`,
        `${root}/pages/${pageId}.html`,
      ]),
    );
    const page = await zip.file(`${root}/processes/${processId}.html`)!.async('string');
    expect(page).toContain("default-src 'none'");
    expect(page).toContain('طلب البرنامج');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('<script>alert(1)');
    // Diagram images in both languages from the renderer, embedded as data: URIs.
    expect(
      ctx.renderer.calls
        .filter((c) => c.kind === 'bpmn')
        .map((c) => c.locale)
        .sort(),
    ).toEqual(['ar', 'en']);
    expect(page).toMatch(/<img src="data:image\/svg\+xml;base64,/);
    // Step table from the published model (Arabic labels).
    expect(page).toContain('Create program request');
    expect(page).toContain('dir="rtl"');
    // Nothing loads from outside: no src/href pointing to http(s) except links in wiki text.
    for (const name of names.filter((n) => n.endsWith('.html'))) {
      const html = await zip.file(name)!.async('string');
      expect(html).not.toMatch(/\ssrc="(?!data:)/);
      expect(html).not.toMatch(/<link\b/);
    }
    const sop = await zip.file(`${root}/pages/${pageId}.html`)!.async('string');
    expect(sop).toContain('href="https://example.com"');
    expect(sop).not.toContain('href="/processes/x"');
    expect(sop).toContain('internal');
    expect(sop).not.toContain('/api/v1/attachments');
    // The draft child is not part of a published export.
    const branch = (await zipOf(viewer, { scope: 'BRANCH', id: processId }))!;
    expect(Object.keys(branch.files).some((n) => n.includes(draftId))).toBe(false);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'EXPORT', entityId: processId },
    });
    expect(audit?.summary).toMatchObject({ format: 'html', scope: 'PROCESS', drafts: false });
  });

  it('drafts only for users with workspace access, watermarked; unpublished items are not exported', async () => {
    await zipOf(viewer, { scope: 'PROCESS', id: processId, drafts: true }, 403);
    await zipOf(viewer, { scope: 'PROCESS', id: draftId }, 404);
    const zip = (await zipOf(modeler, { scope: 'BRANCH', id: processId, drafts: true }))!;
    const files = Object.keys(zip.files);
    expect(files.some((n) => n.endsWith(`processes/${draftId}.html`))).toBe(true);
    const index = await zip.file(files.find((n) => n.endsWith('/index.html'))!)!.async('string');
    expect(index).toContain('DRAFT — not approved');
    expect(index).toContain('مسودة — غير معتمدة');
  });

  it('exports a wiki space and works without the renderer (note instead of image)', async () => {
    ctx.renderer.on = false;
    try {
      const space = await ctx.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      const zip = (await zipOf(viewer, { scope: 'SPACE', id: space.spaceId }))!;
      expect(Object.keys(zip.files).some((n) => n.endsWith(`pages/${pageId}.html`))).toBe(true);
      const proc = (await zipOf(viewer, { scope: 'PROCESS', id: processId }))!;
      const html = await proc
        .file(Object.keys(proc.files).find((n) => n.endsWith(`processes/${processId}.html`))!)!
        .async('string');
      expect(html).toContain('Diagram image not available.');
    } finally {
      ctx.renderer.on = true;
    }
  });

  it('exports PowerPoint decks: process (Arabic right to left), KPI and risk summaries with permissions', async () => {
    const res = await binary(
      modeler.post('/exports/pptx').send({ scope: 'PROCESS', id: processId, locale: 'ar' }),
    ).expect(200);
    expect(res.headers['content-type']).toContain('presentationml');
    const deck = await JSZip.loadAsync(res.body as Buffer);
    const slides = Object.keys(deck.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.length).toBeGreaterThanOrEqual(4);
    const xml = (await Promise.all(slides.map((s) => deck.file(s)!.async('string')))).join('');
    expect(xml).toContain('rtl="1"');
    expect(xml).toContain('طلب البرنامج');
    expect(Object.keys(deck.files).some((n) => n.startsWith('ppt/media/'))).toBe(true);
    expect(ctx.renderer.calls.at(-1)).toMatchObject({ kind: 'bpmn', locale: 'ar', format: 'png' });

    await viewer.post('/exports/pptx').send({ scope: 'KPI_SUMMARY' }).expect(403);
    await viewer.post('/exports/pptx').send({ scope: 'RISK_SUMMARY' }).expect(403);
    await risk.post('/exports/pptx').send({ scope: 'RISK_SUMMARY', locale: 'en' }).expect(200);
    await risk.post('/exports/pptx').send({ scope: 'KPI_SUMMARY', locale: 'ar' }).expect(200);
    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'EXPORT' } });
    expect(audits.map((a) => (a.summary as { scope: string }).scope).sort()).toEqual([
      'KPI_SUMMARY',
      'PROCESS',
      'RISK_SUMMARY',
    ]);
  });
  it('PowerPoint decks of portal readers show risks, controls and KPIs only as the portal does (SEC-34)', async () => {
    const pub = await ctx.prisma.publication.findFirstOrThrow({
      where: { entityType: 'PROCESS', entityId: processId },
    });
    const riskObj = await ctx.prisma.repoObject.create({
      data: { type: 'RISK', code: 'R-SECRET', nameEn: 'Hidden fraud risk', nameAr: 'خطر مخفي' },
    });
    await ctx.prisma.objectLink.create({
      data: {
        processId,
        bpmnElementId: '#process',
        repoObjectId: riskObj.id,
        relation: 'SUPPORTS',
      },
    });
    await ctx.prisma.publishedLink.create({
      data: {
        publicationId: pub.id,
        bpmnElementId: '#process',
        repoObjectId: riskObj.id,
        relation: 'SUPPORTS',
      },
    });
    const text = async (c: Client) => {
      const res = await binary(
        c.post('/exports/pptx').send({ scope: 'PROCESS', id: processId, locale: 'en' }),
      ).expect(200);
      const deck = await JSZip.loadAsync(res.body as Buffer);
      const slides = Object.keys(deck.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      return (await Promise.all(slides.map((s) => deck.file(s)!.async('string')))).join('');
    };
    // Viewer (portal): risks are hidden by default (Settings → Risk & Compliance, D-092).
    expect(await text(viewer)).not.toContain('Hidden fraud risk');
    // Risk & Compliance reader: shown.
    expect(await text(risk)).toContain('Hidden fraud risk');
    await ctx.prisma.publishedLink.deleteMany({ where: { repoObjectId: riskObj.id } });
    await ctx.prisma.objectLink.deleteMany({ where: { repoObjectId: riskObj.id } });
  });
});
