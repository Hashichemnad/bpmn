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
    expect(dry.body).toEqual({ dryRun: true, models: 1, elements: 35, published: 0, skipped: 0 });
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
});
