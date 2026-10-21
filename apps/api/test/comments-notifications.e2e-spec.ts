import { mentionToken } from '@processhub/shared';
import { NotificationsService } from '../src/notifications/notifications.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

describe('Comments, notifications and email settings (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let viewer: Client;
  let superAdmin: Client;
  let ids: Record<string, string>;
  let processId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.sent = [];
    const users = {
      admin: await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']),
      super: await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']),
      modeler: await createUser(ctx.prisma, 'modeler@test.local', ['MODELER'], {
        nameEn: 'Mona Modeler',
      }),
      reviewer: await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER'], {
        nameEn: 'Rami Reviewer',
      }),
      viewer: await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']),
    };
    ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id]));
    admin = await loggedIn(ctx.app, 'admin@test.local');
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    processId = (
      await admin
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Hiring', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_1']) })
      .expect(200);
  });

  const idle = () => ctx.app.get(NotificationsService).whenIdle();

  it('threads, element comments, mentions, replies and resolve/reopen', async () => {
    let threads = (
      await modeler
        .post(`/comments/processes/${processId}`)
        .send({
          body: `Please check ${mentionToken('Rami Reviewer', ids.reviewer)} and ${mentionToken('V', ids.viewer)}`,
          bpmnElementId: 'Task_1',
        })
        .expect(201)
    ).body;
    expect(threads).toHaveLength(1);
    const root = threads[0];
    expect(root).toMatchObject({
      bpmnElementId: 'Task_1',
      element: { nameEn: 'Task_1' },
      canEdit: true,
      canResolve: true,
    });

    // The viewer cannot read the process, so the mention does not notify them.
    await idle();
    expect(await ctx.prisma.notification.count({ where: { userId: ids.viewer } })).toBe(0);
    const mention = await ctx.prisma.notification.findFirstOrThrow({
      where: { userId: ids.reviewer },
    });
    expect(mention).toMatchObject({
      type: 'MENTIONED',
      link: `/processes/${processId}?tab=comments&element=Task_1`,
    });
    expect(mention.params).toMatchObject({
      comment: 'Please check @Rami Reviewer and @V',
      code: 'S.01',
    });

    threads = (
      await reviewer
        .post(`/comments/processes/${processId}`)
        .send({ body: 'Done', parentId: root.id })
        .expect(201)
    ).body;
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0]).toMatchObject({
      bpmnElementId: 'Task_1',
      canEdit: true,
      canResolve: false,
    });
    await idle();
    expect(
      await ctx.prisma.notification.count({
        where: { userId: ids.modeler, type: 'COMMENT_REPLY' },
      }),
    ).toBe(1);

    await reviewer.post(`/comments/${root.id}/resolve`).expect(403);
    threads = (await modeler.post(`/comments/${root.id}/resolve`).expect(200)).body;
    expect(threads[0].resolvedBy).toMatchObject({ id: ids.modeler });
    threads = (await admin.post(`/comments/${root.id}/reopen`).expect(200)).body;
    expect(threads[0].resolvedAt).toBeNull();

    await reviewer.patch(`/comments/${root.id}`).send({ body: 'hijack' }).expect(403);
    threads = (await modeler.patch(`/comments/${root.id}`).send({ body: 'Edited' }).expect(200))
      .body;
    expect(threads[0]).toMatchObject({ body: 'Edited', editedAt: expect.any(String) });
    await reviewer.delete(`/comments/${root.id}`).expect(403);
    expect((await modeler.delete(`/comments/${root.id}`).expect(200)).body).toEqual([]);

    await viewer.post(`/comments/processes/${processId}`).send({ body: 'x' }).expect(403);
    await modeler.post(`/comments/processes/${processId}`).send({ body: '' }).expect(400);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { entityType: 'Comment' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE', 'RESOLVE', 'REOPEN']),
    );
  });

  it('page comments respect space restrictions', async () => {
    const space = (await admin.post('/spaces').send({ key: 'SEC', nameEn: 'Secret' }).expect(201))
      .body.id;
    const page = (await admin.post(`/spaces/${space}/pages`).send({ titleEn: 'P' }).expect(201))
      .body.id;
    await admin
      .put(`/spaces/${space}/permissions`)
      .send({ viewRestricted: true, editRestricted: false, grants: [] })
      .expect(200);
    await reviewer.get(`/comments/pages/${page}`).expect(404);
    await reviewer.post(`/comments/pages/${page}`).send({ body: 'x' }).expect(404);
    await admin
      .post(`/comments/pages/${page}`)
      .send({ body: 'ok', bpmnElementId: 'Task_1' })
      .expect(400);
    expect(
      (await admin.post(`/comments/pages/${page}`).send({ body: 'ok' }).expect(201)).body,
    ).toHaveLength(1);
  });

  it('notification centre: list, unread count, mark read, preferences', async () => {
    await modeler
      .post(`/comments/processes/${processId}`)
      .send({ body: `${mentionToken('R', ids.reviewer)} one` })
      .expect(201);
    await modeler
      .post(`/comments/processes/${processId}`)
      .send({ body: `${mentionToken('R', ids.reviewer)} two` })
      .expect(201);
    expect((await reviewer.get('/notifications/unread-count').expect(200)).body.count).toBe(2);
    const list = (await reviewer.get('/notifications').expect(200)).body;
    expect(list.items[0]).toMatchObject({
      type: 'MENTIONED',
      actor: { id: ids.modeler },
      readAt: null,
    });
    await modeler.post(`/notifications/${list.items[0].id}/read`).expect(404);
    expect(
      (await reviewer.post(`/notifications/${list.items[0].id}/read`).expect(200)).body.count,
    ).toBe(1);
    expect((await reviewer.get('/notifications?unread=true').expect(200)).body.total).toBe(1);
    expect((await reviewer.post('/notifications/read-all').expect(200)).body.count).toBe(0);

    const prefs = (await reviewer.get('/notifications/preferences').expect(200)).body;
    expect(prefs).toMatchObject({
      emailEnabled: false,
      prefs: { MENTIONED: { inApp: true, email: true } },
    });
    await reviewer
      .put('/notifications/preferences')
      .send({ prefs: { MENTIONED: { inApp: false, email: false } } })
      .expect(200);
    await modeler
      .post(`/comments/processes/${processId}`)
      .send({ body: `${mentionToken('R', ids.reviewer)} three` })
      .expect(201);
    expect(await ctx.prisma.notification.count({ where: { userId: ids.reviewer } })).toBe(2);
    await viewer.get('/notifications').expect(200);
  });

  it('email settings: Super Admin only, password write-only, test email, delivery and failures', async () => {
    await admin.get('/settings/email').expect(403);
    await superAdmin.put('/settings/email').send({ enabled: true, host: '' }).expect(400);
    const saved = (
      await superAdmin
        .put('/settings/email')
        .send({
          enabled: true,
          host: 'mailpit',
          port: 1025,
          fromAddress: 'hub@test.local',
          fromName: 'Hub',
          username: 'u',
          password: 'p4ss-secret',
        })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ hasPassword: true, host: 'mailpit' });
    expect(JSON.stringify(saved)).not.toContain('p4ss');
    const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'email' } });
    expect(JSON.stringify(row.value)).not.toContain('p4ss-secret');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { entityId: 'email' } });
    expect(JSON.stringify(audit.summary)).not.toContain('p4ss');

    expect(
      (await superAdmin.post('/settings/email/test').send({ to: 'me@test.local' }).expect(200))
        .body,
    ).toEqual({ ok: true, error: null });
    expect(ctx.mail.sent[0]).toMatchObject({ to: 'me@test.local', host: 'mailpit' });
    ctx.mail.failNext = true;
    const failed = (
      await superAdmin.post('/settings/email/test').send({ to: 'me@test.local' }).expect(200)
    ).body;
    expect(failed.ok).toBe(false);
    expect(failed.error).not.toContain('p4ss-secret');

    // Arabic recipient gets the Arabic template.
    await ctx.prisma.user.update({ where: { id: ids.reviewer }, data: { locale: 'ar' } });
    await modeler
      .post(`/comments/processes/${processId}`)
      .send({ body: `${mentionToken('R', ids.reviewer)} مرحبا` })
      .expect(201);
    await idle();
    const mail = ctx.mail.sent.find((m) => m.to === 'reviewer@test.local')!;
    expect(mail.subject).toContain('أشار إليك');
    expect(mail.html).toContain('dir="rtl"');
    const n = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: ids.reviewer } });
    expect(n.emailStatus).toBe('SENT');

    // Email preference off → no email, in-app still there.
    await reviewer
      .put('/notifications/preferences')
      .send({ prefs: { MENTIONED: { inApp: true, email: false } } })
      .expect(200);
    ctx.mail.sent = [];
    await modeler
      .post(`/comments/processes/${processId}`)
      .send({ body: `${mentionToken('R', ids.reviewer)} x` })
      .expect(201);
    await idle();
    expect(ctx.mail.sent).toHaveLength(0);

    ctx.mail.failNext = true;
    await reviewer
      .put('/notifications/preferences')
      .send({ prefs: { MENTIONED: { inApp: true, email: true } } })
      .expect(200);
    await modeler
      .post(`/comments/processes/${processId}`)
      .send({ body: `${mentionToken('R', ids.reviewer)} y` })
      .expect(201);
    await idle();
    const last = await ctx.prisma.notification.findFirstOrThrow({
      where: { userId: ids.reviewer },
      orderBy: { createdAt: 'desc' },
    });
    expect(last.emailStatus).toBe('FAILED');
    expect(last.emailError).not.toContain('p4ss-secret');
  });

  it('user directory and job roles', async () => {
    const dir = (await modeler.get('/users/directory?q=rami').expect(200)).body;
    expect(dir).toEqual([expect.objectContaining({ id: ids.reviewer, nameEn: 'Rami Reviewer' })]);
    expect(JSON.stringify(dir)).not.toContain('passwordHash');
    await viewer.get('/users/directory').expect(403);
    const role = await ctx.prisma.repoObject.create({
      data: { type: 'ROLE', nameEn: 'Recruiter' },
    });
    const system = await ctx.prisma.repoObject.create({ data: { type: 'SYSTEM', nameEn: 'ERP' } });
    await admin
      .patch(`/users/${ids.viewer}`)
      .send({ jobRoleIds: [system.id] })
      .expect(400);
    const u = (
      await admin
        .patch(`/users/${ids.viewer}`)
        .send({ jobRoleIds: [role.id] })
        .expect(200)
    ).body;
    expect(u.jobRoles).toEqual([expect.objectContaining({ nameEn: 'Recruiter' })]);
  });
});
