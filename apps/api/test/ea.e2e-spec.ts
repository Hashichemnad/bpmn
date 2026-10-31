import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/** Enterprise architecture catalogues (Phase 4.3, M11): applications, interfaces, data, capabilities. */
describe('Enterprise architecture (e2e)', () => {
  let ctx: TestContext;
  let architect: Client;
  let modeler: Client;
  let auditor: Client;
  let viewer: Client;
  let officer: Client;
  let architectId: string;
  let processId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    architectId = (await createUser(ctx.prisma, 'architect@test.local', ['ENTERPRISE_ARCHITECT']))
      .id;
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'auditor@test.local', ['AUDITOR']);
    await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER']);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    architect = await loggedIn(ctx.app, 'architect@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    auditor = await loggedIn(ctx.app, 'auditor@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    officer = await loggedIn(ctx.app, 'officer@test.local');
    processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Purchasing', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_Order', 'Task_Pay']) })
      .expect(200);
  });

  const app = (c: Client, body: object = {}) =>
    c.post('/ea/applications').send({
      code: 'ERP',
      nameEn: 'Oracle ERP',
      nameAr: 'نظام أوراكل',
      appType: 'APPLICATION',
      vendor: 'Oracle',
      hosting: 'CLOUD',
      hostingCountry: 'ae',
      lifecycle: 'ACTIVE',
      criticality: 'HIGH',
      ...body,
    });

  it('keeps library IT systems (ids and step links) as catalogue entries', async () => {
    const sys = (
      await modeler
        .post('/objects')
        .send({ type: 'SYSTEM', code: 'SAP', nameEn: 'SAP', nameAr: 'ساب' })
        .expect(201)
    ).body;
    await modeler
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Order', repoObjectId: sys.id, relation: 'SUPPORTS' })
      .expect(201);
    // Application row created with the library object; the step link counts as usage.
    const detail = (await architect.get(`/ea/applications/${sys.id}`).expect(200)).body;
    expect(detail.item).toMatchObject({
      id: sys.id,
      code: 'SAP',
      lifecycle: 'ACTIVE',
      stepCount: 1,
    });
    expect(detail.steps).toEqual([
      expect.objectContaining({
        bpmnElementId: 'Task_Order',
        process: expect.objectContaining({ code: 'S.01' }),
      }),
    ]);
    // A SYSTEM object without a catalogue row (created before the migration) gets one lazily.
    const legacy = await ctx.prisma.repoObject.create({
      data: { type: 'SYSTEM', code: 'OLD', nameEn: 'Legacy' },
    });
    await architect
      .patch(`/ea/applications/${legacy.id}`)
      .send({ lifecycle: 'PHASING_OUT' })
      .expect(200);
    const list = (await architect.get('/ea/applications?lifecycle=PHASING_OUT').expect(200)).body;
    expect(list.items.map((a: { code: string }) => a.code)).toEqual(['OLD']);
  });

  it('manages applications, interfaces, data objects (CRUD matrix) and capabilities with audit', async () => {
    const erp = (await app(architect).expect(201)).body.item;
    expect(erp).toMatchObject({ hostingCountry: 'AE', vendor: 'Oracle', criticality: 'HIGH' });
    const hr = (
      await app(architect, { code: 'HRMS', nameEn: 'HR system', lifecycle: 'PHASING_OUT' }).expect(
        201,
      )
    ).body.item;
    // Validation: owners must exist, country is ISO-2, an interface needs two different ends.
    await app(architect, {
      code: 'X',
      businessOwnerId: '00000000-0000-4000-8000-000000000001',
    }).expect(400);
    await app(architect, { code: 'X', hostingCountry: 'UAE' }).expect(400);
    await architect.post('/ea/interfaces').send({ sourceId: erp.id, targetId: erp.id }).expect(400);

    const budget = (
      await architect
        .post('/ea/data-objects')
        .send({
          code: 'D-BUD',
          nameEn: 'Budget',
          nameAr: 'الميزانية',
          classification: 'CONFIDENTIAL',
          systemOfRecordId: erp.id,
          usages: [
            { applicationId: erp.id, create: true, read: true, update: true },
            { applicationId: hr.id, read: true },
          ],
        })
        .expect(201)
    ).body;
    expect(budget.systemOfRecord.id).toBe(erp.id);
    expect(budget.usages).toHaveLength(2);

    const itf = (
      await architect
        .post('/ea/interfaces')
        .send({
          code: 'I-01',
          sourceId: hr.id,
          targetId: erp.id,
          technology: 'FILE',
          frequency: 'DAILY',
          ownerId: architectId,
          dataObjectIds: [budget.id],
        })
        .expect(201)
    ).body;
    expect(itf).toMatchObject({
      technology: 'FILE',
      source: { id: hr.id },
      target: { id: erp.id },
    });
    expect(itf.dataObjects.map((d: { code: string }) => d.code)).toEqual(['D-BUD']);

    const finance = (
      await architect
        .post('/ea/capabilities')
        .send({ code: 'C1', nameEn: 'Finance', importance: 'HIGH' })
        .expect(201)
    ).body;
    const budgeting = (
      await architect
        .post('/ea/capabilities')
        .send({
          code: 'C1.1',
          nameEn: 'Budgeting',
          parentId: finance.id,
          processIds: [processId],
          applicationIds: [erp.id],
        })
        .expect(201)
    ).body;
    expect(budgeting).toMatchObject({ level: 2, parentId: finance.id });
    const planning = (
      await architect
        .post('/ea/capabilities')
        .send({ code: 'C1.1.1', nameEn: 'Planning', parentId: budgeting.id })
        .expect(201)
    ).body;
    expect(planning.level).toBe(3);
    // Level 4 is refused, also by moving a subtree under a level-2 capability.
    await architect
      .post('/ea/capabilities')
      .send({ nameEn: 'Too deep', parentId: planning.id })
      .expect(400);
    const other = (await architect.post('/ea/capabilities').send({ nameEn: 'Other' }).expect(201))
      .body;
    await architect
      .patch(`/ea/capabilities/${finance.id}`)
      .send({ parentId: other.id })
      .expect(400);
    // A capability cannot move below its own descendant.
    await architect
      .patch(`/ea/capabilities/${finance.id}`)
      .send({ parentId: budgeting.id })
      .expect(400);
    await architect.delete(`/ea/capabilities/${finance.id}`).expect(409);

    const detail = (await architect.get(`/ea/applications/${erp.id}`).expect(200)).body;
    expect(detail.item.capabilities.map((c: { code: string }) => c.code)).toEqual(['C1.1']);
    expect(detail.interfaces).toHaveLength(1);
    expect(detail.dataObjects[0]).toMatchObject({
      code: 'D-BUD',
      create: true,
      systemOfRecord: true,
    });
    const filtered = (await architect.get(`/ea/applications?capabilityId=${budgeting.id}`)).body;
    expect(filtered.items.map((a: { code: string }) => a.code)).toEqual(['ERP']);

    // Deleting an application removes its interfaces and usages; everything is audited.
    await architect.delete(`/ea/applications/${hr.id}`).expect(204);
    expect((await architect.get('/ea/interfaces').expect(200)).body.total).toBe(0);
    expect((await architect.get(`/ea/data-objects/${budget.id}`)).body.usages).toHaveLength(1);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityType: { in: ['Application', 'AppInterface', 'DataObject', 'Capability'] } },
    });
    const actions = audit.map((a) => `${a.entityType}:${a.action}`);
    for (const a of [
      'Application:CREATE',
      'Application:DELETE',
      'AppInterface:CREATE',
      'DataObject:CREATE',
      'Capability:CREATE',
    ])
      expect(actions).toContain(a);
  });

  it('checks permissions on every endpoint', async () => {
    const erp = (await app(architect).expect(201)).body.item;
    const cap = (await architect.post('/ea/capabilities').send({ nameEn: 'Finance' })).body;
    // Read: workspace roles with ea.read; Viewers (portal only) never.
    for (const c of [modeler, auditor, officer]) {
      await c.get('/ea/applications').expect(200);
      await c.get(`/ea/applications/${erp.id}`).expect(200);
      await c.get('/ea/interfaces').expect(200);
      await c.get('/ea/data-objects').expect(200);
      await c.get('/ea/capabilities').expect(200);
      await c.get('/ea/export/applications').expect(200);
    }
    for (const path of [
      '/ea/applications',
      `/ea/applications/${erp.id}`,
      '/ea/interfaces',
      '/ea/data-objects',
      '/ea/capabilities',
      `/ea/capabilities/${cap.id}`,
      '/ea/export/capabilities',
    ])
      await viewer.get(path).expect(403);
    // Write: only ea.edit (Enterprise Architect, admins).
    for (const c of [modeler, auditor, officer, viewer]) {
      await app(c, { code: 'NEW' }).expect(403);
      await c.patch(`/ea/applications/${erp.id}`).send({ vendor: 'x' }).expect(403);
      await c.post('/ea/capabilities').send({ nameEn: 'x' }).expect(403);
      await c.patch(`/ea/capabilities/${cap.id}`).send({ nameEn: 'x' }).expect(403);
      await c.post('/ea/data-objects').send({ nameEn: 'x' }).expect(403);
      await c.post('/ea/interfaces').send({ sourceId: erp.id, targetId: erp.id }).expect(403);
      await c.get('/ea/template/applications').expect(403);
      await c.post('/ea/import/applications').expect(403);
      await c.delete(`/ea/applications/${erp.id}`).expect(403);
      await c.delete(`/ea/capabilities/${cap.id}`).expect(403);
    }
  });

  it('exports, validates and imports the catalogues (EN / AR headers)', async () => {
    const erp = (await app(architect).expect(201)).body.item;
    await architect.post('/ea/capabilities').send({ code: 'C1', nameEn: 'Finance' }).expect(201);

    const exported = await architect
      .get('/ea/export/applications?locale=ar')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exported.body as ArrayBuffer);
    expect(wb.worksheets[0].views[0].rightToLeft).toBe(true);
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('الرمز');
    expect(wb.worksheets[0].getRow(2).getCell(1).value).toBe('ERP');

    const file = async (header: string[], rows: (string | null)[][]) => {
      const out = new ExcelJS.Workbook();
      const ws = out.addWorksheet('x');
      ws.addRow(header);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await out.xlsx.writeBuffer());
    };
    const bad = await file(
      ['Code', 'Name (English)', 'Lifecycle', 'Capabilities (codes)', 'IT owner (e-mail)'],
      [
        ['CRM', 'CRM', 'SOMETIMES', 'C9', 'nobody@test.local'],
        ['CRM', 'CRM again', 'ACTIVE', '', ''],
        ['', 'No code', 'ACTIVE', '', ''],
      ],
    );
    const report = (
      await architect.post('/ea/import/applications').attach('file', bad, 'apps.xlsx').expect(200)
    ).body;
    expect(report.imported).toBe(false);
    expect(
      report.errors.map((e: { column: string; code: string }) => `${e.column}:${e.code}`),
    ).toEqual(
      expect.arrayContaining([
        'lifecycle:INVALID_VALUE',
        'capabilities:UNKNOWN_CAPABILITY',
        'itOwner:UNKNOWN_USER',
        'code:DUPLICATE_IN_FILE',
        'code:REQUIRED',
      ]),
    );
    await architect
      .post('/ea/import/applications?dryRun=false')
      .attach('file', bad, 'apps.xlsx')
      .expect(200);
    expect(await ctx.prisma.repoObject.count({ where: { code: 'CRM' } })).toBe(0);

    const good = await file(
      ['Code', 'Name (English)', 'Lifecycle', 'Capabilities (codes)', 'IT owner (e-mail)'],
      [
        ['CRM', 'Salesforce CRM', 'planned', 'C1', 'architect@test.local'],
        ['ERP', 'Oracle ERP Cloud', 'PHASING OUT', '', ''],
      ],
    );
    const dry = (
      await architect.post('/ea/import/applications').attach('file', good, 'apps.xlsx').expect(200)
    ).body;
    expect(dry).toMatchObject({ created: 1, updated: 1, errors: [], imported: false });
    const done = (
      await architect
        .post('/ea/import/applications?dryRun=false')
        .attach('file', good, 'apps.xlsx')
        .expect(200)
    ).body;
    expect(done.imported).toBe(true);
    const updated = (await architect.get(`/ea/applications/${erp.id}`)).body.item;
    expect(updated).toMatchObject({ nameEn: 'Oracle ERP Cloud', lifecycle: 'PHASING_OUT' });
    const crm = (await architect.get('/ea/applications?q=crm')).body.items[0];
    expect(crm).toMatchObject({ lifecycle: 'PLANNED', itOwner: { email: 'architect@test.local' } });

    // Capabilities with a parent defined later in the same file; data objects with the CRUD column.
    const caps = await file(
      ['Code', 'Name (English)', 'Parent capability (code)', 'Applications (codes)'],
      [
        ['C2.1', 'Recruiting', 'C2', 'CRM'],
        ['C2', 'People', null, null],
      ],
    );
    expect(
      (
        await architect
          .post('/ea/import/capabilities?dryRun=false')
          .attach('file', caps, 'caps.xlsx')
          .expect(200)
      ).body.imported,
    ).toBe(true);
    const tree = (await architect.get('/ea/capabilities')).body as {
      code: string;
      level: number;
      applications: { code: string }[];
    }[];
    expect(tree.find((c) => c.code === 'C2.1')).toMatchObject({
      level: 2,
      applications: [expect.objectContaining({ code: 'CRM' })],
    });
    const data = await file(
      ['Code', 'Name (English)', 'System of record (code)', 'CRUD (APP:CRUD; …)'],
      [['D-EMP', 'Employee', 'CRM', 'CRM:CRUD; ERP:R']],
    );
    await architect
      .post('/ea/import/data-objects?dryRun=false')
      .attach('file', data, 'data.xlsx')
      .expect(200);
    const emp = (await architect.get('/ea/data-objects?q=employee')).body.items[0];
    expect(emp.usages).toHaveLength(2);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'IMPORT', entityType: 'Capability' } }),
    ).toBe(1);
  });
  const binary = (r: import('supertest').Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  it('capability map metrics, landscape, traceability and impact analysis (+ Excel, handbook)', async () => {
    const erp = (await app(architect, { lifecycle: 'PHASING_OUT' }).expect(201)).body.item;
    const crm = (
      await app(architect, { code: 'CRM', nameEn: 'CRM', lifecycle: 'ACTIVE' }).expect(201)
    ).body.item;
    const ext = (
      await app(architect, { code: 'EXT', nameEn: 'Bank', lifecycle: 'ACTIVE' }).expect(201)
    ).body.item;
    await architect
      .post('/ea/interfaces')
      .send({ sourceId: crm.id, targetId: erp.id, technology: 'API' })
      .expect(201);
    await architect.post('/ea/interfaces').send({ sourceId: erp.id, targetId: ext.id }).expect(201);
    const budget = (
      await architect
        .post('/ea/data-objects')
        .send({
          code: 'D-BUD',
          nameEn: 'Budget',
          systemOfRecordId: erp.id,
          usages: [{ applicationId: erp.id, create: true, read: true }],
        })
        .expect(201)
    ).body;
    const finance = (
      await architect.post('/ea/capabilities').send({ code: 'C1', nameEn: 'Finance' }).expect(201)
    ).body;
    await architect
      .post('/ea/capabilities')
      .send({
        code: 'C1.1',
        nameEn: 'Purchasing',
        parentId: finance.id,
        processIds: [processId],
        applicationIds: [erp.id, crm.id],
      })
      .expect(201);
    // ERP supports Task_Order; a risk (5×5, no residual) and a control sit on the same step, and
    // another control runs in ERP.
    await modeler
      .post(`/processes/${processId}/links`)
      .send({ bpmnElementId: 'Task_Order', repoObjectId: erp.id, relation: 'SUPPORTS' })
      .expect(201);
    const risk = (
      await officer
        .post('/grc/risks')
        .send({
          code: 'R-1',
          nameEn: 'Overspend',
          category: 'FINANCIAL',
          inherentLikelihood: 5,
          inherentImpact: 5,
        })
        .expect(201)
    ).body.item;
    const onStep = (
      await officer.post('/grc/controls').send({ code: 'K-1', nameEn: 'Budget check' }).expect(201)
    ).body.item;
    await officer
      .post('/grc/controls')
      .send({ code: 'K-2', nameEn: 'ERP limit', systemId: erp.id })
      .expect(201);
    for (const id of [risk.id, onStep.id])
      await officer
        .post(`/processes/${processId}/links`)
        .send({ bpmnElementId: 'Task_Order', repoObjectId: id, relation: 'MITIGATES' })
        .expect(201);

    // Capability map: roll-up of processes, applications, worst lifecycle and highest risk.
    const map = (await architect.get('/ea/capability-map').expect(200)).body.capabilities as {
      code: string;
      metrics: Record<string, unknown>;
    }[];
    expect(map.find((c) => c.code === 'C1')!.metrics).toMatchObject({
      processCount: 1,
      applicationCount: 2,
      worstLifecycle: 'PHASING_OUT',
      lifecycles: { PHASING_OUT: 1, ACTIVE: 1 },
      maxRiskScore: 25,
      maxRiskBand: 'CRITICAL',
    });

    // Landscape filtered by capability; neighbours add the bank.
    const land = (await architect.get(`/ea/landscape?capabilityId=${finance.id}`).expect(200)).body;
    expect(land.nodes.map((n: { code: string }) => n.code).sort()).toEqual(['CRM', 'ERP']);
    expect(land.edges).toHaveLength(1);
    const wide = (
      await architect.get(`/ea/landscape?capabilityId=${finance.id}&neighbours=true`).expect(200)
    ).body;
    expect(wide.nodes.find((n: { code: string }) => n.code === 'EXT')).toMatchObject({
      neighbour: true,
    });
    expect(wide.edges).toHaveLength(2);

    // Traceability: capability → process → step → application → data, with risks and controls.
    const trace = (await architect.get(`/ea/trace?capabilityId=${finance.id}`).expect(200)).body;
    expect(trace).toEqual([
      expect.objectContaining({
        capabilities: [expect.objectContaining({ code: 'C1.1' })],
        bpmnElementId: 'Task_Order',
        application: expect.objectContaining({ code: 'ERP' }),
        dataObjects: [
          expect.objectContaining({ code: 'D-BUD', create: true, systemOfRecord: true }),
        ],
        risks: [expect.objectContaining({ code: 'R-1', detail: 'CRITICAL' })],
        controls: [expect.objectContaining({ code: 'K-1' })],
      }),
    ]);
    // Backwards: from the data object.
    const back = (await architect.get(`/ea/trace?dataObjectId=${budget.id}`).expect(200)).body;
    expect(back.map((r: { application: { code: string } }) => r.application.code)).toEqual(['ERP']);

    // Impact analysis: supported steps, controls on them and running in ERP, risks, interfaces.
    const impact = (await architect.get(`/ea/applications/${erp.id}/impact`).expect(200)).body;
    expect(impact.summary).toEqual({
      processes: 1,
      steps: 1,
      controls: 2,
      risks: 1,
      interfaces: 2,
      dataObjects: 1,
      capabilities: 1,
    });
    expect(impact.controls).toEqual([
      expect.objectContaining({ code: 'K-1', runsIn: false, onSteps: 1 }),
      expect.objectContaining({ code: 'K-2', runsIn: true, onSteps: 0 }),
    ]);
    const xlsx = await binary(
      architect.get(`/ea/applications/${erp.id}/impact/export?locale=ar`),
    ).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain('العمليات والخطوات');
    expect(wb.worksheets[0].views[0].rightToLeft).toBe(true);
    await binary(architect.get(`/ea/trace/export?capabilityId=${finance.id}`)).expect(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'EXPORT', entityType: 'Application' },
      }),
    ).toBe(2);
    await viewer.get(`/ea/applications/${erp.id}/impact`).expect(403);
    await viewer.get('/ea/capability-map').expect(403);
    await viewer.get('/ea/landscape').expect(403);
    await viewer.get('/ea/trace').expect(403);

    // Handbook: optional "Systems and data" section.
    const doc = await binary(
      modeler.post('/reports/handbook').send({ processId, locale: 'en', includeSystems: true }),
    ).expect(200);
    const docXml = await (
      await JSZip.loadAsync(doc.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    expect(docXml).toContain('Systems and data');
    expect(docXml).toContain('Phasing out');
    expect(docXml).toContain('Budget (CR) ★');
  });
});
