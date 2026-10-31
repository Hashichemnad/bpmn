import {
  emptyDiagramContent,
  stringifyDiagramContent,
  type GraphContent,
} from '@processhub/shared';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { join } from 'node:path';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/** Diagram framework (D-120): CRUD, content validation, versions, links, governance and portal. */
describe('Diagrams (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let viewer: Client;
  let auditor: Client;
  let processId: string;

  const valueChain = (names: string[], processRef?: string): string =>
    stringifyDiagramContent({
      schema: 1,
      type: 'VALUE_CHAIN',
      nodes: names.map((n, i) => ({
        id: `C${i + 1}`,
        kind: 'chevron',
        x: 100 + i * 170,
        y: 100,
        width: 160,
        height: 70,
        nameEn: n,
        nameAr: `${n} ع`,
        ...(i === 0 && processRef ? { processId: processRef } : {}),
      })),
      edges: [],
    } satisfies GraphContent);

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
    await createUser(ctx.prisma, 'auditor@test.local', ['AUDITOR']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    auditor = await loggedIn(ctx.app, 'auditor@test.local');
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
    processId = (
      await admin
        .post('/processes')
        .send({ code: 'C.01', nameEn: 'Procurement', category: 'CORE' })
        .expect(201)
    ).body.id;
  });

  it('creates diagrams with generated codes and validates content per type', async () => {
    const vc = (
      await modeler
        .post('/diagrams')
        .send({ type: 'VALUE_CHAIN', nameEn: 'Value chain', nameAr: 'سلسلة القيمة', processId })
        .expect(201)
    ).body;
    expect(vc).toMatchObject({ type: 'VALUE_CHAIN', code: 'VC-001', status: 'DRAFT', processId });
    const vc2 = (
      await modeler.post('/diagrams').send({ type: 'VALUE_CHAIN', nameEn: 'Second' }).expect(201)
    ).body;
    expect(vc2.code).toBe('VC-002');
    const dmn = (
      await modeler
        .post('/diagrams')
        .send({ type: 'DMN', nameEn: 'Approval authority' })
        .expect(201)
    ).body;
    expect(dmn.code).toBe('DMN-001');
    expect((await modeler.get(`/diagrams/${dmn.id}/content`).expect(200)).body.content).toContain(
      'decisionTable',
    );

    await modeler.post('/diagrams').send({ type: 'EPC' }).expect(400);
    await viewer.post('/diagrams').send({ type: 'EPC', nameEn: 'x' }).expect(403);
    await auditor.post('/diagrams').send({ type: 'EPC', nameEn: 'x' }).expect(403);

    // Content: valid JSON of the right type; unknown kinds, duplicate ids and dangling edges fail.
    await modeler
      .put(`/diagrams/${vc.id}/content`)
      .send({ content: valueChain(['Plan', 'Buy']) })
      .expect(200);
    const bad = JSON.parse(valueChain(['A', 'B'])) as GraphContent;
    bad.nodes[1].id = 'C1';
    const res = await modeler
      .put(`/diagrams/${vc.id}/content`)
      .send({ content: JSON.stringify(bad) })
      .expect(400);
    expect(res.body.code).toBe('INVALID_DIAGRAM');
    await modeler
      .put(`/diagrams/${vc.id}/content`)
      .send({ content: emptyDiagramContent('EPC') })
      .expect(400);
    await modeler.put(`/diagrams/${vc.id}/content`).send({ content: '{not json' }).expect(400);
    // DMN: no DTD / entities, no external references.
    await modeler
      .put(`/diagrams/${dmn.id}/content`)
      .send({ content: '<!DOCTYPE x [<!ENTITY a "b">]><definitions/>' })
      .expect(400);
    await modeler
      .put(`/diagrams/${vc.id}/content`)
      .send({ content: valueChain(['Plan']) })
      .expect(200);

    const list = (await viewer.get('/diagrams?type=VALUE_CHAIN').expect(403)).body;
    expect(list.code).toBe('FORBIDDEN');
    const all = (await auditor.get('/diagrams/all').expect(200)).body;
    expect(all.map((d: { code: string }) => d.code).sort()).toEqual([
      'DMN-001',
      'VC-001',
      'VC-002',
    ]);
    const byProcess = (await modeler.get(`/diagrams?processId=${processId}`).expect(200)).body;
    expect(byProcess.items).toHaveLength(1);

    // Audit trail for create and content.
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: vc.id } });
    expect(audit.map((a) => a.action).sort()).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
  });

  it('versions, links, where used, governance, comments and the portal', async () => {
    const vc = (
      await modeler.post('/diagrams').send({ type: 'VALUE_CHAIN', nameEn: 'Landscape' }).expect(201)
    ).body;
    const role = (await admin.post('/objects').send({ type: 'ROLE', nameEn: 'Buyer' }).expect(201))
      .body;

    await modeler
      .post(`/diagrams/${vc.id}/versions`)
      .send({ content: valueChain(['Plan', 'Source'], processId), changeNote: 'First' })
      .expect(201);
    await modeler
      .post(`/diagrams/${vc.id}/links`)
      .send({ elementId: 'C2', repoObjectId: role.id })
      .expect(201);
    await modeler
      .post(`/diagrams/${vc.id}/links`)
      .send({ elementId: 'nope', repoObjectId: role.id })
      .expect(400);
    const links = (await modeler.get(`/diagrams/${vc.id}/links`).expect(200)).body;
    expect(links).toMatchObject([
      { elementId: 'C2', relation: 'PERFORMS', element: { nameEn: 'Source' } },
    ]);

    // Where used: the process (drill-down) and the role (element link).
    const usedByProcess = (
      await modeler.get(`/diagrams/where-used?processId=${processId}`).expect(200)
    ).body;
    expect(usedByProcess).toMatchObject([{ elementId: 'C1', relation: 'DRILLDOWN' }]);
    const usedByRole = (await modeler.get(`/diagrams/where-used?objectId=${role.id}`).expect(200))
      .body;
    expect(usedByRole).toMatchObject([{ elementId: 'C2', relation: 'PERFORMS' }]);

    // Second version, compare and restore.
    await modeler
      .post(`/diagrams/${vc.id}/versions`)
      .send({ content: valueChain(['Plan', 'Source', 'Pay'], processId), changeNote: 'Pay' })
      .expect(201);
    let versions = (await modeler.get(`/diagrams/${vc.id}/versions`).expect(200)).body;
    expect(versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
    const v1 = versions[1];
    expect(
      (await modeler.get(`/diagrams/${vc.id}/versions/${v1.id}`).expect(200)).body.content,
    ).not.toContain('Pay');
    await modeler.post(`/diagrams/${vc.id}/versions/${v1.id}/restore`).send({}).expect(200);
    versions = (await modeler.get(`/diagrams/${vc.id}/versions`).expect(200)).body;
    expect(versions[0]).toMatchObject({ versionNumber: 3, restoredFrom: 1 });

    // Comments on an element.
    await reviewer
      .post(`/comments/diagrams/${vc.id}`)
      .send({ body: 'Rename?', bpmnElementId: 'C1' })
      .expect(201);
    const comments = (await modeler.get(`/comments/diagrams/${vc.id}`).expect(200)).body;
    expect(comments[0]).toMatchObject({ bpmnElementId: 'C1', element: { nameEn: 'Plan' } });

    // Governance: submit → approve → publish; locked while in review.
    await modeler.post(`/governance/diagrams/${vc.id}/submit`).send({}).expect(200);
    await modeler
      .put(`/diagrams/${vc.id}/content`)
      .send({ content: valueChain(['X']) })
      .expect(409);
    const task = (await reviewer.get('/tasks').expect(200)).body.reviews[0];
    expect(task.item).toMatchObject({
      entityType: 'DIAGRAM',
      code: 'VC-001',
      diagramType: 'VALUE_CHAIN',
    });
    const detail = (await reviewer.get(`/reviews/${task.id}`).expect(200)).body;
    expect(detail.compare).toMatchObject({ kind: 'DIAGRAM', diagramType: 'VALUE_CHAIN' });
    await reviewer.post(`/reviews/${task.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    const g = (
      await modeler
        .post(`/governance/diagrams/${vc.id}/publish`)
        .send({ versionLabel: 'v1' })
        .expect(200)
    ).body;
    expect(g).toMatchObject({ status: 'PUBLISHED', publication: { versionNumber: 3 } });

    // Portal: listed, readable, searchable; the unpublished process is not a drill target.
    const items = (await viewer.get('/portal/diagrams?type=VALUE_CHAIN').expect(200)).body;
    expect(items).toMatchObject([{ id: vc.id, diagramType: 'VALUE_CHAIN', code: 'VC-001' }]);
    const view = (await viewer.get(`/portal/diagrams/${vc.id}`).expect(200)).body;
    expect(view).toMatchObject({ code: 'VC-001', drillProcesses: [], drillDiagrams: [] });
    expect(view.links).toMatchObject([{ elementId: 'C2', relation: 'PERFORMS' }]);
    expect(JSON.parse(view.content).nodes).toHaveLength(2);
    const search = (await viewer.get('/portal/search?q=Source').expect(200)).body;
    expect(search.items.map((i: { id: string }) => i.id)).toContain(vc.id);
    const home = (await viewer.get('/portal/home').expect(200)).body;
    expect(home.counts.diagrams).toBe(1);

    // Editing a published diagram makes a new draft; the publication stays live.
    await modeler
      .put(`/diagrams/${vc.id}/content`)
      .send({ content: valueChain(['Plan', 'Source', 'Deliver']) })
      .expect(200);
    expect((await modeler.get(`/diagrams/${vc.id}`).expect(200)).body.status).toBe('DRAFT');
    await viewer.get(`/portal/diagrams/${vc.id}`).expect(200);

    // Delete ends the publication.
    await modeler.delete(`/diagrams/${vc.id}`).expect(403);
    await admin.delete(`/diagrams/${vc.id}`).expect(204);
    await viewer.get(`/portal/diagrams/${vc.id}`).expect(404);
  });

  it('reports status, department, KPI and risk facts of linked processes', async () => {
    const facts = (await modeler.get(`/diagrams/process-facts?ids=${processId}`).expect(200)).body;
    expect(facts).toMatchObject([
      { id: processId, code: 'C.01', status: 'DRAFT', kpi: null, risk: null },
    ]);
    await viewer.get(`/diagrams/process-facts?ids=${processId}`).expect(403);
    await modeler.get('/diagrams/process-facts?ids=not-a-uuid').expect(400);
  });

  it('provides organisation chart data and what a position performs (RACI)', async () => {
    const finance = (
      await admin.post('/departments').send({ nameEn: 'Finance', nameAr: 'المالية' }).expect(201)
    ).body;
    const role = (
      await admin
        .post('/objects')
        .send({ type: 'ROLE', nameEn: 'Accountant', attributes: { departmentId: finance.id } })
        .expect(201)
    ).body;
    const src = (await modeler.get('/diagrams/org-source').expect(200)).body;
    expect(src.departments.map((d: { nameEn: string }) => d.nameEn)).toContain('Finance');
    expect(src.roles.find((r: { id: string }) => r.id === role.id).departmentIds).toEqual([
      finance.id,
    ]);
    // Every workspace role reads the user directory, so people are included (null without users.read).
    expect(Array.isArray(src.people)).toBe(true);

    await admin
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_1', 'Task_2']) })
      .expect(200);
    await admin
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_2', repoObjectId: role.id })
      .expect(201);
    const acts = (await modeler.get(`/diagrams/role-activities/${role.id}`).expect(200)).body;
    expect(acts).toMatchObject([
      {
        process: { id: processId, code: 'C.01' },
        steps: [{ id: 'Task_2', letter: 'R', viaLane: false }],
      },
    ]);
    await viewer.get(`/diagrams/role-activities/${role.id}`).expect(403);
  });

  it('validates DMN and lists the business rule tasks using a decision table', async () => {
    const xml = readFileSync(
      join(__dirname, '../../../docs/samples/approval-authority.dmn'),
      'utf8',
    );
    const dmn = (
      await modeler
        .post('/diagrams')
        .send({ type: 'DMN', nameEn: 'Authority', content: xml })
        .expect(201)
    ).body;
    // External references, scripts and DTDs are refused.
    for (const bad of [
      xml.replace('href="#InputData_Request"', 'href="http://evil.example/x"'),
      xml.replace('<inputData', '<script>alert(1)</script><inputData'),
      `<!DOCTYPE d [<!ENTITY x "y">]>${xml}`,
    ])
      expect(
        (await modeler.put(`/diagrams/${dmn.id}/content`).send({ content: bad }).expect(400)).body
          .code,
      ).toBe('INVALID_DMN');
    const bpmn = sampleBpmn(['Task_1']).replace(
      '<bpmn:task id="Task_1" name="Task_1" />',
      `<bpmn:businessRuleTask id="Rule_1" name="Approver" xmlns:ph="http://processhub.io/schema/bpmn" ph:decisionRef="${dmn.id}" ph:decisionId="Decision_ApprovalAuthority" />`,
    );
    await admin.put(`/processes/${processId}/model`).send({ bpmnXml: bpmn }).expect(200);
    const used = (await modeler.get(`/diagrams/where-used?diagramId=${dmn.id}`).expect(200)).body;
    expect(used).toMatchObject([
      { diagram: null, process: { id: processId }, elementId: 'Rule_1', relation: 'DECISION' },
    ]);
  });

  it('converts an EPC into a new draft BPMN process with a mapping report', async () => {
    const role = (await admin.post('/objects').send({ type: 'ROLE', nameEn: 'Buyer' }).expect(201))
      .body;
    const erp = (await admin.post('/objects').send({ type: 'SYSTEM', nameEn: 'ERP' }).expect(201))
      .body;
    const node = (id: string, kind: string, nameEn: string, extra = {}) => ({
      id,
      kind,
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      nameEn,
      nameAr: `${nameEn} ع`,
      ...extra,
    });
    const flow = (sourceId: string, targetId: string, kind = 'flow') => ({
      id: `F_${sourceId}_${targetId}`,
      kind,
      sourceId,
      targetId,
      waypoints: [],
      nameEn: '',
      nameAr: '',
    });
    const content = JSON.stringify({
      schema: 1,
      type: 'EPC',
      nodes: [
        node('E1', 'event', 'Request received'),
        node('F1', 'function', 'Check request'),
        node('U1', 'orgUnit', 'Buyer', { objectId: role.id }),
        node('S1', 'system', 'ERP', { objectId: erp.id }),
        node('E2', 'event', 'Request checked'),
      ],
      edges: [
        flow('E1', 'F1'),
        flow('F1', 'E2'),
        flow('U1', 'F1', 'assignment'),
        flow('F1', 'S1', 'assignment'),
      ],
    });
    const epc = (
      await modeler
        .post('/diagrams')
        .send({ type: 'EPC', nameEn: 'Purchase EPC', nameAr: 'شراء', content })
        .expect(201)
    ).body;
    await viewer
      .post(`/diagrams/${epc.id}/convert-to-bpmn`)
      .send({ code: 'S.09', category: 'SUPPORT' })
      .expect(403);
    await modeler.post(`/diagrams/${epc.id}/convert-to-bpmn`).send({ code: 'S.09' }).expect(400);
    const res = (
      await modeler
        .post(`/diagrams/${epc.id}/convert-to-bpmn`)
        .send({ code: 'S.09', category: 'SUPPORT' })
        .expect(201)
    ).body;
    expect(res.code).toBe('S.09');
    expect(
      res.report.map((r: { epcId: string; result: string }) => `${r.epcId}:${r.result}`).sort(),
    ).toEqual(
      ['E1:START_EVENT', 'E2:END_EVENT', 'F1:USER_TASK', 'S1:SYSTEM_LINK', 'U1:LANE'].sort(),
    );
    const model = (await modeler.get(`/processes/${res.processId}/model`).expect(200)).body.bpmnXml;
    expect(model).toContain('bpmn:userTask id="F1"');
    expect(model).toContain(`ph:roleId="${role.id}"`);
    const links = (await modeler.get(`/processes/${res.processId}/links`).expect(200)).body;
    expect(
      links
        .map(
          (l: { relation: string; repoObject: { id: string } }) =>
            `${l.relation}:${l.repoObject.id}`,
        )
        .sort(),
    ).toEqual([`PERFORMS:${role.id}`, `SUPPORTS:${erp.id}`].sort());
    expect((await modeler.get(`/processes/${res.processId}`).expect(200)).body.status).toBe(
      'DRAFT',
    );
  });

  it('adds the value chain path, SIPOC, decision tables and organisation excerpt to the handbook', async () => {
    const role = (await admin.post('/objects').send({ type: 'ROLE', nameEn: 'Buyer' }).expect(201))
      .body;
    const dmnXml = readFileSync(
      join(__dirname, '../../../docs/samples/approval-authority.dmn'),
      'utf8',
    );
    const dmn = (
      await modeler
        .post('/diagrams')
        .send({ type: 'DMN', nameEn: 'Authority', content: dmnXml })
        .expect(201)
    ).body;
    const bpmn = sampleBpmn(['Task_1']).replace(
      '<bpmn:task id="Task_1" name="Task_1" />',
      `<bpmn:businessRuleTask id="Rule_1" name="Find approver" xmlns:ph="http://processhub.io/schema/bpmn" ph:decisionRef="${dmn.id}" />`,
    );
    await admin.put(`/processes/${processId}/model`).send({ bpmnXml: bpmn }).expect(200);
    await admin
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Rule_1', repoObjectId: role.id })
      .expect(201);
    await modeler
      .post('/diagrams')
      .send({
        type: 'VALUE_CHAIN',
        nameEn: 'Enterprise chain',
        content: valueChain(['Buy goods'], processId),
      })
      .expect(201);
    const sipoc = {
      schema: 1,
      type: 'SIPOC',
      processId,
      columns: {
        suppliers: [{ id: 'S1', nameEn: 'Vendor', nameAr: 'المورد' }],
        inputs: [],
        steps: [{ id: 'P1', nameEn: 'Order', nameAr: 'طلب' }],
        outputs: [],
        customers: [{ id: 'C1', nameEn: 'Requester', nameAr: 'مقدم الطلب' }],
      },
    };
    await modeler
      .post('/diagrams')
      .send({ type: 'SIPOC', nameEn: 'SIPOC', content: JSON.stringify(sipoc) })
      .expect(201);
    const org = {
      schema: 1,
      type: 'ORG_CHART',
      nodes: [
        {
          id: 'U1',
          kind: 'unit',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          nameEn: 'Procurement',
          nameAr: '',
        },
        {
          id: 'P1',
          kind: 'position',
          x: 0,
          y: 80,
          width: 100,
          height: 50,
          nameEn: 'Buyer',
          nameAr: '',
          objectId: role.id,
        },
      ],
      edges: [
        {
          id: 'R1',
          kind: 'reports',
          sourceId: 'U1',
          targetId: 'P1',
          waypoints: [],
          nameEn: '',
          nameAr: '',
        },
      ],
    };
    await modeler
      .post('/diagrams')
      .send({ type: 'ORG_CHART', nameEn: 'Org', content: JSON.stringify(org) })
      .expect(201);

    const res = await modeler
      .post('/reports/handbook')
      .send({
        processId,
        locale: 'en',
        includeValueChain: true,
        includeSipoc: true,
        includeDecisions: true,
        includeOrgChart: true,
      })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const xml = await (
      await JSZip.loadAsync(res.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    for (const text of [
      'Place in the value chain',
      'VC-001 Enterprise chain',
      'Buy goods',
      'Vendor',
      'Decision tables',
      'IT Director',
      'Organisation (positions performing the steps)',
      'Procurement',
    ])
      expect(xml).toContain(text);
  });

  it('applies owner-only rights for Process Owners', async () => {
    const owner = await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    const ownerClient = await loggedIn(ctx.app, 'owner@test.local');
    const other = (
      await admin.post('/diagrams').send({ type: 'SIPOC', nameEn: 'Other' }).expect(201)
    ).body;
    const own = (
      await admin
        .post('/diagrams')
        .send({ type: 'SIPOC', nameEn: 'Own', ownerId: owner.id })
        .expect(201)
    ).body;
    const content = emptyDiagramContent('SIPOC');
    await ownerClient.put(`/diagrams/${other.id}/content`).send({ content }).expect(403);
    await ownerClient.patch(`/diagrams/${other.id}`).send({ nameEn: 'x' }).expect(403);
    await ownerClient.put(`/diagrams/${own.id}/content`).send({ content }).expect(200);
    await ownerClient.patch(`/diagrams/${own.id}`).send({ nameEn: 'Mine' }).expect(200);
    expect((await ownerClient.get(`/diagrams/${own.id}`).expect(200)).body).toMatchObject({
      canEdit: true,
      canEditContent: true,
      canDelete: false,
    });
  });
});
