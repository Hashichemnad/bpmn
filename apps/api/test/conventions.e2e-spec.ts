import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONVENTIONS } from '@processhub/shared';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

const bpmn = (body: string, lanes = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D"><bpmn:process id="P">${lanes}${body}</bpmn:process></bpmn:definitions>`;

const FLOW = (task: string) => `<bpmn:startEvent id="S" />${task}<bpmn:endEvent id="E" />
  <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1" /><bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="E" />`;
const LANE = `<bpmn:laneSet id="LS"><bpmn:lane id="L1" ph:roleId="r1"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>T1</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`;

const mandatory = (...rules: string[]) => ({
  ...DEFAULT_CONVENTIONS,
  rules: Object.fromEntries(
    Object.keys(DEFAULT_CONVENTIONS.rules).map((r) => [
      r,
      { enabled: true, mandatory: rules.includes(r) },
    ]),
  ),
});

describe('Modeling conventions (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let viewer: Client;

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
    await createUser(ctx.prisma, 'reviewer@test.local', ['REVIEWER']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
  });

  it('modelers read the rules, Admins change them (validated and audited)', async () => {
    expect((await modeler.get('/settings/modeling-conventions').expect(200)).body).toEqual(
      DEFAULT_CONVENTIONS,
    );
    await viewer.get('/settings/modeling-conventions').expect(403);
    await modeler.put('/settings/modeling-conventions').send(mandatory('laneRole')).expect(403);
    await admin
      .put('/settings/modeling-conventions')
      .send({ ...DEFAULT_CONVENTIONS, maxElements: 1 })
      .expect(400);
    const saved = (
      await admin
        .put('/settings/modeling-conventions')
        .send({ ...mandatory('laneRole'), maxElements: 80 })
        .expect(200)
    ).body;
    expect(saved.rules.laneRole).toEqual({ enabled: true, mandatory: true });
    expect(saved.maxElements).toBe(80);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityType: 'Setting', entityId: 'modeling.conventions' },
    });
    expect(audit?.action).toBe('UPDATE');
  });

  it('mandatory rules block "Submit for review" with the failed rules; warnings do not', async () => {
    const wf = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Review',
          nameAr: 'مراجعة',
          steps: [
            {
              nameEn: 'Review',
              nameAr: 'مراجعة',
              rule: 'ANY',
              assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }],
            },
          ],
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
    const newProcess = async (code: string, xml: string) => {
      const id = (
        await modeler.post('/processes').send({ code, nameEn: code, category: 'CORE' }).expect(201)
      ).body.id as string;
      await modeler
        .post(`/processes/${id}/versions`)
        .send({ bpmnXml: xml, changeNote: 'v1' })
        .expect(201);
      return id;
    };
    // English label only, no lane.
    const weak = bpmn(FLOW('<bpmn:task id="T1" ph:nameEn="Check order" />'));
    // Warnings only (the default): submitting works.
    const a = await newProcess('C.01', weak);
    await modeler.post(`/governance/processes/${a}/submit`).send({}).expect(200);

    await admin
      .put('/settings/modeling-conventions')
      .send(mandatory('laneRole', 'bilingualLabels'))
      .expect(200);
    const b = await newProcess('C.02', weak);
    const res = await modeler.post(`/governance/processes/${b}/submit`).send({}).expect(400);
    expect(res.body).toMatchObject({
      code: 'CONVENTIONS_NOT_MET',
      details: {
        count: 2,
        issues: [
          { rule: 'bilingualLabels', elementId: 'T1', nameEn: 'Check order', mandatory: true },
          { rule: 'laneRole', elementId: 'T1', nameAr: 'Check order', mandatory: true },
        ],
      },
    });
    expect((await modeler.get(`/governance/processes/${b}`).expect(200)).body.status).toBe('DRAFT');

    // Fixed in a new version: the submission goes through.
    await modeler
      .post(`/processes/${b}/versions`)
      .send({
        bpmnXml: bpmn(
          FLOW('<bpmn:task id="T1" ph:nameEn="Check order" ph:nameAr="فحص الطلب" />'),
          LANE,
        ),
        changeNote: 'v2',
      })
      .expect(201);
    await modeler.post(`/governance/processes/${b}/submit`).send({}).expect(200);
  });

  it('the PMS-01 sample passes every rule except the lane roles (no library roles linked)', async () => {
    await admin
      .put('/settings/modeling-conventions')
      .send(
        mandatory('bilingualLabels', 'userTaskDescription', 'noUnconnected', 'approvalDecision'),
      )
      .expect(200);
    const xml = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'samples', 'PMS-01-Program-Request-Approval.bpmn'),
      'utf8',
    );
    const { ConventionsService } = await import('../src/conventions/conventions.service');
    const service = ctx.app.get(ConventionsService);
    expect(await service.violations(xml)).toEqual([]);
    await admin.put('/settings/modeling-conventions').send(mandatory('laneRole')).expect(200);
    expect((await service.violations(xml)).length).toBe(14);
  });
});
