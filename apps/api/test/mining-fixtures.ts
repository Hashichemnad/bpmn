import { waitJob, type Client } from './helpers';

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
