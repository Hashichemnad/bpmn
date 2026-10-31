import { PassThrough, Readable } from 'node:stream';
import { parse as parseCsv } from 'csv-parse';
import ExcelJS from 'exceljs';
import { SaxesParser } from 'saxes';
import type { MiningFileFormat } from '@processhub/shared';

/**
 * Streaming readers of event log files (Phase 5.1, D-129): every format becomes rows of named
 * columns, read chunk by chunk (never the whole file in memory). XES traces are flattened to one
 * row per activity instance: `lifecycle:transition` start / complete pairs become one row with a
 * start and an end time; trace attributes are prefixed with `case:`.
 */
export type CellValue = string | number | Date | null;

export interface Row {
  /** 1-based row number in the file (data rows; XES: event number). */
  n: number;
  values: Record<string, CellValue>;
}

export interface RowSource {
  columns: string[];
  rows: AsyncGenerator<Row>;
  /** Worksheet names seen (Excel). */
  sheets: string[];
}

export interface ReadOptions {
  delimiter?: string | null;
  sheet?: string | null;
  /** Called with the bytes read so far (progress). */
  onBytes?: (n: number) => void;
}

/** XES columns (fixed names; the mapping suggestion uses them). */
export const XES_COLUMNS = {
  case: 'case:concept:name',
  activity: 'concept:name',
  start: 'time:start',
  end: 'time:timestamp',
  resource: 'org:resource',
  department: 'org:group',
} as const;

/** Detects the format from the first bytes (magic numbers), falling back to the file extension. */
export function detectFileFormat(head: Buffer, fileName: string): MiningFileFormat | null {
  if (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04
  )
    return /\.xlsx$/i.test(fileName) ? 'XLSX' : null;
  if (head.includes(0)) return null; // binary, not text
  const text = head
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (text.startsWith('<'))
    return /<log[\s>]/.test(text) || /\.xes$/i.test(fileName) ? 'XES' : null;
  return /\.(csv|txt|tsv)$/i.test(fileName) ? 'CSV' : null;
}

/** Most frequent candidate in the header line that also splits the next lines the same way. */
export function detectDelimiter(head: string): string {
  const lines = head
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 10);
  const count = (line: string, d: string) => {
    let n = 0;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n++;
    }
    return n;
  };
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const first = count(lines[0] ?? '', d);
    if (!first) continue;
    const consistent = lines.slice(1).filter((l) => count(l, d) === first).length;
    const score = first + consistent * 100;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Column names made unique and non-empty. */
export function uniqueColumns(names: unknown[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    let name = String(raw ?? '').trim() || `Column ${i + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
}

function counting(stream: Readable, onBytes?: (n: number) => void): Readable {
  if (!onBytes) return stream;
  let total = 0;
  const pass = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    total += chunk.length;
    onBytes(total);
  });
  stream.on('error', (e) => pass.destroy(e));
  return stream.pipe(pass);
}

export async function openRows(
  format: MiningFileFormat,
  stream: Readable,
  opts: ReadOptions = {},
): Promise<RowSource> {
  const input = counting(stream, opts.onBytes);
  if (format === 'CSV') return csvRows(input, opts.delimiter ?? ',');
  if (format === 'XLSX') return xlsxRows(input, opts.sheet ?? null);
  return xesRows(input);
}

async function csvRows(stream: Readable, delimiter: string): Promise<RowSource> {
  const parser = stream.pipe(
    parseCsv({
      delimiter,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  const it = parser[Symbol.asyncIterator]() as AsyncIterator<string[]>;
  const first = await it.next();
  const columns = first.done ? [] : uniqueColumns(first.value);
  async function* rows(): AsyncGenerator<Row> {
    let n = 0;
    try {
      for (;;) {
        const r = await it.next();
        if (r.done) return;
        n++;
        const values: Record<string, CellValue> = {};
        columns.forEach((c, i) => (values[c] = r.value[i] ?? null));
        yield { n, values };
      }
    } finally {
      stream.destroy();
    }
  }
  return { columns, rows: rows(), sheets: [] };
}

type ExcelCell = ExcelJS.CellValue;

function excelValue(v: ExcelCell): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return excelValue(v.result as ExcelCell);
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return String(v as unknown);
}

async function xlsxRows(stream: Readable, sheet: string | null): Promise<RowSource> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });
  const sheets: string[] = [];
  const wsIt = (reader as unknown as AsyncIterable<AsyncIterable<ExcelJS.Row> & { name?: string }>)[
    Symbol.asyncIterator
  ]();
  // Find the worksheet (the first one, or the one named in the mapping).
  let target: (AsyncIterable<ExcelJS.Row> & { name?: string }) | null = null;
  for (;;) {
    const ws = await wsIt.next();
    if (ws.done) break;
    const name = ws.value.name ?? `Sheet${sheets.length + 1}`;
    sheets.push(name);
    if (!sheet || sheet === name) {
      target = ws.value;
      break;
    }
    // Skip the rows of other worksheets.
    for await (const _ of ws.value) void _;
  }
  if (!target) {
    stream.destroy();
    return { columns: [], rows: (async function* () {})(), sheets };
  }
  const rowIt = target[Symbol.asyncIterator]();
  const header = await rowIt.next();
  const headerValues = header.done ? [] : (header.value.values as ExcelCell[]).slice(1);
  const columns = uniqueColumns(headerValues.map((v) => excelValue(v) ?? ''));
  async function* rows(): AsyncGenerator<Row> {
    let n = 0;
    try {
      for (;;) {
        const r = await rowIt.next();
        if (r.done) return;
        const cells = (r.value.values as ExcelCell[]).slice(1);
        if (!cells.some((c) => c !== null && c !== undefined && c !== '')) continue;
        n++;
        const values: Record<string, CellValue> = {};
        columns.forEach((c, i) => (values[c] = excelValue(cells[i])));
        yield { n, values };
      }
    } finally {
      stream.destroy();
    }
  }
  return { columns, rows: rows(), sheets };
}

interface XesEvent {
  attrs: Record<string, string>;
}

/** Streams XES traces; rows are produced per finished trace. */
async function xesRows(stream: Readable): Promise<RowSource> {
  const queue: Row[] = [];
  const columns = new Set<string>(Object.values(XES_COLUMNS));
  let n = 0;
  let depth = 0;
  let traceDepth = -1;
  let eventDepth = -1;
  let trace: Record<string, string> | null = null;
  let events: XesEvent[] = [];
  let event: XesEvent | null = null;
  let error: Error | null = null;
  const sax = new SaxesParser({ xmlns: false });

  const flushTrace = () => {
    if (!trace) return;
    const caseAttrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(trace)) {
      const key = k === 'concept:name' ? XES_COLUMNS.case : `case:${k}`;
      caseAttrs[key] = v;
      columns.add(key);
    }
    // Pair start / complete per activity (FIFO); other transitions are ignored.
    const open = new Map<string, XesEvent[]>();
    const out: { start: string | null; ev: XesEvent }[] = [];
    for (const ev of events) {
      const tr = (ev.attrs['lifecycle:transition'] ?? 'complete').toLowerCase();
      const act = ev.attrs['concept:name'] ?? '';
      if (tr === 'start') {
        open.set(act, [...(open.get(act) ?? []), ev]);
      } else if (tr === 'complete') {
        const starts = open.get(act);
        const st = starts?.shift();
        out.push({ start: st?.attrs['time:timestamp'] ?? null, ev });
      }
    }
    for (const starts of open.values()) for (const st of starts) out.push({ start: null, ev: st }); // start without complete
    for (const { start, ev } of out) {
      const values: Record<string, CellValue> = { ...caseAttrs };
      for (const [k, v] of Object.entries(ev.attrs)) {
        if (k === 'lifecycle:transition') continue;
        values[k] = v;
        columns.add(k);
      }
      values[XES_COLUMNS.start] = start;
      queue.push({ n: ++n, values });
    }
    trace = null;
    events = [];
  };

  sax.on('opentag', (tag) => {
    depth++;
    const name = tag.name.replace(/^.*:/, '');
    if (name === 'trace') {
      trace = {};
      events = [];
      traceDepth = depth;
    } else if (name === 'event' && trace) {
      event = { attrs: {} };
      eventDepth = depth;
    } else if (
      ['string', 'date', 'int', 'float', 'boolean', 'id'].includes(name) &&
      typeof tag.attributes.key === 'string'
    ) {
      const key = tag.attributes.key;
      const value = String(tag.attributes.value ?? '');
      // Only direct attributes of an event / trace (nested lists and meta attributes are skipped).
      if (event && depth === eventDepth + 1) event.attrs[key] = value;
      else if (trace && !event && depth === traceDepth + 1) trace[key] = value;
    }
  });
  sax.on('closetag', (tag) => {
    const name = tag.name.replace(/^.*:/, '');
    if (name === 'event' && event && depth === eventDepth) {
      events.push(event);
      event = null;
    } else if (name === 'trace' && depth === traceDepth) flushTrace();
    depth--;
  });
  sax.on('error', (e) => {
    error = e;
  });

  const chunks = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  let ended = false;
  const decoder = new TextDecoder('utf-8');
  /** Feeds chunks until rows are queued or the file ends. */
  const fill = async () => {
    while (!queue.length && !ended) {
      const c = await chunks.next();
      if (c.done) {
        const rest = decoder.decode();
        if (rest) sax.write(rest);
        sax.close();
        ended = true;
      } else sax.write(decoder.decode(c.value, { stream: true }));
      if (error) throw new Error(`XES_INVALID: ${(error as Error).message}`);
    }
  };
  // Read the first trace so the columns are known for the preview.
  await fill();
  async function* rows(): AsyncGenerator<Row> {
    try {
      for (;;) {
        if (!queue.length) await fill();
        const r = queue.shift();
        if (!r) return;
        yield r;
      }
    } finally {
      stream.destroy();
    }
  }
  return { columns: [...columns], rows: rows(), sheets: [] };
}

/** Reads a whole small stream into a buffer (tests, previews of the file head). */
export async function readHead(stream: Readable, bytes: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    parts.push(chunk);
    total += chunk.length;
    if (total >= bytes) break;
  }
  stream.destroy();
  return Buffer.concat(parts).subarray(0, bytes);
}

export const toReadable = (b: Buffer) => Readable.from(b);
