import { attachmentUrl } from '@processhub/shared';
import { NotificationsService } from '../src/notifications/notifications.service';
import { GitSyncService } from '../src/integrations/git-sync.service';
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

/**
 * Knowledge Portal: Viewers see published content only. The tests build items in every
 * lifecycle state and prove that nothing unpublished is reachable through any endpoint.
 */
describe('Knowledge Portal (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let owner: Client;
  let viewer: Client;
  let ids: Record<string, string>;
  let deptId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const versionXml = (tasks: string[], extra = '') =>
    sampleBpmn(tasks).replace('</bpmn:process>', `${extra}</bpmn:process>`);

  const approveAndPublish = async (
    type: 'processes' | 'pages',
    id: string,
    label?: string,
    author: Client = modeler,
  ) => {
    await author.post(`/governance/${type}/${id}/submit`).send({}).expect(200);
    const review = (await reviewer.get('/tasks').expect(200)).body.reviews.find(
      (r: { item: { entityId: string } }) => r.item.entityId === id,
    );
    await reviewer.post(`/reviews/${review.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    await author
      .post(`/governance/${type}/${id}/publish`)
      .send({ versionLabel: label })
      .expect(200);
  };

  const process = async (code: string, nameEn: string, parentId?: string) =>
    (
      await admin
        .post('/processes')
        .send({
          code,
          nameEn,
          nameAr: 'عملية',
          category: 'CORE',
          ownerId: ids.owner,
          parentId,
          departmentId: deptId,
        })
        .expect(201)
    ).body.id as string;

  const version = (id: string, xml: string) =>
    modeler.post(`/processes/${id}/versions`).send({ bpmnXml: xml, changeNote: 'v' }).expect(201);

  let p: Record<string, string>;
  let pages: Record<string, string>;
  let spaces: Record<string, string>;
  let attachmentIds: Record<string, string>;
  let jobRole: string;

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    deptId = (
      await ctx.prisma.department.create({ data: { nameEn: 'Operations', nameAr: 'العمليات' } })
    ).id;
    const users = {
      admin: await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']),
      modeler: await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']),
      reviewer: await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']),
      owner: await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']),
      viewer: await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER'], {
        departmentId: deptId,
      }),
      outsider: await createUser(ctx.prisma, 'outsider@test.local', ['VIEWER']),
    };
    ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id]));
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');

    const wf = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Review',
          steps: [{ nameEn: 'Review', assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }] }],
        })
        .expect(201)
    ).body.id;
    await admin
      .put('/governance/settings')
      .send({
        reviewIntervalMonths: 12,
        reminderDays: 14,
        reviewDueDays: 5,
        defaultWorkflowId: wf,
        categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
      })
      .expect(200);

    jobRole = (
      await ctx.prisma.repoObject.create({
        data: { type: 'ROLE', nameEn: 'Buyer', nameAr: 'مشتري' },
      })
    ).id;
    await admin
      .patch(`/users/${ids.viewer}`)
      .send({ jobRoleIds: [jobRole] })
      .expect(200);

    // Processes in every state.
    p = {
      published: await process('C.01', 'Purchasing'),
      draft: await process('C.02', 'Unpublished Secret Process'),
      review: await process('C.03', 'Process In Review'),
      archived: await process('C.04', 'Archived Process'),
    };
    p.child = await process('C.02.01', 'Published Child', p.draft);
    await version(
      p.published,
      versionXml(['Task_1'], '<bpmn:callActivity id="Call_1" ph:linkedProcessId="CHILD" />'),
    );
    await modeler
      .post(`/processes/${p.published}/links`)
      .send({ bpmnElementId: 'Task_1', repoObjectId: jobRole })
      .expect(201);
    // Fix up the drill-down target now that the child id is known.
    await version(
      p.published,
      versionXml(['Task_1'], `<bpmn:callActivity id="Call_1" ph:linkedProcessId="${p.child}" />`),
    );
    await approveAndPublish('processes', p.published, 'v1.0');
    // A newer draft with content that must stay invisible.
    await admin
      .patch(`/processes/${p.published}`)
      .send({ nameEn: 'Renamed Draft Name' })
      .expect(200);
    await version(p.published, versionXml(['Task_1', 'SecretDraftStep']));

    await version(p.review, versionXml(['Task_1']));
    await modeler.post(`/governance/processes/${p.review}/submit`).send({}).expect(200);
    await version(p.archived, versionXml(['Task_1']));
    await approveAndPublish('processes', p.archived);
    await owner.post(`/governance/processes/${p.archived}/archive`).send({}).expect(200);
    await version(p.child, versionXml(['Child_Task']));
    await approveAndPublish('processes', p.child);
    await version(p.draft, versionXml(['Task_1']));

    // Documentation: an open space and a restricted one.
    spaces = {
      open: (await admin.post('/spaces').send({ key: 'QM', nameEn: 'Quality' }).expect(201)).body
        .id,
      closed: (
        await admin.post('/spaces').send({ key: 'HR', nameEn: 'HR confidential' }).expect(201)
      ).body.id,
    };
    await admin
      .put(`/spaces/${spaces.closed}/permissions`)
      .send({
        viewRestricted: true,
        editRestricted: false,
        grants: [{ principalType: 'ROLE', principalId: 'REVIEWER', access: 'VIEW' }],
      })
      .expect(200);
    const newPage = async (space: string, titleEn: string, author: Client = modeler) =>
      (await author.post(`/spaces/${space}/pages`).send({ titleEn, titleAr: 'صفحة' }).expect(201))
        .body.id as string;
    pages = {
      published: await newPage(spaces.open, 'Procurement policy'),
      draft: await newPage(spaces.open, 'Draft only page'),
      closed: await newPage(spaces.closed, 'Salary bands', admin),
    };
    const upload = async (pageId: string) =>
      (
        await modeler
          .post(`/pages/${pageId}/attachments`)
          .attach('file', PNG_BYTES, { filename: 'chart.png', contentType: 'image/png' })
          .expect(201)
      ).body.id as string;
    attachmentIds = { published: await upload(pages.published), draft: await upload(pages.draft) };
    await modeler
      .put(`/pages/${pages.published}`)
      .send({
        titleEn: 'Procurement policy',
        titleAr: 'سياسة المشتريات',
        contentEn: `<p>Every purchase needs approval.</p><img src="${attachmentUrl(attachmentIds.published)}">`,
        contentAr: '<p>كل عملية شراء تحتاج إلى موافقة.</p>',
        changeNote: 'Content',
      })
      .expect(200);
    await modeler
      .post(`/pages/${pages.published}/links`)
      .send({ targetType: 'PROCESS', targetId: p.published })
      .expect(201);
    await approveAndPublish('pages', pages.published);
    await modeler
      .put(`/pages/${pages.published}`)
      .send({
        titleEn: 'Procurement policy',
        contentEn: '<p>Leaked draft sentence</p>',
        changeNote: 'Draft',
      })
      .expect(200);
    await modeler
      .put(`/pages/${pages.draft}`)
      .send({
        titleEn: 'Draft only page',
        contentEn: `<img src="${attachmentUrl(attachmentIds.draft)}">`,
        changeNote: 'x',
      })
      .expect(200);
    await approveAndPublish('pages', pages.closed, undefined, admin);
  });

  it('the process tree and process pages show only the published version', async () => {
    const tree = (await viewer.get('/portal/processes').expect(200)).body;
    expect(tree.map((n: { id: string }) => n.id).sort()).toEqual([p.published, p.child].sort());
    // The unpublished parent is skipped: the child becomes a root.
    expect(tree.find((n: { id: string }) => n.id === p.child).parentId).toBeNull();
    expect(JSON.stringify(tree)).not.toMatch(
      /Renamed Draft Name|Unpublished Secret|In Review|Archived/,
    );

    const detail = (await viewer.get(`/portal/processes/${p.published}`).expect(200)).body;
    expect(detail).toMatchObject({
      nameEn: 'Purchasing',
      code: 'C.01',
      meta: { versionNumber: 2, versionLabel: 'v1.0', owner: { id: ids.owner } },
      department: { nameEn: 'Operations' },
      drillTargets: [{ id: p.child }],
      relatedPages: [{ id: pages.published, titleEn: 'Procurement policy' }],
    });
    expect(detail.meta.approvedBy.map((u: { id: string }) => u.id)).toEqual([ids.reviewer]);
    expect(detail.bpmnXml).not.toContain('SecretDraftStep');
    expect(detail.links).toEqual([
      expect.objectContaining({
        bpmnElementId: 'Task_1',
        relation: 'PERFORMS',
        object: expect.objectContaining({ nameEn: 'Buyer' }),
      }),
    ]);

    for (const id of [p.draft, p.review, p.archived]) {
      await viewer.get(`/portal/processes/${id}`).expect(404);
    }
  });

  it('viewers cannot reach any workspace endpoint', async () => {
    const review = await ctx.prisma.review.findFirstOrThrow({ where: { entityId: p.review } });
    const forbidden = [
      '/processes',
      '/processes/tree',
      `/processes/${p.draft}`,
      `/processes/${p.published}/model`,
      `/processes/${p.published}/versions`,
      `/processes/${p.published}/links`,
      `/processes/${p.published}/pages`,
      '/spaces',
      `/spaces/${spaces.open}/pages`,
      `/pages/${pages.draft}`,
      `/pages/${pages.published}`,
      `/pages/${pages.published}/versions`,
      `/pages/${pages.published}/export/markdown`,
      `/attachments/${attachmentIds.published}/content`,
      '/objects',
      '/search?q=secret',
      `/comments/processes/${p.draft}`,
      `/governance/processes/${p.review}`,
      `/governance/processes/${p.review}/reviews`,
      '/governance/dashboard',
      '/workflows',
      '/users',
      '/users/directory',
      '/departments',
      '/audit-logs',
    ];
    for (const path of forbidden) {
      const res = await viewer.get(path);
      expect([path, res.status]).toEqual([path, 403]);
    }
    // Reviews are only for assignees and readers of the item.
    await viewer.get(`/reviews/${review.id}`).expect(404);
    await viewer.post(`/reviews/${review.id}/decision`).send({ decision: 'APPROVE' }).expect(403);
    await viewer.post(`/comments/processes/${p.published}`).send({ body: 'hi' }).expect(403);
    await viewer.post(`/governance/processes/${p.draft}/submit`).send({}).expect(403);
    const tasks = (await viewer.get('/tasks').expect(200)).body;
    expect(tasks).toMatchObject({ reviews: [], toPublish: [], dueReviews: [] });
  });

  it('documentation: published pages of visible spaces only, published content and files', async () => {
    const list = (await viewer.get('/portal/spaces').expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id: spaces.open, key: 'QM', pageCount: 1 })]);
    await viewer.get(`/portal/spaces/${spaces.closed}/pages`).expect(404);
    const tree = (await viewer.get(`/portal/spaces/${spaces.open}/pages`).expect(200)).body;
    expect(tree.map((n: { id: string }) => n.id)).toEqual([pages.published]);

    const page = (await viewer.get(`/portal/pages/${pages.published}`).expect(200)).body;
    expect(page.contentEn).toContain('Every purchase needs approval');
    expect(page.contentEn).not.toContain('Leaked draft');
    expect(page.meta.versionNumber).toBe(2);
    expect(page.relatedProcesses).toEqual([
      expect.objectContaining({ id: p.published, titleEn: 'Purchasing' }),
    ]);
    await viewer.get(`/portal/pages/${pages.draft}`).expect(404);
    await viewer.get(`/portal/pages/${pages.closed}`).expect(404);
    // A reviewer has a grant on the restricted space.
    await reviewer.get(`/portal/pages/${pages.closed}`).expect(200);

    const file = await viewer
      .get(`/portal/attachments/${attachmentIds.published}/content`)
      .expect(200);
    expect(file.headers['content-security-policy']).toContain('sandbox');
    await viewer.get(`/portal/attachments/${attachmentIds.draft}/content`).expect(404);
  });

  it('search finds published content only, in English and Arabic', async () => {
    const search = async (q: string, extra = '') =>
      (await viewer.get(`/portal/search?q=${encodeURIComponent(q)}${extra}`).expect(200)).body;
    expect((await search('purchase')).items.map((i: { id: string }) => i.id)).toContain(
      pages.published,
    );
    const ar = await search('موافقة');
    expect(ar.items[0]).toMatchObject({ id: pages.published, type: 'PAGE' });
    expect(ar.items[0].snippet).toContain('');
    expect((await search('C.01')).items[0]).toMatchObject({ id: p.published, code: 'C.01' });
    for (const q of ['SecretDraftStep', 'Renamed', 'Unpublished', 'Leaked', 'Salary', 'Archived']) {
      expect([q, (await search(q)).total]).toEqual([q, 0]);
    }
    expect(
      (await search('purchase', '&type=processes')).items.every(
        (i: { type: string }) => i.type === 'PROCESS',
      ),
    ).toBe(true);
  });

  it('home, my processes and portal settings', async () => {
    await viewer
      .put('/portal/settings')
      .send({ access: { mode: 'ALL' } })
      .expect(403);
    await admin
      .put('/portal/settings')
      .send({
        nameEn: 'Company Handbook',
        access: { mode: 'ALL' },
        quickLinks: [{ titleEn: 'HR', url: 'https://intranet.example.com/hr' }],
        featured: [
          { entityType: 'PROCESS', entityId: p.published },
          { entityType: 'PROCESS', entityId: p.draft },
        ],
      })
      .expect(200);
    const home = (await viewer.get('/portal/home').expect(200)).body;
    expect(home).toMatchObject({
      nameEn: 'Company Handbook',
      counts: { processes: 2, pages: 1 },
      canManage: false,
    });
    expect(home.featured.map((f: { id: string }) => f.id)).toEqual([p.published]);
    expect(home.quickLinks).toHaveLength(1);
    expect(JSON.stringify(home)).not.toMatch(/Unpublished Secret|Salary/);

    const my = (await viewer.get('/portal/my').expect(200)).body;
    expect(my.jobRoles).toEqual([expect.objectContaining({ nameEn: 'Buyer' })]);
    const purchasing = my.processes.find((x: { id: string }) => x.id === p.published);
    expect(purchasing.reasons.sort()).toEqual(['DEPARTMENT', 'ROLE']);
    expect(purchasing.steps).toEqual([{ bpmnElementId: 'Task_1', nameEn: 'Task_1', nameAr: '' }]);
    expect(my.pages.map((x: { id: string }) => x.id)).toEqual([pages.published]);
  });

  it('portal access can be limited to departments or roles', async () => {
    await admin
      .put('/portal/settings')
      .send({ access: { mode: 'RESTRICTED', departmentIds: [deptId], roleKeys: ['REVIEWER'] } })
      .expect(200);
    const outsider = await loggedIn(ctx.app, 'outsider@test.local');
    const res = await outsider.get('/portal/home').expect(403);
    expect(res.body.code).toBe('PORTAL_FORBIDDEN');
    await outsider.get(`/portal/processes/${p.published}`).expect(403);
    await outsider.get('/portal/search?q=purchase').expect(403);
    await viewer.get('/portal/home').expect(200);
    await reviewer.get('/portal/home').expect(200);
    await admin.get('/portal/home').expect(200);
    await modeler.get('/portal/home').expect(403);
  });

  it('feedback is routed to the owner, tracked and answered', async () => {
    await viewer
      .post('/feedback')
      .send({ entityType: 'PROCESS', entityId: p.draft, kind: 'OUTDATED', message: 'x' })
      .expect(404);
    const fb = (
      await viewer
        .post('/feedback')
        .send({
          entityType: 'PROCESS',
          entityId: p.published,
          kind: 'IMPROVEMENT',
          message: 'Add the budget check',
        })
        .expect(201)
    ).body;
    expect(fb).toMatchObject({ status: 'OPEN', assignee: { id: ids.owner }, canManage: false });
    const tasks = (await owner.get('/tasks').expect(200)).body;
    expect(tasks.feedback).toEqual([expect.objectContaining({ id: fb.id, canManage: true })]);

    await viewer.patch(`/feedback/${fb.id}`).send({ status: 'DONE' }).expect(403);
    await reviewer.patch(`/feedback/${fb.id}`).send({ status: 'DONE' }).expect(404);
    await owner
      .patch(`/feedback/${fb.id}`)
      .send({ status: 'IN_PROGRESS', reply: 'Planned for v2' })
      .expect(200);

    const mine = (await viewer.get('/feedback?scope=mine').expect(200)).body;
    expect(mine.items[0]).toMatchObject({
      status: 'IN_PROGRESS',
      reply: 'Planned for v2',
      repliedBy: { id: ids.owner },
    });
    expect(
      (await viewer.get(`/portal/processes/${p.published}/feedback`).expect(200)).body,
    ).toHaveLength(1);
    await viewer.get('/feedback?scope=all').expect(403);
    await ctx.app.get(NotificationsService).whenIdle();
    const types = (await ctx.prisma.notification.findMany()).map((n) => [n.userId, n.type]);
    expect(types).toEqual(
      expect.arrayContaining([
        [ids.owner, 'FEEDBACK_RECEIVED'],
        [ids.viewer, 'FEEDBACK_UPDATED'],
      ]),
    );
    expect((await viewer.get('/notifications').expect(200)).body.items[0]).toMatchObject({
      type: 'FEEDBACK_UPDATED',
      link: '/portal/feedback',
    });
  });

  it('Git export can be limited to published versions', async () => {
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    const superAdmin = await loggedIn(ctx.app, 'super@test.local');
    await superAdmin
      .put('/integrations/git')
      .send({
        enabled: true,
        provider: 'github',
        repository: 'acme/bpm',
        branch: 'main',
        folder: '',
        token: 'good-token',
        syncProcesses: true,
        syncPages: true,
        trigger: 'MANUAL',
        publishedOnly: true,
      })
      .expect(200);
    await superAdmin.post('/integrations/git/sync').send({ scope: 'all' }).expect(202);
    await ctx.app.get(GitSyncService).whenIdle();
    const files = [...ctx.git.files.keys()];
    const all = [...ctx.git.files.values()].join('\n');
    expect(files.some((f) => f.includes('C.01'))).toBe(true);
    expect(files.some((f) => f.includes('C.02.01'))).toBe(true);
    expect(files.some((f) => /C\.0[34]/.test(f))).toBe(false);
    expect(all).not.toMatch(/SecretDraftStep|Leaked draft|Salary bands|Draft only page/);
    expect(all).toContain('Every purchase needs approval');
  });
});
