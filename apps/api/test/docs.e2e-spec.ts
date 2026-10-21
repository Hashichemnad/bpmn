import {
  PNG_BYTES,
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

describe('Documentation wiki (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let viewer: Client;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    spaceId = (
      await admin
        .post('/spaces')
        .send({ key: 'qm', nameEn: 'Quality', nameAr: 'الجودة', icon: 'safety' })
        .expect(201)
    ).body.id;
  });

  const newPage = (c: Client, body: Record<string, unknown> = {}) =>
    c.post(`/spaces/${spaceId}/pages`).send({ titleEn: 'Doc', titleAr: 'وثيقة', ...body });

  const save = (c: Client, id: string, body: Record<string, unknown>) =>
    c.put(`/pages/${id}`).send({ titleEn: 'Doc', titleAr: 'وثيقة', changeNote: 'Edit', ...body });

  describe('spaces', () => {
    it('admins create spaces; keys are unique and immutable', async () => {
      const space = (await admin.get(`/spaces/${spaceId}`).expect(200)).body;
      expect(space).toMatchObject({ key: 'QM', icon: 'safety', pageCount: 0, canManage: true });
      await admin.post('/spaces').send({ key: 'QM', nameEn: 'Dup' }).expect(409);
      await modeler.post('/spaces').send({ key: 'XX', nameEn: 'No' }).expect(403);
      await admin.post('/spaces').send({ key: '1', nameEn: 'Bad' }).expect(400);
      const updated = (
        await admin.patch(`/spaces/${spaceId}`).send({ descriptionEn: 'All QM docs' }).expect(200)
      ).body;
      expect(updated.descriptionEn).toBe('All QM docs');
      await modeler.patch(`/spaces/${spaceId}`).send({ nameEn: 'x' }).expect(403);
      expect((await viewer.get('/spaces').expect(200)).body).toHaveLength(1);
      expect(await ctx.prisma.auditLog.count({ where: { entityType: 'Space' } })).toBe(2);
    });

    it('the space owner can manage it', async () => {
      const modelerId = (
        await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'modeler@test.local' } })
      ).id;
      await admin.patch(`/spaces/${spaceId}`).send({ ownerId: modelerId }).expect(200);
      await modeler.patch(`/spaces/${spaceId}`).send({ nameEn: 'Owned' }).expect(200);
      await modeler.get(`/spaces/${spaceId}/permissions`).expect(200);
    });

    it('restricted spaces are hidden from users without a grant', async () => {
      const dept = await ctx.prisma.department.create({ data: { nameEn: 'QA' } });
      await createUser(ctx.prisma, 'qa@test.local', ['MODELER'], { departmentId: dept.id });
      const qa = await loggedIn(ctx.app, 'qa@test.local');
      const page = (await newPage(admin)).body;

      await admin
        .put(`/spaces/${spaceId}/permissions`)
        .send({
          viewRestricted: true,
          editRestricted: true,
          grants: [
            { principalType: 'DEPARTMENT', principalId: dept.id, access: 'EDIT' },
            { principalType: 'ROLE', principalId: 'VIEWER', access: 'VIEW' },
          ],
        })
        .expect(200);
      const perms = (await admin.get(`/spaces/${spaceId}/permissions`).expect(200)).body;
      expect(perms.grants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            principalType: 'DEPARTMENT',
            label: expect.objectContaining({ nameEn: 'QA' }),
          }),
          expect.objectContaining({
            principalType: 'ROLE',
            label: expect.objectContaining({ nameEn: 'Viewer' }),
          }),
        ]),
      );

      // modeler: no grant → the space does not exist for them
      expect((await modeler.get('/spaces')).body).toHaveLength(0);
      await modeler.get(`/spaces/${spaceId}`).expect(404);
      await modeler.get(`/pages/${page.id}`).expect(404);
      // viewer: view grant, read-only
      await viewer.get(`/pages/${page.id}`).expect(200);
      await save(viewer, page.id, {}).expect(403);
      // QA department: edit grant
      const got = (await qa.get(`/pages/${page.id}`).expect(200)).body;
      expect(got.canEdit).toBe(true);
      await save(qa, page.id, {}).expect(200);

      await admin
        .put(`/spaces/${spaceId}/permissions`)
        .send({
          viewRestricted: false,
          editRestricted: false,
          grants: [{ principalType: 'USER', principalId: dept.id, access: 'VIEW' }],
        })
        .expect(400);
    });

    it('cannot delete a space that still has pages', async () => {
      const page = (await newPage(admin)).body;
      expect((await admin.delete(`/spaces/${spaceId}`)).body.code).toBe('SPACE_NOT_EMPTY');
      await admin.delete(`/pages/${page.id}`).expect(204);
      await admin.delete(`/spaces/${spaceId}`).expect(204);
      await admin.get(`/spaces/${spaceId}`).expect(404);
    });
  });

  describe('pages', () => {
    it('creates a page from a template as version 1', async () => {
      const tpl = (
        await admin
          .post('/templates')
          .send({ nameEn: 'SOP', contentEn: '<h2>Purpose</h2>', contentAr: '<h2>الغرض</h2>' })
          .expect(201)
      ).body;
      const page = (await newPage(modeler, { templateId: tpl.id }).expect(201)).body;
      expect(page).toMatchObject({
        version: 1,
        contentEn: '<h2>Purpose</h2>',
        contentAr: '<h2>الغرض</h2>',
        dirEn: 'ltr',
        dirAr: 'rtl',
        hasEn: true,
        hasAr: true,
        canEdit: true,
      });
      const versions = (await modeler.get(`/pages/${page.id}/versions`).expect(200)).body;
      expect(versions[0]).toMatchObject({
        versionNumber: 1,
        changeNote: 'Created from template: SOP',
      });
      await newPage(viewer).expect(403);
      await newPage(modeler, { titleEn: '', titleAr: '' }).expect(400);
    });

    it('explicit saves create versions, are sanitised and detect conflicts', async () => {
      const page = (await newPage(modeler)).body;
      const saved = (
        await save(modeler, page.id, {
          contentEn:
            '<p onclick="x()">Hello<script>alert(1)</script> <a href="javascript:alert(1)">x</a></p>',
          contentAr: '<p dir="rtl">مرحبا</p>',
          dirAr: 'rtl',
          changeNote: 'Content',
          baseVersion: 1,
        }).expect(200)
      ).body;
      expect(saved.version).toBe(2);
      expect(saved.contentEn).toBe('<p>Hello <a>x</a></p>');
      expect(saved.contentAr).toBe('<p dir="rtl">مرحبا</p>');
      expect((await save(modeler, page.id, { baseVersion: 1 })).body.code).toBe('PAGE_CHANGED');
      await save(modeler, page.id, { changeNote: '' }).expect(400);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { entityType: 'Page', action: 'VERSION' },
      });
      expect(audit?.summary).toMatchObject({ versionNumber: 2, changeNote: 'Content' });
    });

    it('autosave drafts are per user and never create versions', async () => {
      const page = (await newPage(modeler)).body;
      expect((await modeler.get(`/pages/${page.id}/draft`).expect(200)).body.draft).toBeNull();
      await modeler
        .put(`/pages/${page.id}/draft`)
        .send({ titleEn: 'Doc', contentEn: '<p>WIP</p>', baseVersion: 1 })
        .expect(200);
      expect((await modeler.get(`/pages/${page.id}/draft`)).body.draft).toMatchObject({
        contentEn: '<p>WIP</p>',
        baseVersion: 1,
      });
      expect((await admin.get(`/pages/${page.id}/draft`)).body.draft).toBeNull();
      expect((await modeler.get(`/pages/${page.id}`)).body.version).toBe(1);
      expect((await modeler.get(`/pages/${page.id}/versions`)).body).toHaveLength(1);
      // An explicit save clears the draft
      await save(modeler, page.id, { contentEn: '<p>Done</p>' }).expect(200);
      expect((await modeler.get(`/pages/${page.id}/draft`)).body.draft).toBeNull();
      await viewer.put(`/pages/${page.id}/draft`).send({ titleEn: 'x' }).expect(403);
    });

    it('builds a tree, moves pages and shows breadcrumbs', async () => {
      const a = (await newPage(modeler, { titleEn: 'A' })).body;
      const b = (await newPage(modeler, { titleEn: 'B' })).body;
      const c = (await newPage(modeler, { titleEn: 'C', parentId: a.id })).body;
      let tree = (
        await modeler.post(`/pages/${b.id}/move`).send({ parentId: a.id, index: 0 }).expect(200)
      ).body;
      const children = tree
        .filter((p: { parentId: string }) => p.parentId === a.id)
        .sort((x: { sortOrder: number }, y: { sortOrder: number }) => x.sortOrder - y.sortOrder)
        .map((p: { id: string }) => p.id);
      expect(children).toEqual([b.id, c.id]);
      await modeler.post(`/pages/${a.id}/move`).send({ parentId: c.id, index: 0 }).expect(400);
      const got = (await modeler.get(`/pages/${b.id}`)).body;
      expect(got.ancestors).toEqual([expect.objectContaining({ id: a.id, titleEn: 'A' })]);
      expect((await modeler.get(`/pages/${a.id}`)).body.children).toHaveLength(2);
      await viewer.post(`/pages/${b.id}/move`).send({ parentId: null, index: 0 }).expect(403);
      tree = (await viewer.get(`/spaces/${spaceId}/pages`).expect(200)).body;
      expect(tree).toHaveLength(3);
    });

    it('soft-deletes into the trash, restores and purges', async () => {
      const a = (await newPage(modeler, { titleEn: 'A' })).body;
      const a1 = (await newPage(modeler, { titleEn: 'A1', parentId: a.id })).body;
      await modeler.delete(`/pages/${a.id}`).expect(204);
      await modeler.get(`/pages/${a1.id}`).expect(404);
      expect((await modeler.get(`/spaces/${spaceId}/pages`)).body).toHaveLength(0);
      let trash = (await modeler.get(`/spaces/${spaceId}/trash`).expect(200)).body;
      expect(trash).toEqual([expect.objectContaining({ id: a.id, descendantCount: 1 })]);
      await viewer.get(`/spaces/${spaceId}/trash`).expect(403);

      await modeler.post(`/pages/${a.id}/restore`).expect(200);
      expect((await modeler.get(`/pages/${a1.id}`).expect(200)).body.parentId).toBe(a.id);

      // Deleting the child first and then the parent: the child restores to the top level
      await modeler.delete(`/pages/${a1.id}`).expect(204);
      await modeler.delete(`/pages/${a.id}`).expect(204);
      trash = (await modeler.get(`/spaces/${spaceId}/trash`)).body;
      expect(trash).toHaveLength(2);
      await modeler.post(`/pages/${a1.id}/restore`).expect(200);
      expect((await modeler.get(`/pages/${a1.id}`)).body.parentId).toBeNull();

      await modeler.delete(`/pages/${a.id}/purge`).expect(403);
      await admin.delete(`/pages/${a.id}/purge`).expect(204);
      expect(await ctx.prisma.page.count({ where: { id: a.id } })).toBe(0);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'PURGE' } })).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'RESTORE', entityType: 'Page' } }),
      ).toBe(2);
    });
  });

  describe('versions', () => {
    it('lists, previews, restores (as a new version) and labels', async () => {
      const page = (await newPage(modeler)).body;
      await save(modeler, page.id, { contentEn: '<p>Two</p>', changeNote: 'v2' });
      await save(modeler, page.id, { contentEn: '<p>Three</p>', changeNote: 'v3' });
      const versions = (await modeler.get(`/pages/${page.id}/versions`)).body;
      expect(versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([3, 2, 1]);
      const v2 = versions[1];
      expect(
        (await viewer.get(`/pages/${page.id}/versions/${v2.id}`).expect(200)).body.contentEn,
      ).toBe('<p>Two</p>');

      await viewer.post(`/pages/${page.id}/versions/${v2.id}/restore`).send({}).expect(403);
      const restored = (
        await modeler.post(`/pages/${page.id}/versions/${v2.id}/restore`).send({}).expect(200)
      ).body;
      expect(restored).toMatchObject({ version: 4, contentEn: '<p>Two</p>' });
      const after = (await modeler.get(`/pages/${page.id}/versions`)).body;
      expect(after).toHaveLength(4);
      expect(after[0]).toMatchObject({
        versionNumber: 4,
        restoredFrom: 2,
        changeNote: 'Restored version 2',
      });

      const labelled = (
        await modeler
          .patch(`/pages/${page.id}/versions/${v2.id}`)
          .send({ label: 'v1.0 – approved by committee' })
          .expect(200)
      ).body;
      expect(labelled.find((v: { id: string }) => v.id === v2.id).label).toBe(
        'v1.0 – approved by committee',
      );
      await modeler.patch(`/pages/${page.id}/versions/${v2.id}`).send({ label: null }).expect(200);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'LABEL' } })).toBe(2);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'RESTORE', entityType: 'PageVersion' },
        }),
      ).toBe(1);
    });

    it('restores and labels process versions', async () => {
      const processId = (
        await modeler.post('/processes').send({ code: 'C.01', nameEn: 'Sales', category: 'CORE' })
      ).body.id;
      const v1 = (
        await modeler
          .post(`/processes/${processId}/versions`)
          .send({ bpmnXml: sampleBpmn(['A']), changeNote: 'one' })
      ).body;
      await modeler
        .post(`/processes/${processId}/versions`)
        .send({ bpmnXml: sampleBpmn(['B']), changeNote: 'two' });
      await viewer.post(`/processes/${processId}/versions/${v1.id}/restore`).send({}).expect(403);
      const v3 = (
        await modeler
          .post(`/processes/${processId}/versions/${v1.id}/restore`)
          .send({ changeNote: 'Back to A' })
          .expect(200)
      ).body;
      expect(v3).toMatchObject({ versionNumber: 3, restoredFrom: 1, changeNote: 'Back to A' });
      expect((await modeler.get(`/processes/${processId}/model`)).body.bpmnXml).toContain('id="A"');
      const list = (
        await modeler
          .patch(`/processes/${processId}/versions/${v1.id}`)
          .send({ label: 'Approved' })
          .expect(200)
      ).body;
      expect(list.find((v: { id: string }) => v.id === v1.id).label).toBe('Approved');
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'RESTORE', entityType: 'ProcessVersion' },
        }),
      ).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'LABEL', entityType: 'ProcessVersion' },
        }),
      ).toBe(1);
    });
  });

  describe('links, attachments, templates and export', () => {
    it('links pages to processes and objects, including embedded diagrams', async () => {
      const processId = (
        await modeler.post('/processes').send({ code: 'C.01', nameEn: 'Sales', category: 'CORE' })
      ).body.id;
      const roleId = (await modeler.post('/objects').send({ type: 'ROLE', nameEn: 'Clerk' })).body
        .id;
      const page = (await newPage(modeler)).body;
      let links = (
        await modeler
          .post(`/pages/${page.id}/links`)
          .send({ targetType: 'OBJECT', targetId: roleId })
          .expect(201)
      ).body;
      expect(links).toEqual([
        expect.objectContaining({
          targetType: 'OBJECT',
          object: expect.objectContaining({ nameEn: 'Clerk' }),
        }),
      ]);
      await viewer
        .post(`/pages/${page.id}/links`)
        .send({ targetType: 'PROCESS', targetId: processId })
        .expect(403);
      await modeler
        .post(`/pages/${page.id}/links`)
        .send({ targetType: 'PROCESS', targetId: roleId })
        .expect(400);

      // Embedding the diagram links the process automatically
      await save(modeler, page.id, {
        contentEn: `<div data-type="bpmn-diagram" data-process-id="${processId}"></div>`,
      }).expect(200);
      links = (await modeler.get(`/pages/${page.id}/links`)).body;
      expect(
        links.find((l: { process: { id: string } | null }) => l.process?.id === processId).embedded,
      ).toBe(true);
      const related = (await viewer.get(`/processes/${processId}/pages`).expect(200)).body;
      expect(related).toEqual([
        expect.objectContaining({ id: page.id, space: expect.objectContaining({ key: 'QM' }) }),
      ]);
      expect((await viewer.get(`/objects/${roleId}/pages`).expect(200)).body).toHaveLength(1);
      // Removing the diagram removes the automatic link
      await save(modeler, page.id, { contentEn: '<p>none</p>' }).expect(200);
      expect((await viewer.get(`/processes/${processId}/pages`)).body).toHaveLength(0);

      const linkId = (await modeler.get(`/pages/${page.id}/links`)).body[0].id;
      await modeler.delete(`/pages/${page.id}/links/${linkId}`).expect(200);
      expect((await modeler.get(`/pages/${page.id}/links`)).body).toHaveLength(0);
    });

    it('uploads attachments with type checks and serves them safely', async () => {
      const page = (await newPage(modeler)).body;
      const img = (
        await modeler
          .post(`/pages/${page.id}/attachments`)
          .attach('file', PNG_BYTES, { filename: 'chart.png', contentType: 'image/png' })
          .expect(201)
      ).body;
      expect(img).toMatchObject({ fileName: 'chart.png', contentType: 'image/png', isImage: true });
      await modeler
        .post(`/pages/${page.id}/attachments`)
        .attach('file', Buffer.from('<script>alert(1)</script>'), {
          filename: 'evil.png',
          contentType: 'image/png',
        })
        .expect(400);
      await modeler
        .post(`/pages/${page.id}/attachments`)
        .attach('file', Buffer.from('MZ'), { filename: 'tool.exe' })
        .expect(400);
      await viewer
        .post(`/pages/${page.id}/attachments`)
        .attach('file', PNG_BYTES, { filename: 'x.png' })
        .expect(403);
      const doc = (
        await modeler
          .post(`/pages/${page.id}/attachments`)
          .attach('file', Buffer.from('a,b\n1,2'), { filename: 'data.csv' })
          .expect(201)
      ).body;

      const res = await viewer.get(img.url.replace('/api/v1', '')).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toMatch(/^inline/);
      expect(res.headers['content-security-policy']).toContain('sandbox');
      const csv = await viewer.get(doc.url.replace('/api/v1', '')).expect(200);
      expect(csv.headers['content-disposition']).toMatch(/^attachment/);
      expect(csv.headers['x-content-type-options']).toBe('nosniff');

      // Images in content must point at attachments
      const saved = (
        await save(modeler, page.id, {
          contentEn: `<p><img src="${img.url}"><img src="https://x/y.png"></p>`,
        })
      ).body;
      expect(saved.contentEn).toBe(`<p><img src="${img.url}"></p>`);

      await viewer.delete(`/attachments/${doc.id}`).expect(403);
      await modeler.delete(`/attachments/${doc.id}`).expect(204);
      expect((await viewer.get(`/pages/${page.id}/attachments`)).body).toHaveLength(1);
    });

    it('templates: everyone reads, admins manage, built-ins cannot be deleted', async () => {
      const builtIn = await ctx.prisma.pageTemplate.create({
        data: { key: 'SOP', nameEn: 'SOP', isSystem: true },
      });
      await modeler.post('/templates').send({ nameEn: 'X' }).expect(403);
      const t = (
        await admin
          .post('/templates')
          .send({ nameEn: 'Checklist', contentEn: '<p>x<script></script></p>' })
          .expect(201)
      ).body;
      expect(t.contentEn).toBe('<p>x</p>');
      expect((await viewer.get('/templates').expect(200)).body).toHaveLength(2);
      await admin
        .put(`/templates/${t.id}`)
        .send({ nameEn: 'Checklist 2', nameAr: 'قائمة' })
        .expect(200);
      expect((await admin.delete(`/templates/${builtIn.id}`)).body.code).toBe('TEMPLATE_SYSTEM');
      await admin.delete(`/templates/${t.id}`).expect(204);
      expect((await viewer.get('/templates')).body).toHaveLength(1);
    });

    it('exports a page to Markdown with front-matter', async () => {
      const page = (await newPage(modeler)).body;
      await save(modeler, page.id, {
        contentEn: '<h2>Scope</h2><ul><li><p>One</p></li></ul>',
        contentAr: '<p>نطاق</p>',
      });
      const res = await viewer.get(`/pages/${page.id}/export/markdown?lang=en`).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/markdown/);
      expect(res.text).toContain(`id: "${page.id}"`);
      expect(res.text).toContain('language: "en"');
      expect(res.text).toContain('version: 2');
      expect(res.text).toContain('# Doc\n\n## Scope');
      const ar = await viewer.get(`/pages/${page.id}/export/markdown?lang=ar`).expect(200);
      expect(ar.text).toContain('# وثيقة');
      await viewer.get(`/pages/${page.id}/export/markdown?lang=fr`).expect(400);
    });
  });

  describe('search', () => {
    it('finds pages in English and Arabic with highlights and respects permissions', async () => {
      const page = (
        await newPage(modeler, {
          titleEn: 'Purchase approval procedure',
          titleAr: 'إجراءات الموافقة',
        })
      ).body;
      await save(modeler, page.id, {
        titleEn: 'Purchase approval procedure',
        titleAr: 'إجراءات الموافقة',
        contentEn: '<p>Managers approve every purchase request above the limit.</p>',
        contentAr: '<p>يعتمد المدير كل طلبات الشراء التي تتجاوز الحد.</p>',
      });
      await modeler.post('/processes').send({
        code: 'S.01',
        nameEn: 'Procure to Pay',
        nameAr: 'من الشراء إلى الدفع',
        descriptionEn: 'Purchasing goods and paying suppliers',
        category: 'SUPPORT',
      });

      let res = (await viewer.get('/search?q=approves').expect(200)).body;
      expect(res.items).toEqual([expect.objectContaining({ type: 'page', id: page.id })]);
      expect(res.items[0].snippet).toContain('approve');
      expect(res.items[0].space).toMatchObject({ key: 'QM' });

      res = (await viewer.get(`/search?q=${encodeURIComponent('الإجراءات')}`)).body;
      expect(res.items.map((i: { id: string }) => i.id)).toContain(page.id);
      res = (await viewer.get(`/search?q=${encodeURIComponent('طلب الشراء')}`)).body;
      expect(res.items.map((i: { id: string }) => i.id)).toContain(page.id);

      res = (await viewer.get('/search?q=purchas')).body;
      expect(res.items.map((i: { type: string }) => i.type).sort()).toEqual(['page', 'process']);
      expect((await viewer.get('/search?q=S.01&type=processes')).body.items[0]).toMatchObject({
        code: 'S.01',
      });
      expect((await viewer.get('/search?q=purchase&type=pages')).body.total).toBe(1);
      expect((await viewer.get(`/search?q=purchase&spaceId=${spaceId}`)).body.total).toBe(1);

      const adminId = (
        await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })
      ).id;
      expect(
        (await viewer.get(`/search?q=purchase&type=pages&authorId=${adminId}`)).body.total,
      ).toBe(0);
      await viewer.get('/search').expect(400);
      expect((await viewer.get('/search?q=%21%21')).body.total).toBe(0);

      // Restricted spaces disappear from the results
      await admin
        .put(`/spaces/${spaceId}/permissions`)
        .send({ viewRestricted: true, editRestricted: false, grants: [] })
        .expect(200);
      expect((await viewer.get('/search?q=purchase&type=pages')).body.total).toBe(0);
      expect((await admin.get('/search?q=purchase&type=pages')).body.total).toBe(1);
    });
  });
});
