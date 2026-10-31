import ExcelJS from 'exceljs';
import type { Client } from './helpers';

/** Workbook with a header row and data rows. */
export async function xlsx(header: string[], rows: (string | number | null)[][], sheet = 'Sheet') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Reads a binary response body into a Buffer. */
export const binary = (
  r: import('node:stream').Readable,
  cb: (e: Error | null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Uploads files as a new batch and waits until the preview is ready (or failed). */
export async function upload(
  client: Client,
  kind: string,
  files: { name: string; data: Buffer }[],
  options: Record<string, unknown> = {},
  expectStatus = 201,
) {
  let req = client.post('/imports').field('kind', kind).field('options', JSON.stringify(options));
  for (const f of files) req = req.attach('files', f.data, f.name);
  const res = await req.expect(expectStatus);
  if (expectStatus !== 201) return res.body;
  return waitBatch(client, res.body.id);
}

/** Polls the batch until no job runs. */
export async function waitBatch(client: Client, id: string) {
  for (let i = 0; i < 200; i++) {
    const b = (await client.get(`/imports/${id}`).expect(200)).body;
    if (!['UPLOADED', 'PARSING', 'APPLYING'].includes(b.status)) return b;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Import batch did not finish');
}

export async function applyBatch(client: Client, id: string) {
  await client.post(`/imports/${id}/apply`).expect(200);
  return waitBatch(client, id);
}

/** All preview items of a batch. */
export async function itemsOf(client: Client, id: string, filter = 'all') {
  return (await client.get(`/imports/${id}/items?pageSize=200&filter=${filter}`).expect(200)).body
    .items as {
    ref: string;
    action: string;
    key: string;
    nameEn: string;
    nameAr: string;
    issues: { level: string; code: string; params?: Record<string, unknown> }[];
    suggestions: {
      id: string;
      kind: string;
      targetId: string;
      accepted: boolean;
      source: string;
    }[];
    matchBy: string | null;
    matchId: string | null;
    changes: { field: string; from: unknown; to: unknown }[];
    facts?: Record<string, unknown>;
    skip: boolean;
  }[];
}
