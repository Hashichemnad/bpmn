import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';

const bpmn = (attrs: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D"><bpmn:process id="P"><bpmn:task id="T1" name="Step" ${attrs} /></bpmn:process></bpmn:definitions>`;

describe('Step attributes on save (e2e)', () => {
  let ctx: TestContext;
  let modeler: Client;
  let processId: string;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    processId = (
      await modeler.post('/processes').send({ code: 'C.01', nameEn: 'Sales', category: 'CORE' })
    ).body.id;
  });

  it('accepts valid attributes and rejects invalid ones with details', async () => {
    await modeler
      .put(`/processes/${processId}/model`)
      .send({
        bpmnXml: bpmn(
          'ph:durationMinutes="90" ph:waitingMinutes="0" ph:frequencyPerMonth="12.5" ph:costPerExecution="40" ph:slaMinutes="2880" ph:inputsAr="نموذج"',
        ),
      })
      .expect(200);
    const res = await modeler
      .put(`/processes/${processId}/model`)
      .send({ bpmnXml: bpmn('ph:durationMinutes="-5" ph:costPerExecution="lots"') })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_STEP_ATTRIBUTES',
      details: [
        { path: ['T1', 'durationMinutes'], message: 'NEGATIVE' },
        { path: ['T1', 'costPerExecution'], message: 'NOT_A_NUMBER' },
      ],
    });
    // Versions go through the same check.
    await modeler
      .post(`/processes/${processId}/versions`)
      .send({ bpmnXml: bpmn('ph:slaMinutes="99999999999"'), changeNote: 'x' })
      .expect(400);
  });
});
