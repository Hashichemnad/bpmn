import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateInvoiceLog, invoiceLogCsv, invoiceLogXes } from './demo-event-log';

/** Writes the sample event logs of docs/samples (Phase 5.1): `npx ts-node --transpile-only prisma/generate-mining-samples.ts`. */
const dir = join(__dirname, '..', '..', '..', 'docs', 'samples');
writeFileSync(join(dir, 'invoice-processing-log.csv'), invoiceLogCsv(generateInvoiceLog(200, 7)));
writeFileSync(join(dir, 'invoice-processing-log.xes'), invoiceLogXes(generateInvoiceLog(40, 7)));
console.warn(`Samples written to ${dir}`);
