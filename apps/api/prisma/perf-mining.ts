import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  LogDataBuilder,
  analyseLog,
  checkConformance,
  decodeLogData,
  encodeLogData,
  heuristicsMiner,
  miningMappingSchema,
  parseBpmnGraph,
  sortRawLog,
} from '@processhub/shared';
import { openRows } from '../src/mining/import/file-readers';
import { RowNormaliser } from '../src/mining/import/normalise';
import { generateInvoiceLog, invoiceLogCsv } from './demo-event-log';

/**
 * Performance check of process mining on ~1 million events (Phase 5.1, D-141). Runs the same code as
 * the import job (streaming CSV reader, row normaliser, batched inserts of 5,000 events, columnar
 * snapshot) and the analyses, and prints the timings recorded in docs/PROGRESS.md.
 *
 *   DATABASE_URL=… npx ts-node --transpile-only prisma/perf-mining.ts [cases=180000] [--no-db]
 *
 * Inserts go into a temporary event log that is deleted at the end. Not part of CI (minutes).
 */
async function main() {
  const cases = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 180_000);
  const useDb = !process.argv.includes('--no-db');
  const t = () => performance.now();
  const ms = (a: number) => `${((t() - a) / 1000).toFixed(1)} s`;
  const mem = () => `${Math.round(process.memoryUsage().rss / 1e6)} MB RSS`;

  let s = t();
  const events = generateInvoiceLog(cases, 99);
  const csv = Buffer.from(invoiceLogCsv(events));
  console.log(
    `Generated ${cases} cases / ${events.length} events, CSV ${(csv.length / 1e6).toFixed(0)} MB in ${ms(s)}`,
  );

  const mapping = miningMappingSchema.parse({
    caseColumn: 'case_id',
    activityColumn: 'activity',
    startColumn: 'start_time',
    endColumn: 'end_time',
    resourceColumn: 'resource',
    departmentColumn: 'department',
    attributeColumns: ['amount', 'channel'],
    timestampFormat: 'iso',
  });
  const prisma = useDb ? new PrismaClient() : null;
  const logId = '00000000-0000-4000-8000-00000000f00d';
  if (prisma) {
    await prisma.eventLog.deleteMany({ where: { id: logId } });
    await prisma.$executeRaw`DELETE FROM "MiningEvent" WHERE "logId" = ${logId}::uuid`;
    await prisma.eventLog.create({ data: { id: logId, code: 'PERF', nameEn: 'Performance test' } });
  }

  // 1. Streaming parse + validation + batched insert (as the IMPORT job).
  s = t();
  const source = await openRows('CSV', Readable.from(csv), { delimiter: ',' });
  const norm = new RowNormaliser(mapping, 'iso', false);
  const builder = new LogDataBuilder(mapping.attributeColumns);
  let batch: Prisma.MiningEventCreateManyInput[] = [];
  let insertMs = 0;
  for await (const row of source.rows) {
    const e = norm.next(row);
    if (!e) continue;
    builder.add(e);
    if (prisma) {
      batch.push({
        logId,
        caseId: e.caseId,
        activity: e.activity,
        startAt: e.start === null ? null : new Date(e.start),
        endAt: new Date(e.end),
        resource: e.resource ?? null,
        department: e.department ?? null,
        attributes: e.attrs as Prisma.InputJsonValue,
      });
      if (batch.length >= 5000) {
        const i = t();
        await prisma.miningEvent.createMany({ data: batch });
        insertMs += t() - i;
        batch = [];
      }
    }
  }
  if (prisma && batch.length) {
    const i = t();
    await prisma.miningEvent.createMany({ data: batch });
    insertMs += t() - i;
  }
  const report = norm.finish();
  console.log(
    `Import (parse + validate${prisma ? ' + insert' : ''}): ${report.events} events, ${report.cases} cases in ${ms(s)}` +
      (prisma ? ` (inserts ${(insertMs / 1000).toFixed(1)} s)` : '') +
      `, ${mem()}`,
  );

  // 2. Columnar snapshot (worker task "prepareLog").
  s = t();
  const bytes = encodeLogData(sortRawLog(builder.raw()));
  const gz = gzipSync(bytes, { level: 6 });
  console.log(
    `Snapshot: ${(bytes.length / 1e6).toFixed(0)} MB, gzip ${(gz.length / 1e6).toFixed(0)} MB in ${ms(s)}`,
  );
  s = t();
  const log = decodeLogData(bytes);
  console.log(`Snapshot decode: ${ms(s)}`);

  // 3. Analyses (worker tasks).
  s = t();
  const a = analyseLog(log, {});
  console.log(
    `Analysis (map, variants, statistics, bottlenecks): ${a.variants.total} variants in ${ms(s)}`,
  );
  s = t();
  analyseLog(log, {
    filters: [{ type: 'attribute', name: 'amount', values: ['High'], exclude: false }],
    activityLevel: 0.8,
  });
  console.log(`Analysis with a filter and the activity slider: ${ms(s)}`);
  s = t();
  const net = heuristicsMiner(log, {});
  console.log(`Heuristics miner: ${net.arcs.length} arcs in ${ms(s)}`);
  if (prisma) {
    const proc = await prisma.process.findFirst({
      where: { code: 'S.01.04' },
      include: { model: true },
    });
    if (proc?.model) {
      const graph = parseBpmnGraph(proc.model.bpmnXml);
      const map: Record<string, string | null> = {};
      for (const n of graph.nodes) map[n.nameEn] = n.id;
      s = t();
      const c = checkConformance(log, graph, map);
      console.log(`Conformance (token replay): fitness ${c.fitness.toFixed(3)} in ${ms(s)}`);
    }
    s = t();
    const n = await prisma.miningEvent.count({ where: { logId } });
    const one = await prisma.miningEvent.findMany({ where: { logId, caseId: 'INV-000500' } });
    console.log(`DB: ${n} rows, case drill-down (${one.length} events) in ${ms(s)}`);
    s = t();
    for (;;) {
      const d =
        await prisma.$executeRaw`DELETE FROM "MiningEvent" WHERE id IN (SELECT id FROM "MiningEvent" WHERE "logId" = ${logId}::uuid LIMIT 20000)`;
      if (!d) break;
    }
    await prisma.eventLog.delete({ where: { id: logId } });
    console.log(`Delete in batches: ${ms(s)}`);
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
