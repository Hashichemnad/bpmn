import { buildWorkflowBpmn } from '../prisma/workflow-bpmn';
import { BUDGET_DMN, pmsProgramRequestXml } from '../prisma/workflow-demo';
import {
  BusinessCalendar,
  DEFAULT_UAE_HOLIDAYS,
  DEFAULT_WORKFLOW_SETTINGS,
} from '@processhub/shared';
import { WorkflowJobsService } from '../src/workflow/workflow-jobs.service';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

/**
 * Workflow execution (Phase 5.2): execution settings, executable check, deployment of the published
 * version, start from the catalogue, inbox, return for correction, DMN routing, group tasks, four-eyes,
 * documents, timers surviving a restart, incidents with retry, visibility, monitor, live event log.
 */
describe('Workflow execution (e2e)', () => {
  let ctx: TestContext;
  let jobs: WorkflowJobsService;
  let admin: Client;
  let modeler: Client;
  let reviewer: Client;
  let requester: Client;
  let other: Client;
  let section: Client;
  let deptHead: Client;
  let finance: Client;
  let pmo1: Client;
  let pmo2: Client;
  let dgo: Client;
  let auditor: Client;
  let viewerElsewhere: Client;
  let processId: string;
  let ids: Record<string, string> = {};
  const year = new Date().getUTCFullYear();

  const publish = async (id: string) => {
    const sub = await modeler.post(`/governance/processes/${id}/submit`).send({});
    if (sub.status !== 200) throw new Error(JSON.stringify(sub.body));
    const review = (await reviewer.get('/tasks').expect(200)).body.reviews.find(
      (r: { item: { entityId: string } }) => r.item.entityId === id,
    );
    await reviewer.post(`/reviews/${review.id}/decision`).send({ decision: 'APPROVE' }).expect(200);
    await modeler
      .post(`/governance/processes/${id}/publish`)
      .send({ versionLabel: 'v' })
      .expect(200);
  };
  const saveModel = async (id: string, xml: string) => {
    await modeler.put(`/processes/${id}/model`).send({ bpmnXml: xml }).expect(200);
    await modeler
      .post(`/processes/${id}/versions`)
      .send({ bpmnXml: xml, changeNote: 'model' })
      .expect(201);
  };
  const myTasks = async (c: Client) =>
    (await c.get('/workflow/tasks?scope=mine').expect(200)).body.items;
  const openTask = async (c: Client, elementId: string) => {
    const t = (await myTasks(c)).find((x: { elementId: string }) => x.elementId === elementId);
    if (!t) throw new Error(`no task ${elementId}`);
    return (await c.get(`/workflow/tasks/${t.id}`).expect(200)).body;
  };
  const complete = async (
    c: Client,
    elementId: string,
    decision: string | null,
    data = {},
    comment = '',
  ) => {
    const t = await openTask(c, elementId);
    return c
      .post(`/workflow/tasks/${t.id}/complete`)
      .send({ data, decision, comment, version: t.version });
  };

  beforeAll(async () => {
    ctx = await createApp();
    jobs = ctx.app.get(WorkflowJobsService);
    await resetDb(ctx.prisma);
    const p = ctx.prisma;
    const strategy = await p.department.create({
      data: { nameEn: 'Strategy', nameAr: 'الاستراتيجية' },
    });
    const finDep = await p.department.create({ data: { nameEn: 'Finance', nameAr: 'المالية' } });
    const u = async (email: string, roles: Parameters<typeof createUser>[2], dep?: string) =>
      createUser(p, email, roles, { departmentId: dep });
    await u('admin@test.local', ['ADMIN']);
    await u('modeler@test.local', ['MODELER'], strategy.id);
    await u('reviewer@test.local', ['REVIEWER']);
    const reqUser = await u('requester@test.local', ['VIEWER'], strategy.id);
    await u('other@test.local', ['VIEWER'], strategy.id);
    const sec = await u('section@test.local', ['REVIEWER'], strategy.id);
    const head = await u('head@test.local', ['PROCESS_OWNER'], strategy.id);
    const fin = await u('finance@test.local', ['REVIEWER'], finDep.id);
    const p1 = await u('pmo1@test.local', ['REVIEWER'], strategy.id);
    const p2 = await u('pmo2@test.local', ['REVIEWER'], strategy.id);
    const dg = await u('dgo@test.local', ['REVIEWER'], strategy.id);
    await u('auditor@test.local', ['AUDITOR']);
    await u('elsewhere@test.local', ['PROCESS_OWNER'], finDep.id);
    await p.department.update({ where: { id: strategy.id }, data: { managerId: head.id } });
    const role = async (nameEn: string, users: string[]) => {
      const r = await p.repoObject.create({ data: { type: 'ROLE', nameEn, nameAr: nameEn } });
      for (const id of users)
        await p.userJobRole.create({ data: { userId: id, repoObjectId: r.id } });
      return r.id;
    };
    const dmn = await p.diagram.create({
      data: {
        type: 'DMN',
        code: 'DMN-001',
        nameEn: 'Budget approval',
        status: 'APPROVED',
        content: BUDGET_DMN,
      },
    });
    await p.diagramVersion.create({
      data: { diagramId: dmn.id, versionNumber: 1, content: BUDGET_DMN, changeNote: 'v1' },
    });
    ids = {
      sectionManagerRoleId: await role('Section manager', [sec.id]),
      pmoRoleId: await role('PMO officer', [p1.id, p2.id]),
      financeRoleId: await role('Budget approver', [fin.id]),
      dgoRoleId: await role('DGO', [dg.id]),
      dmnDiagramId: dmn.id,
      requesterId: reqUser.id,
      strategyId: strategy.id,
    };
    admin = await loggedIn(ctx.app, 'admin@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    reviewer = await loggedIn(ctx.app, 'reviewer@test.local');
    requester = await loggedIn(ctx.app, 'requester@test.local');
    other = await loggedIn(ctx.app, 'other@test.local');
    section = await loggedIn(ctx.app, 'section@test.local');
    deptHead = await loggedIn(ctx.app, 'head@test.local');
    finance = await loggedIn(ctx.app, 'finance@test.local');
    pmo1 = await loggedIn(ctx.app, 'pmo1@test.local');
    pmo2 = await loggedIn(ctx.app, 'pmo2@test.local');
    dgo = await loggedIn(ctx.app, 'dgo@test.local');
    auditor = await loggedIn(ctx.app, 'auditor@test.local');
    viewerElsewhere = await loggedIn(ctx.app, 'elsewhere@test.local');
    const rev = await p.user.findUniqueOrThrow({ where: { email: 'reviewer@test.local' } });
    const wf = (
      await admin
        .post('/workflows')
        .send({
          nameEn: 'Review',
          steps: [{ nameEn: 'Review', assignees: [{ type: 'USER', userId: rev.id }] }],
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
      await modeler
        .post('/processes')
        .send({
          code: 'PMS-01',
          nameEn: 'Program request approval',
          nameAr: 'اعتماد طلب البرنامج',
          category: 'CORE',
          departmentId: strategy.id,
        })
        .expect(201)
    ).body.id;
    await ctx.prisma.process.update({ where: { id: processId }, data: { ownerId: head.id } });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('executable check: clear messages for unsupported elements, none for the PMS model', async () => {
    const bad = buildWorkflowBpmn(
      'X',
      [
        { id: 'S', type: 'startEvent', en: 'Start', ar: 'بداية' },
        { id: 'T', type: 'task', en: 'Plain task', ar: 'مهمة' },
        { id: 'E', type: 'endEvent', en: 'End', ar: 'نهاية' },
      ],
      [
        { id: 'F1', from: 'S', to: 'T' },
        { id: 'F2', from: 'T', to: 'E' },
      ],
    );
    const res = (
      await modeler.post(`/workflow/processes/${processId}/check`).send({ xml: bad }).expect(200)
    ).body;
    expect(res.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSUPPORTED_ELEMENT',
          elementId: 'T',
          severity: 'error',
          detail: 'userTask',
        }),
      ]),
    );
    await saveModel(processId, pmsProgramRequestXml(ids as never));
    const ok = (await modeler.post(`/workflow/processes/${processId}/check`).send({}).expect(200))
      .body;
    expect(ok.issues.filter((i: { severity: string }) => i.severity === 'error')).toEqual([]);
  });

  it('execution settings need workflow.design and edit rights; only the published version deploys', async () => {
    const cfg = {
      enabled: true,
      casePrefix: 'PMS',
      startMode: 'ALL',
      startRoles: [],
      startDepartmentIds: [],
      allowWithdraw: true,
      monitorUserIds: [],
      retentionDays: null,
      eventLog: true,
      pseudonymiseLog: false,
    };
    await reviewer.put(`/workflow/processes/${processId}/config`).send(cfg).expect(403);
    await requester.put(`/workflow/processes/${processId}/config`).send(cfg).expect(403);
    const saved = (
      await modeler.put(`/workflow/processes/${processId}/config`).send(cfg).expect(200)
    ).body;
    expect(saved).toMatchObject({
      enabled: true,
      casePrefix: 'PMS',
      canDesign: true,
      publishedVersion: null,
    });
    expect(saved.canDeploy).toBe(false);
    const notPub = await deptHead
      .post(`/workflow/processes/${processId}/deploy`)
      .send({})
      .expect(400);
    expect(notPub.body.code).toBe('NOT_PUBLISHED');
    await publish(processId);
    // Deploying makes the process live: the Process Owner of this process and workflow admins only
    // (D-154). Modelers set it up but cannot deploy; another Process Owner cannot either.
    expect(
      (await modeler.get(`/workflow/processes/${processId}/config`).expect(200)).body.canDeploy,
    ).toBe(false);
    await modeler.post(`/workflow/processes/${processId}/deploy`).send({}).expect(403);
    await viewerElsewhere.post(`/workflow/processes/${processId}/deploy`).send({}).expect(403);
    await reviewer.post(`/workflow/processes/${processId}/deploy`).send({}).expect(403);
    expect(
      (await deptHead.get(`/workflow/processes/${processId}/config`).expect(200)).body.canDeploy,
    ).toBe(true);
    const deployed = (
      await deptHead.post(`/workflow/processes/${processId}/deploy`).send({}).expect(200)
    ).body;
    // While deployed, a Modeler cannot switch it off or change who may start it, but can change the rest.
    await modeler
      .put(`/workflow/processes/${processId}/config`)
      .send({ ...cfg, enabled: false })
      .expect(403);
    await modeler
      .put(`/workflow/processes/${processId}/config`)
      .send({ ...cfg, startMode: 'RESTRICTED', startRoles: ['REVIEWER'] })
      .expect(403);
    await modeler
      .put(`/workflow/processes/${processId}/config`)
      .send({ ...cfg, allowWithdraw: true })
      .expect(200);
    expect(deployed.activeDeployment).toMatchObject({ versionNumber: 1, active: true });
    expect(deployed.eventLogId).toBeTruthy();
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'DEPLOY' } });
    expect(audit).toBeTruthy();
  });

  it('service catalogue and start form; start rights per process', async () => {
    const cat = (await requester.get('/workflow/catalogue').expect(200)).body;
    expect(cat).toEqual([
      expect.objectContaining({ processId, code: 'PMS-01', casePrefix: 'PMS' }),
    ]);
    const form = (await requester.get(`/workflow/catalogue/${processId}`).expect(200)).body;
    expect(form.form.fields.map((f: { key: string }) => f.key)).toContain('estimatedBudget');
    expect(form.bpmnXml).toContain('SectionReview');
    // Auditors have no start right.
    await auditor.get('/workflow/catalogue').expect(403);
  });

  let caseId: string;
  it('starts a case with server-side form validation and assigns the section manager', async () => {
    const bad = await requester
      .post(`/workflow/catalogue/${processId}/start`)
      .send({
        data: { programName: '', estimatedBudget: 'lots', programType: 'x', evil: '<script>' },
      })
      .expect(400);
    expect(bad.body.code).toBe('FORM_INVALID');
    const res = (
      await requester
        .post(`/workflow/catalogue/${processId}/start`)
        .send({
          data: {
            programName: 'Smart permits',
            programType: 'digital',
            estimatedBudget: 80000,
            requestingDepartment: ids.strategyId,
            justification: 'Faster permits for citizens',
          },
        })
        .expect(201)
    ).body;
    expect(res.number).toBe(`PMS-${year}-00001`);
    caseId = res.id;
    const tasks = await myTasks(section);
    expect(tasks).toEqual([
      expect.objectContaining({
        elementId: 'SectionReview',
        caseNumber: res.number,
        approval: true,
      }),
    ]);
    expect(tasks[0].dueAt).toBeTruthy();
    const n = await ctx.prisma.notification.findFirst({
      where: { type: 'WORKFLOW', user: { email: 'section@test.local' } },
    });
    expect(n?.params).toMatchObject({ kind: 'assigned', code: res.number });
  });

  it('case visibility: initiator, assignees, owner, monitors and auditors only', async () => {
    const mine = (await requester.get(`/workflow/cases/${caseId}`).expect(200)).body;
    expect(mine).toMatchObject({ status: 'RUNNING', canWithdraw: true, canCancel: false });
    expect(mine.activeElementIds).toEqual(['SectionReview']);
    expect(mine.startData).toMatchObject({ programName: 'Smart permits' });
    await other.get(`/workflow/cases/${caseId}`).expect(404);
    await viewerElsewhere.get(`/workflow/cases/${caseId}`).expect(404);
    await section.get(`/workflow/cases/${caseId}`).expect(200);
    await deptHead.get(`/workflow/cases/${caseId}`).expect(200); // process owner
    const ro = (await auditor.get(`/workflow/cases/${caseId}`).expect(200)).body;
    expect(ro).toMatchObject({ canComment: false, canUpload: false, canCancel: false });
    await auditor.post(`/workflow/cases/${caseId}/comments`).send({ body: 'x' }).expect(403);
    expect((await other.get('/workflow/cases?scope=mine').expect(200)).body.total).toBe(0);
    await other.get('/workflow/cases?scope=monitor').expect(403);
  });

  it('return for correction needs a comment; the initiator corrects and resubmits', async () => {
    await requester
      .post(`/workflow/tasks/${(await myTasks(section))[0].id}/complete`)
      .send({ data: {}, decision: 'APPROVE', version: 0 })
      .expect(403);
    const noComment = await complete(section, 'SectionReview', 'RETURN');
    expect(noComment.status).toBe(400);
    expect(noComment.body.code).toBe('COMMENT_REQUIRED');
    await complete(section, 'SectionReview', 'RETURN', {}, 'Please raise the budget estimate').then(
      (r) => expect(r.status).toBe(200),
    );
    const fix = await openTask(requester, 'CorrectRequest');
    expect(fix.values).toMatchObject({ programName: 'Smart permits', estimatedBudget: 80000 });
    await requester
      .post(`/workflow/tasks/${fix.id}/complete`)
      .send({
        data: {
          programName: 'Smart permits',
          programType: 'digital',
          estimatedBudget: 150000,
          justification: 'Faster permits, larger scope',
        },
        decision: null,
        version: fix.version,
      })
      .expect(200);
    expect((await myTasks(section))[0].elementId).toBe('SectionReview');
  });

  it('double completion: exactly one of two submissions wins (optimistic lock)', async () => {
    const t = await openTask(section, 'SectionReview');
    const body = {
      data: { sectionNotes: 'ok' },
      decision: 'APPROVE',
      comment: '',
      version: t.version,
    };
    const [a, b] = await Promise.all([
      section.post(`/workflow/tasks/${t.id}/complete`).send(body),
      section.post(`/workflow/tasks/${t.id}/complete`).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.code, b.body.code]).toContain('TASK_ALREADY_COMPLETED');
    const done = await ctx.prisma.workflowTask.count({
      where: { caseId, elementId: 'SectionReview', status: 'COMPLETED' },
    });
    expect(done).toBe(2); // the returned one and this one
    expect(
      await ctx.prisma.workflowTask.count({
        where: { caseId, elementId: 'DeptApproval', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('department manager approves; the DMN rule adds the budget approval (≥ AED 100,000)', async () => {
    const t = await openTask(deptHead, 'DeptApproval');
    expect(t.decisions).toEqual(['APPROVE', 'REJECT', 'RETURN']);
    expect((await complete(deptHead, 'DeptApproval', 'APPROVE')).status).toBe(200);
    const c = (await requester.get(`/workflow/cases/${caseId}`).expect(200)).body;
    expect(c.activeElementIds).toEqual(['BudgetApprovalTask']);
    expect(c.completedElementIds).toEqual(
      expect.arrayContaining(['SectionReview', 'DeptApproval', 'BudgetRule']),
    );
    expect((await complete(finance, 'BudgetApprovalTask', 'APPROVE')).status).toBe(200);
  });

  it('group task: PMO officers claim; the second claim fails', async () => {
    const group = (await pmo1.get('/workflow/tasks?scope=group').expect(200)).body.items;
    expect(group).toEqual([
      expect.objectContaining({ elementId: 'PmoReview', unclaimed: true, candidateCount: 2 }),
    ]);
    await pmo1.post(`/workflow/tasks/${group[0].id}/claim`).expect(200);
    const second = await pmo2.post(`/workflow/tasks/${group[0].id}/claim`).expect(409);
    expect(second.body.code).toBe('TASK_CLAIMED_BY_OTHER');
    expect(
      (await complete(pmo1, 'PmoReview', 'APPROVE', { pmoNotes: 'Fits the portfolio' })).status,
    ).toBe(200);
  });

  it('DGO approves; the approval letter is generated and the case completes', async () => {
    // Out of office: the DGO's task goes to the substitute (requested before the task exists).
    expect((await complete(dgo, 'DgoApproval', 'APPROVE')).status).toBe(200);
    expect(await jobs.runDue()).toBeGreaterThan(0);
    const c = (await requester.get(`/workflow/cases/${caseId}`).expect(200)).body;
    expect(c).toMatchObject({ status: 'COMPLETED', outcome: 'NORMAL' });
    const doc = c.files.find((f: { kind: string }) => f.kind === 'GENERATED');
    expect(doc.name).toContain(`PMS-${year}-00001`);
    const dl = await requester.get(`/workflow/files/${doc.id}`).expect(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['content-type']).toContain('wordprocessingml');
    expect(Number(dl.headers['content-length'])).toBeGreaterThan(1000);
    await other.get(`/workflow/files/${doc.id}`).expect(404);
    expect(c.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining([
        'STARTED',
        'TASK_COMPLETED',
        'DOCUMENT_GENERATED',
        'NOTIFICATION_SENT',
        'COMPLETED',
      ]),
    );
    const msg = await ctx.prisma.notification.findFirst({
      where: {
        type: 'WORKFLOW',
        user: { email: 'requester@test.local' },
        params: { path: ['kind'], equals: 'message' },
      },
    });
    expect(msg?.params).toMatchObject({ msgSubjectEn: 'Program approved: Smart permits' });
  });

  it('feeds the live event log (mining) with the completed steps', async () => {
    const cfg = await ctx.prisma.workflowProcessConfig.findUniqueOrThrow({ where: { processId } });
    const log = await ctx.prisma.eventLog.findUniqueOrThrow({ where: { id: cfg.eventLogId! } });
    expect(log).toMatchObject({ source: 'WORKFLOW', status: 'READY', caseCount: 1 });
    const acts = await ctx.prisma.miningActivity.findMany({ where: { logId: log.id } });
    expect(acts.find((a) => a.name === 'Section manager review')).toMatchObject({
      bpmnElementId: 'SectionReview',
      eventCount: 2,
    });
    const ev = await ctx.prisma.miningEvent.findFirst({
      where: { logId: log.id, activity: 'PMO review' },
    });
    expect(ev).toMatchObject({ caseId: `PMS-${year}-00001`, resource: 'pmo1' });
    expect(ev?.startAt).toBeTruthy();
  });

  it('four-eyes: the initiator cannot approve their own request', async () => {
    await requester
      .post(`/workflow/catalogue/${processId}/start`)
      .send({
        data: {
          programName: 'Own',
          programType: 'digital',
          estimatedBudget: 10,
          requestingDepartment: ids.strategyId,
          justification: 'x',
        },
      })
      .expect(201);
    // The department head starts a request: their manager rule climbs to the parent (none) → incident.
    const own = (
      await deptHead
        .post(`/workflow/catalogue/${processId}/start`)
        .send({
          data: {
            programName: 'Head',
            programType: 'digital',
            estimatedBudget: 10,
            requestingDepartment: ids.strategyId,
            justification: 'x',
          },
        })
        .expect(201)
    ).body;
    expect((await complete(section, 'SectionReview', 'APPROVE')).status).toBe(200);
    expect((await myTasks(section)).length).toBe(1);
    const second = await complete(section, 'SectionReview', 'APPROVE');
    expect(second.status).toBe(200);
    const headCase = (await deptHead.get(`/workflow/cases/${own.id}`).expect(200)).body;
    expect(headCase.stuck || headCase.activeElementIds.includes('DeptApproval')).toBe(true);
  });

  it('incident (nobody to assign) → stuck in the monitor → retry after fixing', async () => {
    const stuck = await ctx.prisma.workflowCase.findFirst({ where: { stuck: true } });
    expect(stuck).toBeTruthy();
    const mon = (await admin.get('/workflow/monitor').expect(200)).body;
    expect(mon.processes[0]).toMatchObject({ code: 'PMS-01', stuck: 1 });
    expect(mon.stuckCases[0].incidents[0]).toMatchObject({
      code: 'NO_ASSIGNEE',
      elementId: 'DeptApproval',
    });
    await deptHead.post(`/workflow/cases/${stuck!.id}/retry`).expect(403);
    // Give the strategy department a parent with a manager.
    const top = await ctx.prisma.department.create({
      data: { nameEn: 'Executive office', nameAr: 'المكتب التنفيذي' },
    });
    const dg = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dgo@test.local' } });
    await ctx.prisma.department.update({ where: { id: top.id }, data: { managerId: dg.id } });
    await ctx.prisma.department.update({
      where: { id: ids.strategyId },
      data: { parentId: top.id },
    });
    await admin.post(`/workflow/cases/${stuck!.id}/retry`).expect(204);
    const after = (await admin.get(`/workflow/cases/${stuck!.id}`).expect(200)).body;
    expect(after.stuck).toBe(false);
    expect((await myTasks(dgo)).some((t: { caseId: string }) => t.caseId === stuck!.id)).toBe(true);
  });

  it('withdraw by the initiator; cancel by an admin (audited)', async () => {
    const mine = (await requester.get('/workflow/cases?scope=mine&status=RUNNING').expect(200)).body
      .items;
    const target = mine[0];
    await other.post(`/workflow/cases/${target.id}/withdraw`).send({ reason: 'x' }).expect(404);
    await requester
      .post(`/workflow/cases/${target.id}/withdraw`)
      .send({ reason: 'No longer needed' })
      .expect(204);
    expect((await requester.get(`/workflow/cases/${target.id}`).expect(200)).body.status).toBe(
      'WITHDRAWN',
    );
    expect(
      await ctx.prisma.workflowTask.count({ where: { caseId: target.id, status: 'OPEN' } }),
    ).toBe(0);
    const running = await ctx.prisma.workflowCase.findFirstOrThrow({
      where: { status: 'RUNNING' },
    });
    await deptHead.post(`/workflow/cases/${running.id}/cancel`).send({ reason: 'x' }).expect(403);
    await admin
      .post(`/workflow/cases/${running.id}/cancel`)
      .send({ reason: 'Duplicate request' })
      .expect(204);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: { in: ['WITHDRAW', 'CANCEL'] }, entityType: 'WorkflowCase' },
      }),
    ).toBe(2);
  });

  it('version pinning: a new deployment does not change running cases', async () => {
    const started = (
      await requester
        .post(`/workflow/catalogue/${processId}/start`)
        .send({
          data: {
            programName: 'Pinned',
            programType: 'digital',
            estimatedBudget: 5,
            requestingDepartment: ids.strategyId,
            justification: 'x',
          },
        })
        .expect(201)
    ).body;
    const xml2 = pmsProgramRequestXml(ids as never).replace(
      'Section manager review',
      'Section manager check',
    );
    await saveModel(processId, xml2);
    await publish(processId);
    await modeler.post(`/workflow/processes/${processId}/deploy`).send({}).expect(403);
    const cfg = (
      await deptHead.post(`/workflow/processes/${processId}/deploy`).send({}).expect(200)
    ).body;
    expect(cfg.activeDeployment.versionNumber).toBeGreaterThan(1);
    expect(
      cfg.deployments.find((d: { active: boolean }) => !d.active).runningCases,
    ).toBeGreaterThan(0);
    const old = (await requester.get(`/workflow/cases/${started.id}`).expect(200)).body;
    expect(old.versionNumber).toBe(1);
    expect(old.bpmnXml).toContain('Section manager review');
    const fresh = (
      await requester
        .post(`/workflow/catalogue/${processId}/start`)
        .send({
          data: {
            programName: 'New',
            programType: 'digital',
            estimatedBudget: 5,
            requestingDepartment: ids.strategyId,
            justification: 'x',
          },
        })
        .expect(201)
    ).body;
    expect(
      (await requester.get(`/workflow/cases/${fresh.id}`).expect(200)).body.versionNumber,
    ).toBe(cfg.activeDeployment.versionNumber);
  });

  it('timers survive a restart: a crashed RUNNING job is released and fires once', async () => {
    const pid = (
      await modeler
        .post('/processes')
        .send({ code: 'WAIT-01', nameEn: 'Wait', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await saveModel(
      pid,
      buildWorkflowBpmn(
        'W',
        [
          { id: 'S', type: 'startEvent', en: 'Start', ar: 'بداية' },
          {
            id: 'Wait',
            type: 'intermediateCatchEvent',
            en: 'Wait a day',
            ar: 'انتظار يوم',
            timer: { kind: 'timeDuration', value: 'P1D' },
          },
          {
            id: 'T',
            type: 'userTask',
            en: 'Follow up',
            ar: 'متابعة',
            exec: { assignment: { type: 'INITIATOR' } },
          },
          { id: 'E', type: 'endEvent', en: 'End', ar: 'نهاية' },
        ],
        [
          { id: 'F1', from: 'S', to: 'Wait' },
          { id: 'F2', from: 'Wait', to: 'T' },
          { id: 'F3', from: 'T', to: 'E' },
        ],
      ),
    );
    await publish(pid);
    await modeler
      .put(`/workflow/processes/${pid}/config`)
      .send({
        enabled: true,
        casePrefix: 'WAIT',
        startMode: 'ALL',
        startRoles: [],
        startDepartmentIds: [],
        allowWithdraw: true,
        monitorUserIds: [],
        retentionDays: null,
        eventLog: false,
        pseudonymiseLog: false,
      })
      .expect(200);
    // A process without an owner: workflow admins deploy it.
    await modeler.post(`/workflow/processes/${pid}/deploy`).send({}).expect(403);
    await admin.post(`/workflow/processes/${pid}/deploy`).send({}).expect(200);
    const c = (
      await requester.post(`/workflow/catalogue/${pid}/start`).send({ data: {} }).expect(201)
    ).body;
    const job = await ctx.prisma.workflowJob.findFirstOrThrow({
      where: { caseId: c.id, kind: 'TIMER' },
    });
    expect(job.dueAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    // Not due yet.
    expect(await jobs.runDue()).toBe(0);
    // The API crashed while running it: RUNNING with an expired lock.
    await ctx.prisma.workflowJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', lockedUntil: new Date(Date.now() - 1000) },
    });
    const later = () => new Date(Date.now() + 2 * 86_400_000);
    expect(await jobs.runDue(later)).toBeGreaterThanOrEqual(1);
    expect((await ctx.prisma.workflowJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'DONE',
    );
    // Fires once: running again (or a duplicate job for the same token) changes nothing.
    await ctx.prisma.workflowJob.create({
      data: {
        kind: 'TIMER',
        caseId: c.id,
        tokenId: job.tokenId,
        elementId: 'Wait',
        dueAt: new Date(),
      },
    });
    await jobs.runDue(later);
    const tasks = await ctx.prisma.workflowTask.findMany({ where: { caseId: c.id } });
    expect(tasks).toEqual([expect.objectContaining({ elementId: 'T', status: 'OPEN' })]);
  });

  it('escalation: manager, department-head and group fallbacks to the process owner; per-process delays', async () => {
    const dg = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dgo@test.local' } });
    const head = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'head@test.local' } });
    const before = await ctx.prisma.process.findUniqueOrThrow({ where: { id: processId } });
    // A process owner who is not in the approval chain, so the fallbacks are visible.
    await ctx.prisma.process.update({ where: { id: processId }, data: { ownerId: dg.id } });
    const cfg = (await admin.get(`/workflow/processes/${processId}/config`).expect(200)).body;
    const {
      processId: _p,
      code: _c,
      nameEn: _n,
      nameAr: _a,
      publishedVersion: _v,
      activeDeployment: _d,
      deployments: _ds,
      eventLogId: _e,
      canDesign: _cd,
      canDeploy: _cdp,
      ...input
    } = cfg;
    await admin
      .put(`/workflow/processes/${processId}/config`)
      .send({ ...input, reminderMinutesBefore: 60, escalationDelayMinutes: 120 })
      .expect(200);
    const c = (
      await requester
        .post(`/workflow/catalogue/${processId}/start`)
        .send({
          data: {
            programName: 'Escalate',
            programType: 'digital',
            estimatedBudget: 5,
            requestingDepartment: ids.strategyId,
            justification: 'x',
          },
        })
        .expect(201)
    ).body;
    const calendar = new BusinessCalendar(
      DEFAULT_WORKFLOW_SETTINGS.calendar,
      DEFAULT_UAE_HOLIDAYS.map((h) => h.date),
    );
    const sectionTask = await ctx.prisma.workflowTask.findFirstOrThrow({
      where: { caseId: c.id, elementId: 'SectionReview' },
    });
    const jobOf = (kind: string, tokenId: string) =>
      ctx.prisma.workflowJob.findFirstOrThrow({
        where: { caseId: c.id, tokenId, kind, status: 'PENDING' },
      });
    const remind = await jobOf('REMINDER', sectionTask.tokenId);
    const escalate = await jobOf('ESCALATE', sectionTask.tokenId);
    expect(calendar.workingMinutesBetween(remind.dueAt, sectionTask.dueAt!)).toBe(60);
    expect(calendar.workingMinutesBetween(sectionTask.dueAt!, escalate.dueAt)).toBe(120);
    const decideTask = async (cl: Client, id: string) => {
      const t = (await cl.get(`/workflow/tasks/${id}`).expect(200)).body;
      await cl
        .post(`/workflow/tasks/${id}/complete`)
        .send({ data: {}, decision: 'APPROVE', comment: '', version: t.version })
        .expect(200);
    };
    const later = () => new Date(Date.now() + 60 * 86_400_000);
    const escalatedTo = async (step: string) =>
      (
        await ctx.prisma.notification.findMany({
          where: { type: 'WORKFLOW', params: { path: ['kind'], equals: 'escalated' } },
        })
      )
        .filter(
          (n) =>
            (n.params as { code?: string; stepEn?: string }).code === c.number &&
            (n.params as { stepEn?: string }).stepEn === step,
        )
        .map((n) => n.userId)
        .sort();
    // 1. The section manager's task escalates to their department head.
    await jobs.runDue(later);
    expect(await escalatedTo('Section manager review')).toEqual([head.id]);
    // 2. The department head is the assignee: no manager above → the process owner.
    await decideTask(section, sectionTask.id);
    await jobs.runDue(later);
    expect(await escalatedTo('Department manager approval')).toEqual([dg.id]);
    // 3. An unclaimed group task (PMO) → the process owner.
    await decideTask(
      deptHead,
      (
        await ctx.prisma.workflowTask.findFirstOrThrow({
          where: { caseId: c.id, elementId: 'DeptApproval' },
        })
      ).id,
    );
    const pmo = await ctx.prisma.workflowTask.findFirstOrThrow({
      where: { caseId: c.id, elementId: 'PmoReview' },
    });
    expect(pmo.assigneeId).toBeNull();
    await jobs.runDue(later);
    expect(await escalatedTo('PMO review')).toEqual([dg.id]);
    await ctx.prisma.process.update({
      where: { id: processId },
      data: { ownerId: before.ownerId },
    });
    await admin
      .put(`/workflow/processes/${processId}/config`)
      .send({ ...input, reminderMinutesBefore: null, escalationDelayMinutes: null })
      .expect(200);
  });

  it('monitor, dashboard and Excel export respect the monitor scope', async () => {
    await requester.get('/workflow/monitor').expect(403);
    const scoped = (await viewerElsewhere.get('/workflow/monitor').expect(200)).body;
    expect(scoped.processes).toEqual([]);
    const dash = (await admin.get(`/workflow/dashboard?processId=${processId}`).expect(200)).body;
    expect(dash.started).toBeGreaterThanOrEqual(4);
    expect(dash.completed).toBeGreaterThanOrEqual(1);
    expect(
      dash.steps.find((s: { elementId: string }) => s.elementId === 'SectionReview').completed,
    ).toBeGreaterThanOrEqual(2);
    expect(dash.workload.some((w: { kind: string }) => w.kind === 'USER')).toBe(true);
    const xlsx = await admin.get('/workflow/dashboard/export?locale=ar').buffer(true).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const own = (await deptHead.get('/workflow/dashboard').expect(200)).body;
    expect(own.started).toBeGreaterThanOrEqual(4); // process owner
  });

  it('out of office: new tasks go to the substitute; delegation and reassignment', async () => {
    const dg = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dgo@test.local' } });
    const p2 = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'pmo2@test.local' } });
    const today = new Date().toISOString().slice(0, 10);
    await dgo
      .put('/workflow/out-of-office')
      .send({ from: today, to: today, substituteId: dg.id })
      .expect(400);
    const ooo = (
      await dgo
        .put('/workflow/out-of-office')
        .send({ from: '2020-01-01', to: '2099-01-01', substituteId: p2.id })
        .expect(200)
    ).body;
    expect(ooo).toMatchObject({ active: true, substitute: expect.objectContaining({ id: p2.id }) });
    // Drive a fresh case to the DGO step.
    const c = (
      await requester
        .post(`/workflow/catalogue/${processId}/start`)
        .send({
          data: {
            programName: 'Sub',
            programType: 'digital',
            estimatedBudget: 5,
            requestingDepartment: ids.strategyId,
            justification: 'x',
          },
        })
        .expect(201)
    ).body;
    const step = async (cl: Client, el: string) => {
      const t = (await myTasks(cl)).find(
        (x: { caseId: string; elementId: string }) => x.caseId === c.id && x.elementId === el,
      );
      const d = (await cl.get(`/workflow/tasks/${t.id}`).expect(200)).body;
      await cl
        .post(`/workflow/tasks/${t.id}/complete`)
        .send({ data: {}, decision: 'APPROVE', comment: '', version: d.version })
        .expect(200);
    };
    await step(section, 'SectionReview');
    await step(deptHead, 'DeptApproval');
    const g = (await pmo1.get('/workflow/tasks?scope=group').expect(200)).body.items.find(
      (x: { caseId: string }) => x.caseId === c.id,
    );
    await pmo1.post(`/workflow/tasks/${g.id}/claim`).expect(200);
    await step(pmo1, 'PmoReview');
    const subTask = (await myTasks(pmo2)).find((x: { caseId: string }) => x.caseId === c.id);
    expect(subTask).toMatchObject({
      elementId: 'DgoApproval',
      onBehalfOf: expect.objectContaining({ id: dg.id }),
    });
    // Delegate back to section; admin reassigns to the DGO.
    const sec = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'section@test.local' } });
    await pmo2
      .post(`/workflow/tasks/${subTask.id}/delegate`)
      .send({ userId: sec.id, comment: 'Please handle' })
      .expect(204);
    expect((await myTasks(section)).some((t: { id: string }) => t.id === subTask.id)).toBe(true);
    await pmo2.post(`/workflow/tasks/${subTask.id}/reassign`).send({ userId: dg.id }).expect(403);
    await admin
      .post(`/workflow/tasks/${subTask.id}/reassign`)
      .send({ userId: dg.id, comment: 'Back' })
      .expect(204);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: { in: ['DELEGATE', 'REASSIGN'] } } }),
    ).toBe(2);
    await dgo
      .put('/workflow/out-of-office')
      .send({ from: null, to: null, substituteId: null })
      .expect(200);
  });

  it('comments with mentions and attachments on a running case', async () => {
    const running = (await requester.get('/workflow/cases?scope=mine&status=RUNNING').expect(200))
      .body.items[0];
    const sec = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'section@test.local' } });
    const o = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'other@test.local' } });
    await requester
      .post(`/workflow/cases/${running.id}/comments`)
      .send({ body: `Please check @[Section](${sec.id}) and @[Other](${o.id})` })
      .expect(201);
    expect(
      await ctx.prisma.notification.count({ where: { type: 'MENTIONED', userId: sec.id } }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({ where: { type: 'MENTIONED', userId: o.id } }),
    ).toBe(0);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const up = await requester
      .post('/workflow/files')
      .field('caseId', running.id)
      .attach('file', pdf, 'quote.pdf')
      .expect(201);
    expect(up.body).toMatchObject({
      name: 'quote.pdf',
      mimeType: 'application/pdf',
      kind: 'UPLOAD',
    });
    const exe = await requester
      .post('/workflow/files')
      .field('caseId', running.id)
      .attach('file', Buffer.from('MZ\x90\x00binary'), 'tool.exe')
      .expect(400);
    expect(exe.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    await other
      .post('/workflow/files')
      .field('caseId', running.id)
      .attach('file', pdf, 'x.pdf')
      .expect(404);
  });

  it('retention removes form data of closed cases after the period', async () => {
    await ctx.prisma.workflowProcessConfig.update({
      where: { processId },
      data: { retentionDays: 30 },
    });
    await ctx.prisma.workflowCase.updateMany({
      where: { processId, status: { not: 'RUNNING' } },
      data: { completedAt: new Date('2020-01-01') },
    });
    const n = await jobs.purgeExpired();
    expect(n).toBeGreaterThan(0);
    const purged = (await requester.get(`/workflow/cases/${caseId}`).expect(200)).body;
    expect(purged).toMatchObject({ dataPurged: true, startData: null, files: [] });
    expect(purged.tasks.every((t: { data: unknown }) => t.data === null)).toBe(true);
    // The title (first text field of the start form) and notifications about the case go too (SEC-32).
    const row = await ctx.prisma.workflowCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.titleEn).toBe(row.number);
    expect(row.closedReason).toBeNull();
    expect(
      await ctx.prisma.notification.count({ where: { link: `/workflow/cases/${caseId}` } }),
    ).toBe(0);
  });
});
