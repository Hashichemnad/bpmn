import { main as runSeed } from '../prisma/seed';
import { collectRoutes, type RouteInfo } from './route-inventory';
import { createApp, loggedIn, resetDb, sampleBpmn, type Client, type TestContext } from './helpers';

/**
 * Systematic authorisation sweep over every route of the API (taken from the route inventory, so
 * new endpoints are covered automatically): read-only roles never change data, and Viewers never
 * reach the workspace. Runs against the full demo seed (content in every state).
 */
describe('Authorisation matrix (e2e)', () => {
  let ctx: TestContext;
  let routes: RouteInfo[];
  const ids: Record<string, string> = {};
  const lifecycle: { processes: string[]; pages: string[]; diagrams: string[] } = {
    processes: [],
    pages: [],
    diagrams: [],
  };
  const DEMO_PASSWORD = 'Demo-Password1';

  /** Tables whose content must not change when a read-only user calls a mutating route. */
  const WATCHED = [
    // Phase 5.2: workflow execution.
    'WorkflowProcessConfig',
    'WorkflowDefinition',
    'WorkflowCase',
    'WorkflowTask',
    'WorkflowJob',
    'WorkflowFile',
    'WorkflowCaseComment',
    'Process',
    'ProcessModel',
    'ProcessVersion',
    'ObjectLink',
    'RepoObject',
    'Department',
    'Role',
    'RolePermission',
    'UserRole',
    'Setting',
    'Space',
    'SpaceGrant',
    'Page',
    'PageVersion',
    'PageDraft',
    'PageLink',
    'PageTemplate',
    'Attachment',
    'Workflow',
    'Review',
    'ReviewTask',
    'Publication',
    'Comment',
    'Feedback',
    'GitSyncItem',
    'AiUsage',
    'Risk',
    'Control',
    'Requirement',
    'RiskControl',
    'RequirementControl',
    'GrcActivity',
    'GrcChange',
    'GrcChangeTask',
    'ControlTestPlan',
    'ControlTest',
    'AssuranceFile',
    'AssuranceEvent',
    'Issue',
    'IssueAction',
    'AuditEngagement',
    'AuditWorkItem',
    'AuditFinding',
    'Questionnaire',
    'SurveyCampaign',
    'SurveyResponse',
    'SurveyProposal',
    // Phase 4.3: architecture, KPIs, Salesforce sync.
    'Application',
    'AppInterface',
    'DataObject',
    'DataObjectUsage',
    'Capability',
    'CapabilityProcess',
    'CapabilityApplication',
    'Kpi',
    'KpiMeasurement',
    'KpiPeriodTarget',
    'StrategicObjective',
    'KpiObjective',
    'SalesforceSyncRun',
    // Diagram types (D-120).
    'Diagram',
    'DiagramVersion',
    'DiagramLink',
    // Process mining and simulation (Phase 5.1).
    'EventLog',
    'EventLogGrant',
    'MiningEvent',
    'MiningActivity',
    'MiningMappingTemplate',
    'Simulation',
    'SimulationScenario',
    'KpiMeasurement',
  ];

  async function fingerprint(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const t of WATCHED) {
      const rows = await ctx.prisma.$queryRawUnsafe<{ h: string | null }[]>(
        `SELECT md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))) AS h FROM "${t}" t`,
      );
      out[t] = rows[0]?.h ?? '';
    }
    // Users: everything except login bookkeeping.
    const users = await ctx.prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, email: true, status: true, passwordHash: true, departmentId: true },
    });
    out.User = JSON.stringify(users);
    return out;
  }

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
    Object.assign(process.env, {
      SEED_ADMIN_EMAIL: 'matrix-admin@test.local',
      SEED_ADMIN_PASSWORD: 'Seed-Password1',
      SEED_DEMO_DATA: 'true',
      SEED_DEMO_PASSWORD: DEMO_PASSWORD,
    });
    await runSeed();
    routes = await collectRoutes();

    // A view-restricted space with a page and an attachment, so restricted content exists too.
    const admin = await loggedIn(ctx.app, 'matrix-admin@test.local', 'Seed-Password1');
    const space = await admin
      .post('/spaces')
      .send({ key: 'SEC', nameEn: 'Secret', nameAr: 'سري' })
      .expect(201);
    await admin
      .put(`/spaces/${space.body.id}/permissions`)
      .send({ viewRestricted: true, editRestricted: true, grants: [] })
      .expect(200);
    const page = await admin
      .post(`/spaces/${space.body.id}/pages`)
      .send({ titleEn: 'Secret page', titleAr: 'صفحة سرية' })
      .expect(201);
    const file = await admin
      .post(`/pages/${page.body.id}/attachments`)
      .attach('file', Buffer.from('secret'), { filename: 's.txt', contentType: 'text/plain' })
      .expect(201);

    const p = ctx.prisma;
    const readOnlyIds = (
      await p.user.findMany({
        where: {
          email: { in: ['viewer', 'auditor', 'reviewer'].map((u) => `${u}@processhub.local`) },
        },
      })
    ).map((u) => u.id);
    const anyId = async (q: Promise<{ id: string } | null>) => (await q)?.id ?? '';
    const draft = await p.process.findFirstOrThrow({
      where: { status: 'DRAFT', versions: { some: {} } },
    });
    // Governance actions are tried on items in every lifecycle state.
    for (const status of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED'] as const) {
      const proc = await p.process.findFirst({ where: { status } });
      const pg = await p.page.findFirst({ where: { status } });
      const dg = await p.diagram.findFirst({ where: { status } });
      if (proc) lifecycle.processes.push(proc.id);
      if (pg) lifecycle.pages.push(pg.id);
      if (dg) lifecycle.diagrams.push(dg.id);
    }
    lifecycle.pages.push(page.body.id);
    Object.assign(ids, {
      process: draft.id,
      processVersion: await anyId(p.processVersion.findFirst({ where: { processId: draft.id } })),
      processLink: await anyId(p.objectLink.findFirst({ where: { processId: draft.id } })),
      page: page.body.id,
      pageVersion: await anyId(p.pageVersion.findFirst({ where: { pageId: page.body.id } })),
      pageLink: await anyId(p.pageLink.findFirst()),
      space: space.body.id,
      attachment: file.body.id,
      // A thread started by someone who is not one of the read-only demo users.
      comment: await anyId(
        p.comment.findFirst({ where: { parentId: null, createdById: { notIn: readOnlyIds } } }),
      ),
      user: await anyId(p.user.findFirst({ where: { email: 'matrix-admin@test.local' } })),
      object: await anyId(p.repoObject.findFirst()),
      risk: await anyId(p.repoObject.findFirst({ where: { type: 'RISK', deletedAt: null } })),
      control: await anyId(p.repoObject.findFirst({ where: { type: 'CONTROL', deletedAt: null } })),
      requirement: await anyId(
        p.repoObject.findFirst({ where: { type: 'REQUIREMENT', deletedAt: null } }),
      ),
      department: await anyId(p.department.findFirst()),
      template: await anyId(p.pageTemplate.findFirst()),
      workflow: await anyId(p.workflow.findFirst()),
      review: await anyId(p.review.findFirst({ where: { status: 'IN_PROGRESS' } })),
      feedback: await anyId(p.feedback.findFirst()),
      // Somebody else's notification (never the viewer's).
      notification: await anyId(
        p.notification.findFirst({
          where: { user: { email: { not: 'viewer@processhub.local' } }, readAt: null },
        }),
      ),
      gitItem: '00000000-0000-4000-8000-000000000000',
      // Phase 4.2 records from the demo seed.
      controlTest: await anyId(p.controlTest.findFirst()),
      issue: await anyId(p.issue.findFirst()),
      engagement: await anyId(p.auditEngagement.findFirst()),
      campaign: await anyId(p.surveyCampaign.findFirst()),
      grcChange: '00000000-0000-4000-8000-000000000000',
      // Phase 4.3 records from the demo seed.
      application: (await p.application.findFirst())?.objectId ?? '',
      appInterface: await anyId(p.appInterface.findFirst()),
      dataObject: await anyId(p.dataObject.findFirst()),
      capability: await anyId(p.capability.findFirst({ where: { parentId: null } })),
      kpi: (await p.kpi.findFirst())?.objectId ?? '',
      measurement: await anyId(p.kpiMeasurement.findFirst()),
      objective: await anyId(p.strategicObjective.findFirst()),
      // Diagram types from the demo seed (an EPC: every route applies, incl. the conversion).
      diagram: await anyId(p.diagram.findFirst({ where: { type: 'EPC' } })),
      diagramVersion: await anyId(p.diagramVersion.findFirst()),
      diagramLink: '00000000-0000-4000-8000-000000000000',
      // Process mining and simulation demo (Phase 5.1).
      eventLog: await anyId(p.eventLog.findFirst()),
      simulation: await anyId(p.simulation.findFirst()),
      scenario: await anyId(p.simulationScenario.findFirst()),
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** Concrete URLs for a route: both content types, and every lifecycle state for governance. */
  function urls(path: string): string[] {
    const types = path.includes(':type')
      ? (['processes', 'pages', 'diagrams'] as const)
      : (['processes'] as const);
    return types.flatMap((type) =>
      path.startsWith('/governance/:type/:id')
        ? lifecycle[type].map((id) => fill(path.replace('/:id', `/${id}`), type))
        : [fill(path, type)],
    );
  }

  /** Fills route parameters with ids of real records (restricted / draft content where possible). */
  function fill(path: string, type: 'processes' | 'pages' | 'diagrams'): string {
    const [, first, second] = path.split('/');
    const grc: Record<string, string> = {
      risks: ids.risk,
      controls: ids.control,
      requirements: ids.requirement,
      items: ids.risk,
      processes: ids.process,
      changes: ids.grcChange,
    };
    const ea: Record<string, string> = {
      applications: ids.application,
      interfaces: ids.appInterface,
      'data-objects': ids.dataObject,
      capabilities: ids.capability,
    };
    const byPrefix: Record<string, string> = {
      processes: ids.process,
      pages: ids.page,
      spaces: ids.space,
      attachments: ids.attachment,
      users: ids.user,
      objects: ids.object,
      departments: ids.department,
      templates: ids.template,
      workflows: ids.workflow,
      reviews: ids.review,
      feedback: ids.feedback,
      notifications: ids.notification,
      integrations: ids.gitItem,
      portal: type === 'processes' ? ids.process : type === 'diagrams' ? ids.diagram : ids.page,
      governance: type === 'processes' ? ids.process : type === 'diagrams' ? ids.diagram : ids.page,
      comments: type === 'diagrams' ? ids.diagram : type === 'pages' ? ids.page : ids.process,
      diagrams: ids.diagram,
      'control-tests': ids.controlTest,
      issues: ids.issue,
      audits: ids.engagement,
      surveys: ids.campaign,
      mining: ids.eventLog,
      simulations: ids.simulation,
    };
    return path
      .replace(':type', type)
      .replace(':spaceId', ids.space)
      .replace(':commentId', ids.comment)
      .replace(
        ':versionId',
        first === 'pages'
          ? ids.pageVersion
          : first === 'diagrams'
            ? ids.diagramVersion
            : ids.processVersion,
      )
      .replace(
        ':linkId',
        first === 'pages' ? ids.pageLink : first === 'diagrams' ? ids.diagramLink : ids.processLink,
      )
      .replace(':scenarioId', ids.scenario)
      .replace(':kpiId', ids.kpi)
      .replace(':caseId', 'INV-000001')
      .replace(':roleId', ids.object)
      .replace(':measurementId', ids.measurement)
      .replace(':processId', ids.process)
      .replace(':kind', first === 'ea' ? 'applications' : 'kpis')
      .replace(
        ':id',
        (first === 'grc'
          ? grc[second]
          : first === 'ea'
            ? ea[second]
            : first === 'kpis'
              ? second === 'objectives'
                ? ids.objective
                : ids.kpi
              : byPrefix[first]) || ids.process,
      );
  }

  /** Valid bodies for routes whose finer checks happen in the service (so those checks run). */
  const BODIES: Record<string, object> = {
    'PATCH /processes/:id': { nameEn: 'Hacked' },
    'PUT /processes/:id/model': { bpmnXml: sampleBpmn(['Hacked']) },
    'POST /processes/:id/versions': { bpmnXml: sampleBpmn(['Hacked']), changeNote: 'x' },
    'PATCH /spaces/:id': { nameEn: 'Hacked', nameAr: 'مخترق' },
    'PUT /spaces/:id/permissions': { viewRestricted: false, editRestricted: false, grants: [] },
    'PUT /governance/spaces/:spaceId/workflow': { workflowId: null },
    'PATCH /governance/:type/:id': { nextReviewAt: null },
    'POST /governance/:type/:id/submit': {},
    'POST /governance/:type/:id/publish': {},
    'POST /governance/:type/:id/archive': {},
    'POST /reviews/:id/decision': { decision: 'APPROVE' },
    'PATCH /feedback/:id': { status: 'DONE', reply: 'x' },
    'POST /spaces/:spaceId/pages': { titleEn: 'X', titleAr: 'س' },
    'PUT /pages/:id': { titleEn: 'X', titleAr: 'س', changeNote: 'x' },
    'POST /comments/:type/:id': { body: 'x' },
    'PATCH /comments/:commentId': { body: 'x' },
    'POST /ai/translate': { kind: 'fields', target: 'ar', fields: [{ key: 'a', text: 'Hello' }] },
    'PATCH /diagrams/:id': { nameEn: 'Hacked' },
    'POST /diagrams': { type: 'VALUE_CHAIN', nameEn: 'Hacked' },
    'POST /diagrams/:id/convert-to-bpmn': { code: 'HACK.1', category: 'CORE' },
  };

  /** Self-service writes every signed-in user may make (own session, profile, notifications). */
  const SELF_SERVICE = [
    /^POST \/auth\//,
    /^PATCH \/auth\/me$/,
    /^(POST|PUT) \/notifications/,
    /^POST \/feedback$/,
    // Read operations sent as POST (filters in the body) and one's own saved filters (Phase 5.1).
    /^POST \/mining\/logs\/:id\/(analysis|conformance|export|presets)$/,
    /^DELETE \/mining\/presets\/:id$/,
    /^POST \/mining\/jobs\/:id\/cancel$/,
    /^POST \/simulations\/:id\/ai\/(explain|suggest)$/,
    // Phase 5.2: the executable check is read-only; out of office is one's own profile.
    /^POST \/workflow\/processes\/:id\/check$/,
    /^PUT \/workflow\/out-of-office$/,
  ];
  /** Reviewers comment and decide on review steps assigned to them (governance tests cover it). */
  const REVIEWER_ALLOWED = [/^POST \/comments\/:type\/:id$/, /^POST \/reviews\/:id\/decision$/];

  const mutating = () => routes.filter((r) => r.method !== 'GET');

  async function sweep(client: Client, allowed: RegExp[]) {
    const before = await fingerprint();
    const succeeded: string[] = [];
    for (const r of mutating()) {
      const key = `${r.method} ${r.path}`;
      if (allowed.some((re) => re.test(key))) continue;
      for (const url of urls(r.path)) {
        const call = client[r.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'](url);
        const res = await call.send(BODIES[key] ?? {});
        if (res.status < 400) succeeded.push(`${key} → ${res.status}`);
      }
    }
    expect(succeeded).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  }

  it('the sweep covers every mutating route', () => {
    expect(mutating().length).toBeGreaterThanOrEqual(90);
  });

  it('Viewers cannot change anything', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@processhub.local', DEMO_PASSWORD);
    await sweep(viewer, SELF_SERVICE);
  });

  it('Auditors cannot change anything', async () => {
    const auditor = await loggedIn(ctx.app, 'auditor@processhub.local', DEMO_PASSWORD);
    await sweep(auditor, SELF_SERVICE);
  });

  it('Reviewers cannot change anything except adding comments and their own review decisions', async () => {
    const reviewer = await loggedIn(ctx.app, 'reviewer@processhub.local', DEMO_PASSWORD);
    await sweep(reviewer, [...SELF_SERVICE, ...REVIEWER_ALLOWED]);
  });

  it('Modelers (GRC readers) cannot change any assurance record (Phase 4.2)', async () => {
    const modeler = await loggedIn(ctx.app, 'modeler@processhub.local', DEMO_PASSWORD);
    const assurance =
      /^(POST|PUT|PATCH|DELETE) \/(grc\/changes|control-tests|issues|audits|surveys|assurance)(\/|$)/;
    const before = await fingerprint();
    const succeeded: string[] = [];
    for (const r of mutating().filter((x) => assurance.test(`${x.method} ${x.path}`))) {
      for (const url of urls(r.path)) {
        const call = modeler[r.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'](url);
        const res = await call.send({});
        if (res.status < 400) succeeded.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(succeeded).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  it('Modelers (architecture and KPI readers) cannot change architecture, KPI or Salesforce records (Phase 4.3)', async () => {
    const modeler = await loggedIn(ctx.app, 'modeler@processhub.local', DEMO_PASSWORD);
    const scope = /^(POST|PUT|PATCH|DELETE) \/(ea|kpis|integrations\/salesforce)(\/|$)/;
    const before = await fingerprint();
    const succeeded: string[] = [];
    const tried: string[] = [];
    for (const r of mutating().filter((x) => scope.test(`${x.method} ${x.path}`))) {
      for (const url of urls(r.path)) {
        tried.push(url);
        const call = modeler[r.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'](url);
        const res = await call.send({ nameEn: 'Hacked', period: '2025-01', value: 1 });
        if (res.status < 400) succeeded.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(tried.length).toBeGreaterThanOrEqual(25);
    expect(succeeded).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  it('Viewers cannot read any workspace endpoint (only the portal and their own data)', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@processhub.local', DEMO_PASSWORD);
    // The RACI export also serves the portal: Viewers get published versions only (reports tests).
    const own =
      /^\/(portal|auth|notifications|health|tasks|feedback)(\/|$)|^\/assurance\/tasks$|^\/settings\/(public|logo)$|^\/ai\/status$|^\/reports\/raci\/|^\/workflow\/(cases|catalogue|tasks|out-of-office|users|files|departments)(\/|$)/;
    const leaked: string[] = [];
    for (const r of routes.filter((x) => x.method === 'GET' && !own.test(x.path))) {
      for (const url of urls(r.path)) {
        const res = await viewer.get(url);
        if (![403, 404].includes(res.status)) leaked.push(`GET ${url} → ${res.status}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("self-service routes only touch the caller's own records", async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@processhub.local', DEMO_PASSWORD);
    expect(ids.notification).not.toBe('');
    await viewer.post(`/notifications/${ids.notification}/read`).expect(404);
    const n = await ctx.prisma.notification.findUniqueOrThrow({ where: { id: ids.notification } });
    expect(n.readAt).toBeNull();
    await viewer
      .patch('/auth/me')
      .send({ roles: ['SUPER_ADMIN'], email: 'x@y.z' })
      .expect(200);
    const me = await viewer.get('/auth/me').expect(200);
    expect(me.body).toMatchObject({ email: 'viewer@processhub.local', roles: ['VIEWER'] });
  });

  it('Viewers cannot reach restricted or unpublished content through the portal', async () => {
    const viewer = await loggedIn(ctx.app, 'viewer@processhub.local', DEMO_PASSWORD);
    await viewer.get(`/portal/pages/${ids.page}`).expect(404);
    await viewer.get(`/portal/processes/${ids.process}`).expect(404);
    await viewer.get(`/portal/attachments/${ids.attachment}/content`).expect(404);
    await viewer.get(`/portal/spaces/${ids.space}/pages`).expect(404);
    const search = await viewer.get('/portal/search?q=secret').expect(200);
    expect(search.body.total).toBe(0);
  });
});
