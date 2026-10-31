import ExcelJS from 'exceljs';
import {
  createApp,
  createUser,
  loggedIn,
  resetDb,
  waitJob,
  type Client,
  type TestContext,
} from './helpers';

/** Builds a CSV: per case "Receive → Check (→ Check) → Approve | Reject" with times in hours. */
export function analysisCsv(cases = 20) {
  const rows = ['case,activity,start,end,resource,department,channel'];
  const at = (day: number, h: number) =>
    `2026-02-${String(day).padStart(2, '0')} ${String(h).padStart(2, '0')}:00`;
  for (let i = 1; i <= cases; i++) {
    const d = 1 + (i % 20);
    rows.push(`C${i},Receive,${at(d, 8)},${at(d, 9)},ann,Front,${i % 2 ? 'web' : 'email'}`);
    rows.push(`C${i},Check,${at(d, 10)},${at(d, 11)},bob,Back,${i % 2 ? 'web' : 'email'}`);
    if (i % 4 === 0) rows.push(`C${i},Check,${at(d, 12)},${at(d, 13)},bob,Back,web`);
    rows.push(
      i % 5 === 0
        ? `C${i},Reject,${at(d, 20)},${at(d, 21)},cat,Back,web`
        : `C${i},Approve,${at(d, 14)},${at(d, 15)},cat,Back,web`,
    );
  }
  return rows.join('\n');
}

export async function importLog(c: Client, csv: string, fields: Record<string, string> = {}) {
  let req = c.post('/mining/logs/upload').attach('file', Buffer.from(csv), 'log.csv');
  for (const [k, v] of Object.entries({ nameEn: 'Analysis log', ...fields })) req = req.field(k, v);
  const log = (await req.expect(201)).body;
  const preview = (await c.get(`/mining/logs/${log.id}/preview`).expect(200)).body;
  await c
    .put(`/mining/logs/${log.id}/mapping`)
    .send({ ...preview.suggestion, attributeColumns: ['channel'] })
    .expect(200);
  const job = (await c.post(`/mining/logs/${log.id}/import`).expect(201)).body;
  expect((await waitJob(c, job.id)).status).toBe('DONE');
  return log.id as string;
}

/** Discovery and analysis (Phase 5.1 step 2): map, variants, statistics, filters, export, BPMN. */
describe('Mining — discovery and analysis (e2e)', () => {
  let ctx: TestContext;
  let analyst: Client;
  let reader: Client;
  let logId: string;

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
    const dep = await ctx.prisma.department.create({ data: { nameEn: 'Ops', nameAr: 'العمليات' } });
    await createUser(ctx.prisma, 'analyst@test.local', ['PROCESS_OWNER', 'MODELER'], {
      departmentId: dep.id,
    });
    await createUser(ctx.prisma, 'reader@test.local', ['AUDITOR'], { departmentId: dep.id });
    analyst = await loggedIn(ctx.app, 'analyst@test.local');
    reader = await loggedIn(ctx.app, 'reader@test.local');
    logId = await importLog(analyst, analysisCsv());
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('computes the map, variants, statistics and bottlenecks and caches them', async () => {
    const res = (await reader.post(`/mining/logs/${logId}/analysis`).send({}).expect(200)).body;
    expect(res.status).toBe('DONE');
    const a = res.result;
    expect(a).toMatchObject({ cases: 20, events: 65, hasStartTimes: true });
    const edge = (f: string, t: string) =>
      a.map.edges.find((e: { from: string; to: string }) => e.from === f && e.to === t);
    expect(edge('Receive', 'Check').count).toBe(20);
    expect(edge('Check', 'Check').count).toBe(5);
    expect(edge('Check', 'Reject').count).toBe(4);
    // Receive ends 09:00, Check starts 10:00: one hour.
    expect(edge('Receive', 'Check').duration.mean).toBe(3_600_000);
    expect(a.variants.total).toBe(4);
    expect(a.variants.items[0]).toMatchObject({
      activities: ['Receive', 'Check', 'Approve'],
      count: 12,
    });
    expect(a.stats.rework).toMatchObject({ cases: 5, share: 0.25 });
    expect(a.stats.handovers[0]).toMatchObject({ from: 'ann', to: 'bob', count: 20 });
    expect(a.stats.departmentHandovers).toEqual([{ from: 'Front', to: 'Back', count: 20 }]);
    expect(a.bottlenecks.edges[0]).toMatchObject({ from: 'Check', to: 'Reject' });
    expect(a.attributeValues.channel).toEqual(['web', 'email']);
    expect(await ctx.prisma.miningResultCache.count({ where: { logId } })).toBe(1);
    // Second call: from the cache, no new job.
    const jobs = await ctx.prisma.miningJob.count({ where: { kind: 'ANALYSE' } });
    await reader.post(`/mining/logs/${logId}/analysis`).send({}).expect(200);
    expect(await ctx.prisma.miningJob.count({ where: { kind: 'ANALYSE' } })).toBe(jobs);
  });

  it('applies stacked filters and the activity slider', async () => {
    const a = (
      await analyst
        .post(`/mining/logs/${logId}/analysis`)
        .send({
          filters: [
            { type: 'attribute', name: 'channel', values: ['email'] },
            { type: 'activity', activities: ['Reject'], mode: 'notContains' },
          ],
        })
        .expect(200)
    ).body.result;
    expect(a.cases).toBe(8);
    const sliced = (
      await analyst.post(`/mining/logs/${logId}/analysis`).send({ activityLevel: 0.75 }).expect(200)
    ).body.result;
    expect(sliced.map.nodes.map((n: { activity: string }) => n.activity)).not.toContain('Reject');
    await analyst
      .post(`/mining/logs/${logId}/analysis`)
      .send({ filters: [{ type: 'nope' }] })
      .expect(400);
  });

  it('saves filters per user and exports Excel', async () => {
    const preset = (
      await analyst
        .post(`/mining/logs/${logId}/presets`)
        .send({
          name: 'E-mail only',
          filters: [{ type: 'attribute', name: 'channel', values: ['email'] }],
        })
        .expect(201)
    ).body;
    expect((await analyst.get(`/mining/logs/${logId}/presets`).expect(200)).body).toHaveLength(1);
    expect((await reader.get(`/mining/logs/${logId}/presets`).expect(200)).body).toHaveLength(0);
    await reader.delete(`/mining/presets/${preset.id}`).expect(404);
    await analyst.delete(`/mining/presets/${preset.id}`).expect(204);

    const res = await reader
      .post(`/mining/logs/${logId}/export`)
      .send({ kind: 'bottlenecks' })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Slowest transitions', 'Slowest activities']);
    expect(wb.worksheets[0].getRow(2).getCell(1).value).toBe('Check');
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'EXPORT', entityType: 'EventLog' } }),
    ).toBe(1);
  });

  it('generates a draft BPMN process with lanes from the log', async () => {
    await reader
      .post(`/mining/logs/${logId}/discover`)
      .send({ code: 'D.01', category: 'CORE', nameEn: 'Discovered' })
      .expect(403);
    const r = (
      await analyst
        .post(`/mining/logs/${logId}/discover`)
        .send({
          code: 'D.01',
          category: 'CORE',
          nameEn: 'Discovered',
          options: { dependency: 0.5 },
        })
        .expect(201)
    ).body;
    expect(r).toMatchObject({ code: 'D.01', activities: 4, lanes: 2 });
    expect(r.gateways).toBeGreaterThanOrEqual(1);
    const p = await ctx.prisma.process.findUniqueOrThrow({
      where: { id: r.processId },
      include: { model: true },
    });
    expect(p.status).toBe('DRAFT');
    expect(p.model?.bpmnXml).toContain('ph:nameEn="Check"');
    expect(p.model?.bpmnXml).toContain('bpmn:lane');
    expect(p.model?.bpmnXml).toContain('bpmndi:BPMNShape');
  });
});
