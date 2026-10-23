import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { Client, createApp, createUser, loggedIn, resetDb, type TestContext } from './helpers';

const SAMPLE = readFileSync(
  join(__dirname, '../../../docs/samples/PMS-01-Program-Request-Approval.bpmn'),
  'utf8',
);
const UNCOLOURED = SAMPLE.replace(/ (bioc|color):[a-z-]+="#[0-9A-Fa-f]{6}"/g, '').replace(
  / xmlns:(bioc|color)="[^"]+"/g,
  '',
);

describe('Diagram colour theme (e2e)', () => {
  let ctx: TestContext;
  let root: Client;
  let modeler: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'root@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    root = await loggedIn(ctx.app, 'root@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
  });

  const process = async (code: string, xml: string) => {
    const id = (await modeler.post('/processes').send({ code, nameEn: code, category: 'CORE' }))
      .body.id as string;
    await modeler.put(`/processes/${id}/model`).send({ bpmnXml: xml }).expect(200);
    return id;
  };

  it('Super Admin edits and resets the theme; everyone reads it from the public settings', async () => {
    const admin = await loggedIn(ctx.app, 'admin@test.local');
    const theme = { ...DEFAULT_DIAGRAM_THEME, gateway: { fill: '#abcdef', stroke: '#123456' } };
    await admin.put('/settings/diagram-theme').send(theme).expect(403);
    await modeler.delete('/settings/diagram-theme').expect(403);
    await root
      .put('/settings/diagram-theme')
      .send({ ...theme, gateway: { fill: 'yellow', stroke: '#123456' } })
      .expect(400);
    const res = await root.put('/settings/diagram-theme').send(theme).expect(200);
    expect(res.body.diagramTheme.gateway).toEqual({ fill: '#ABCDEF', stroke: '#123456' });
    const pub = await new Client(ctx.app).get('/settings/public').expect(200);
    expect(pub.body.diagramThemeCustomised).toBe(true);
    expect(pub.body.diagramTheme.gateway.fill).toBe('#ABCDEF');

    await root.delete('/settings/diagram-theme').expect(200);
    const after = await new Client(ctx.app).get('/settings/public');
    expect(after.body).toMatchObject({
      diagramTheme: DEFAULT_DIAGRAM_THEME,
      diagramThemeCustomised: false,
    });
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'Setting', entityId: 'branding.diagramTheme' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['UPDATE', 'DELETE']);
  });

  it('applies the theme to uncoloured elements of every working model (dry run first)', async () => {
    const plain = await process('C.01', UNCOLOURED);
    const coloured = await process('C.02', SAMPLE);
    await modeler.post('/settings/diagram-theme/apply').send({ dryRun: true }).expect(403);
    await root.post('/settings/diagram-theme/apply').send({}).expect(400);

    const dry = await root.post('/settings/diagram-theme/apply').send({ dryRun: true }).expect(200);
    expect(dry.body).toEqual({
      dryRun: true,
      models: 1,
      elements: 35,
      inPlace: 0,
      published: 0,
      skipped: 0,
    });
    expect(await ctx.prisma.processVersion.count()).toBe(0);

    const res = await root
      .post('/settings/diagram-theme/apply')
      .send({ dryRun: false })
      .expect(200);
    expect(res.body).toMatchObject({ dryRun: false, models: 1, elements: 35 });
    const versions = await ctx.prisma.processVersion.findMany();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ processId: plain, changeNote: 'Applied colour theme' });
    const model = await ctx.prisma.processModel.findUnique({ where: { processId: plain } });
    expect(model!.bpmnXml).toContain('color:background-color="#FBF3E0"');
    expect(model!.bpmnXml).toContain('ph:nameAr="مقدم الطلب (الموظف)"');
    // The already coloured model is untouched.
    const other = await ctx.prisma.processModel.findUnique({ where: { processId: coloured } });
    expect(other!.bpmnXml).toBe(SAMPLE);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityType: 'Setting', entityId: 'branding.diagramTheme', action: 'UPDATE' },
      }),
    ).toBe(1);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'VERSION' } })).toBe(1);

    // Nothing left to do on a second run.
    const again = await root
      .post('/settings/diagram-theme/apply')
      .send({ dryRun: true })
      .expect(200);
    expect(again.body.models).toBe(0);
  });

  it('shows Super Admins a one-time notice until it is dismissed or the theme is applied', async () => {
    await modeler.get('/settings/diagram-theme/notice').expect(403);
    expect((await root.get('/settings/diagram-theme/notice').expect(200)).body).toEqual({
      show: false,
      models: 0,
    });
    await process('C.20', UNCOLOURED);
    expect((await root.get('/settings/diagram-theme/notice').expect(200)).body).toEqual({
      show: true,
      models: 1,
    });
    await root.post('/settings/diagram-theme/notice/dismiss').expect(200);
    expect((await root.get('/settings/diagram-theme/notice').expect(200)).body.show).toBe(false);
    expect(
      await ctx.prisma.auditLog.count({ where: { entityId: 'branding.diagramThemeNotice' } }),
    ).toBe(1);

    // Applying the theme also closes it.
    await ctx.prisma.setting.delete({ where: { key: 'branding.diagramThemeNotice' } });
    await root.post('/settings/diagram-theme/apply').send({ dryRun: false }).expect(200);
    expect((await root.get('/settings/diagram-theme/notice').expect(200)).body.show).toBe(false);
  });

  it('skips processes locked by governance', async () => {
    const id = await process('C.03', UNCOLOURED);
    await ctx.prisma.process.update({ where: { id }, data: { status: 'IN_REVIEW' } });
    const res = await root
      .post('/settings/diagram-theme/apply')
      .send({ dryRun: false })
      .expect(200);
    expect(res.body).toMatchObject({ models: 0, skipped: 1 });
    expect(await ctx.prisma.processVersion.count()).toBe(0);
  });

  describe('approved and published processes (D-072)', () => {
    let reviewer: Client;
    let ownerId: string;

    beforeEach(async () => {
      await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
      ownerId = (await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'])).id;
      reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
      const wf = (
        await root
          .post('/workflows')
          .send({
            nameEn: 'Review',
            steps: [{ nameEn: 'Review', assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }] }],
          })
          .expect(201)
      ).body.id;
      await root
        .put('/governance/settings')
        .send({
          reviewIntervalMonths: 12,
          reminderDays: 14,
          reviewDueDays: 5,
          defaultWorkflowId: wf,
          categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
        })
        .expect(200);
    });

    /** A process whose version 1 (uncoloured) is approved, and published unless `publish` is false. */
    const official = async (code: string, publish = true) => {
      const id = (
        await root
          .post('/processes')
          .send({ code, nameEn: code, category: 'CORE', ownerId })
          .expect(201)
      ).body.id as string;
      await modeler
        .post(`/processes/${id}/versions`)
        .send({ bpmnXml: UNCOLOURED, changeNote: 'v1' })
        .expect(201);
      await modeler.post(`/governance/processes/${id}/submit`).send({}).expect(200);
      const review = (await reviewer.get('/tasks').expect(200)).body.reviews.find(
        (r: { item: { entityId: string } }) => r.item.entityId === id,
      );
      await reviewer
        .post(`/reviews/${review.id}/decision`)
        .send({ decision: 'APPROVE' })
        .expect(200);
      if (publish) await modeler.post(`/governance/processes/${id}/publish`).send({}).expect(200);
      return id;
    };

    it('recolours a published process in place when only colours change', async () => {
      const id = await official('C.10');
      const dry = await root
        .post('/settings/diagram-theme/apply')
        .send({ dryRun: true })
        .expect(200);
      expect(dry.body).toMatchObject({ models: 1, inPlace: 1, published: 0 });

      await root.post('/settings/diagram-theme/apply').send({ dryRun: false }).expect(200);
      const p = await ctx.prisma.process.findUniqueOrThrow({ where: { id } });
      expect(p.status).toBe('PUBLISHED');
      const v2 = await ctx.prisma.processVersion.findUniqueOrThrow({
        where: { processId_versionNumber: { processId: id, versionNumber: 2 } },
      });
      expect(v2).toMatchObject({
        changeNote: 'Applied colour theme',
        label: 'Theme applied (colours only)',
      });
      expect(v2.bpmnXml).toContain('color:background-color="#FBF3E0"');
      const pub = await ctx.prisma.publication.findFirstOrThrow({
        where: { entityId: id, current: true },
      });
      expect(pub.versionNumber).toBe(2);
      const model = await ctx.prisma.processModel.findUniqueOrThrow({ where: { processId: id } });
      expect(model.bpmnXml).toBe(v2.bpmnXml);
      // The portal serves the coloured published version.
      const portal = await root.get(`/portal/processes/${id}`).expect(200);
      expect(portal.body.bpmnXml).toContain('color:background-color="#FBF3E0"');
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'Process', entityId: id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.summary).toMatchObject({
        themeApplied: 'colours only',
        fromVersion: 1,
        toVersion: 2,
        publicationId: pub.id,
      });
    });

    it('moves the approval of an approved (unpublished) process to the coloured version', async () => {
      const id = await official('C.11', false);
      await root.post('/settings/diagram-theme/apply').send({ dryRun: false }).expect(200);
      expect((await ctx.prisma.process.findUniqueOrThrow({ where: { id } })).status).toBe(
        'APPROVED',
      );
      await modeler.post(`/governance/processes/${id}/publish`).send({}).expect(200);
      const pub = await ctx.prisma.publication.findFirstOrThrow({
        where: { entityId: id, current: true },
      });
      expect(pub.versionNumber).toBe(2);
    });

    it('falls back to a new draft when the model differs from the published version', async () => {
      const id = await official('C.12');
      // A working model that differs from the published version in more than colours.
      await ctx.prisma.processModel.update({
        where: { processId: id },
        data: {
          bpmnXml: UNCOLOURED.replace(
            'ph:nameEn="Answer screening questions"',
            'ph:nameEn="Answer the questionnaire"',
          ),
        },
      });
      const dry = await root
        .post('/settings/diagram-theme/apply')
        .send({ dryRun: true })
        .expect(200);
      expect(dry.body).toMatchObject({ models: 1, inPlace: 0, published: 1 });
      await root.post('/settings/diagram-theme/apply').send({ dryRun: false }).expect(200);
      expect((await ctx.prisma.process.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
      const pub = await ctx.prisma.publication.findFirstOrThrow({
        where: { entityId: id, current: true },
      });
      expect(pub.versionNumber).toBe(1);
      const v2 = await ctx.prisma.processVersion.findUniqueOrThrow({
        where: { processId_versionNumber: { processId: id, versionNumber: 2 } },
      });
      expect(v2.label).toBeNull();
    });
  });
});
