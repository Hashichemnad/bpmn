import ExcelJS from 'exceljs';
import { AssuranceScheduler } from '../src/assurance/assurance-scheduler.service';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  sampleBpmn,
  type Client,
  type TestContext,
} from './helpers';

/** Questionnaires and surveys (Phase 4.2, step 4 — D-102). */
describe('Questionnaires and surveys (e2e)', () => {
  let ctx: TestContext;
  let officer: Client;
  let viewer: Client;
  let owner: Client;
  let modeler: Client;
  let outsider: Client;
  let deptId: string;
  let viewerId: string;
  let riskId: string;
  let controlId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    deptId = (
      await ctx.prisma.department.create({ data: { nameEn: 'Finance', nameAr: 'المالية' } })
    ).id;
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    viewerId = (
      await createUser(ctx.prisma, 'viewer@test.local', ['VIEWER'], { departmentId: deptId })
    ).id;
    await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER'], { departmentId: deptId });
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'outsider@test.local', ['REVIEWER']);
    officer = await loggedIn(ctx.app, 'officer@test.local');
    viewer = await loggedIn(ctx.app, 'viewer@test.local');
    owner = await loggedIn(ctx.app, 'owner@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    outsider = await loggedIn(ctx.app, 'outsider@test.local');
    riskId = (
      await officer.post('/grc/risks').send({
        code: 'R-1',
        nameEn: 'Fraud',
        category: 'FRAUD',
        inherentLikelihood: 4,
        inherentImpact: 4,
      })
    ).body.item.id;
    controlId = (
      await officer
        .post('/grc/controls')
        .send({ code: 'C-1', nameEn: 'Approval', status: 'ACTIVE' })
    ).body.item.id;
  });

  const rcsa = () => ({
    titleEn: 'Finance self-assessment',
    titleAr: 'التقييم الذاتي للمالية',
    purpose: 'RCSA',
    status: 'ACTIVE',
    definition: {
      sections: [
        {
          id: 'risks',
          titleEn: 'Risks',
          questions: [
            {
              id: 'likelihood',
              type: 'RATING',
              textEn: 'How likely is fraud now?',
              required: true,
              weight: 1,
              link: { objectId: riskId, field: 'LIKELIHOOD' },
            },
            {
              id: 'control',
              type: 'SINGLE',
              textEn: 'Does the approval control work?',
              required: true,
              options: [
                { id: 'EFFECTIVE', en: 'Yes', score: 2 },
                { id: 'PARTLY', en: 'Partly', score: 1 },
                { id: 'NOT_EFFECTIVE', en: 'No', score: 0 },
              ],
              weight: 1,
              link: { objectId: controlId, field: 'EFFECTIVENESS' },
            },
            {
              id: 'policy',
              type: 'YES_NO_NA',
              textEn: 'Is the policy known?',
              required: true,
              weight: 2,
            },
            {
              id: 'why',
              type: 'TEXT',
              textEn: 'Why not?',
              required: true,
              showIf: { questionId: 'policy', equals: ['NO'] },
            },
            { id: 'evidence', type: 'FILE', textEn: 'Evidence' },
          ],
        },
      ],
    },
  });

  it('builds a questionnaire, runs a campaign, scores answers and turns them into proposals', async () => {
    const bad = rcsa();
    bad.definition.sections[0].questions[3].showIf = { questionId: 'evidence', equals: ['x'] };
    await officer.post('/surveys/questionnaires').send(bad).expect(400);
    await owner.post('/surveys/questionnaires').send(rcsa()).expect(403);
    const q = (await officer.post('/surveys/questionnaires').send(rcsa()).expect(201)).body;
    expect(q).toMatchObject({ questionCount: 5, purpose: 'RCSA' });

    const created = await officer
      .post('/surveys/campaigns')
      .send({ questionnaireId: q.id, audience: { departmentIds: [deptId] }, endAt: '2026-12-31' })
      .expect(201);
    const c = created.body;
    expect(c.status).toBe('DRAFT');
    const launched = (await officer.post(`/surveys/campaigns/${c.id}/launch`).expect(200)).body;
    expect(launched.counts).toEqual({ SENT: 2, OPENED: 0, SUBMITTED: 0 });
    const invited = await ctx.prisma.notification.count({ where: { type: 'SURVEY' } });
    expect(invited).toBe(2);

    const task = (await viewer.get('/assurance/tasks').expect(200)).body.surveys;
    expect(task).toHaveLength(1);
    const responseId = task[0].id;
    await outsider.get(`/surveys/responses/${responseId}`).expect(404); // not a recipient
    await owner.get(`/surveys/responses/${responseId}`).expect(404); // somebody else's response
    const mine = (await viewer.get(`/surveys/responses/${responseId}`).expect(200)).body;
    expect(mine).toMatchObject({ status: 'OPENED', canAnswer: true });

    // Required + conditional questions are checked on submit.
    const r1 = await viewer
      .put(`/surveys/responses/${responseId}`)
      .send({ answers: { likelihood: 2, control: 'PARTLY', policy: 'NO' }, submit: true })
      .expect(400);
    expect(r1.body.details.problems).toEqual([{ questionId: 'why', code: 'REQUIRED' }]);
    const file = await viewer
      .post(`/surveys/responses/${responseId}/files`)
      .attach('file', Buffer.from('%PDF-1.4 policy'), { filename: 'policy.pdf' })
      .expect(201);
    const done = (
      await viewer
        .put(`/surveys/responses/${responseId}`)
        .send({
          answers: {
            likelihood: 2,
            control: 'PARTLY',
            policy: 'NO',
            why: 'New staff',
            evidence: [file.body.id, 'forged'],
          },
          submit: true,
        })
        .expect(200)
    ).body;
    expect(done).toMatchObject({ status: 'SUBMITTED', canAnswer: false });
    expect(done.answers.evidence).toEqual([file.body.id]);
    await viewer.put(`/surveys/responses/${responseId}`).send({ answers: {} }).expect(409);
    // score: likelihood 2×1 of 5, control 1 of 2, policy NO 0 of 2 → 3 of 9
    const stored = await ctx.prisma.surveyResponse.findUniqueOrThrow({ where: { id: responseId } });
    expect([stored.score, stored.maxScore]).toEqual([3, 9]);

    const results = (await officer.get(`/surveys/campaigns/${c.id}/results`).expect(200)).body;
    expect(results).toMatchObject({ responseRate: 50, averageScorePercent: 33 });
    expect(
      results.questions.find((x: { questionId: string }) => x.questionId === 'policy').counts,
    ).toEqual({ NO: 1 });
    expect(
      results.questions.find((x: { questionId: string }) => x.questionId === 'why').texts,
    ).toEqual(['New staff']);

    const xlsx = await officer
      .get(`/surveys/campaigns/${c.id}/export?locale=ar`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['الردود', 'الملخص']);
    expect(wb.worksheets[0].views[0].rightToLeft).toBe(true);
    expect(wb.worksheets[0].rowCount).toBe(3);

    // Self-assessment proposals: the officer accepts the likelihood, dismisses the effectiveness.
    const proposals = (await officer.get(`/surveys/campaigns/${c.id}/proposals`).expect(200)).body;
    expect(
      proposals.map((p: { field: string; value: string; current: string }) => [
        p.field,
        p.value,
        p.current,
      ]),
    ).toEqual([
      ['LIKELIHOOD', '2', '4'],
      ['EFFECTIVENESS', 'PARTLY', 'NOT_ASSESSED'],
    ]);
    await owner
      .post(`/surveys/proposals/${proposals[0].id}/decision`)
      .send({ decision: 'ACCEPT' })
      .expect(403);
    await officer
      .post(`/surveys/proposals/${proposals[0].id}/decision`)
      .send({ decision: 'ACCEPT' })
      .expect(200);
    await officer
      .post(`/surveys/proposals/${proposals[1].id}/decision`)
      .send({ decision: 'DISMISS' })
      .expect(200);
    const risk = (await officer.get(`/grc/risks/${riskId}`)).body.item;
    expect([risk.residualLikelihood, risk.residualImpact]).toEqual([2, 4]);
    expect((await officer.get(`/grc/controls/${controlId}`)).body.item.effectiveness).toBe(
      'NOT_ASSESSED',
    );

    // Reminders before the end, then the campaign closes itself.
    const scheduler = ctx.app.get(AssuranceScheduler);
    await scheduler.runOnce(new Date('2026-12-29T00:00:00Z'));
    await scheduler.runOnce(new Date('2026-12-30T00:00:00Z'));
    expect(
      await ctx.prisma.notification.count({
        where: { type: 'SURVEY', params: { path: ['kind'], equals: 'reminder' } },
      }),
    ).toBe(1);
    await scheduler.runOnce(new Date('2027-01-02T00:00:00Z'));
    expect((await officer.get(`/surveys/campaigns/${c.id}`)).body.status).toBe('CLOSED');
  });

  it('"Request feedback" on a draft process: recipients see the diagram and answers become comments', async () => {
    const processId = (
      await modeler
        .post('/processes')
        .send({ code: 'S.01', nameEn: 'Purchasing', category: 'SUPPORT' })
        .expect(201)
    ).body.id;
    await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: sampleBpmn(['Task_Order']) })
      .expect(200);
    await outsider
      .post('/surveys/feedback-requests')
      .send({ processId, audience: { userIds: [viewerId] }, endAt: '2027-01-31' })
      .expect(403);
    const c = (
      await modeler
        .post('/surveys/feedback-requests')
        .send({
          processId,
          audience: { userIds: [viewerId] },
          endAt: '2027-01-31',
          messageEn: 'Please check',
        })
        .expect(201)
    ).body;
    expect(c).toMatchObject({
      purpose: 'PROCESS_FEEDBACK',
      status: 'OPEN',
      process: { code: 'S.01' },
    });
    const responseId = (await viewer.get('/assurance/tasks')).body.surveys[0].id;
    const r = (await viewer.get(`/surveys/responses/${responseId}`).expect(200)).body;
    expect(r.campaign).toMatchObject({ descriptionEn: 'Please check', process: { id: processId } });
    expect(
      (await viewer.get(`/surveys/responses/${responseId}/diagram`).expect(200)).body.bpmnXml,
    ).toContain('Task_Order');
    await viewer
      .put(`/surveys/responses/${responseId}`)
      .send({
        answers: { clarity: 4, matches: 'NO', differences: 'Approval is missing' },
        submit: true,
      })
      .expect(200);
    const comments = (await modeler.get(`/comments/processes/${processId}`).expect(200)).body;
    const body = JSON.stringify(comments);
    expect(body).toContain('Approval is missing');
    expect(body).toContain('4/5');
    // The requester sees the results; others do not.
    await modeler.get(`/surveys/campaigns/${c.id}/results`).expect(200);
    await outsider.get(`/surveys/campaigns/${c.id}/results`).expect(404);
  });
});
