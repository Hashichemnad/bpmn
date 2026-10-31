import ExcelJS from 'exceljs';
import type { Locale } from '@processhub/shared';
import { badRequest } from './app-exception';

/**
 * Small Excel helpers shared by the catalogues of Phase 4.3 (architecture, KPIs): a column list
 * drives the export, the template and the header matching of an import.
 */

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const EXCEL_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const EXCEL_IMPORT_MAX_ROWS = 2000;

export type Cell = string | number | boolean | Date | null;

export interface ExcelColumn<T> {
  key: string;
  en: string;
  ar: string;
  width: number;
  /** Allowed values (listed on the "Lists" sheet). */
  values?: readonly string[];
  date?: boolean;
  get: (item: T) => Cell;
}

export interface ExcelFile {
  data: Buffer;
  fileName: string;
  contentType: string;
}

export const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF6' },
};

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Text of a cell (rich text, formulas and hyperlinks flattened; dates as YYYY-MM-DD). */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    return '';
  }
  return String(v).trim();
}

export const iso = (v: string | null | undefined) => (v ? new Date(v) : null);
export const yesNo = (v: boolean, locale: Locale) =>
  v ? (locale === 'ar' ? 'نعم' : 'Yes') : locale === 'ar' ? 'لا' : 'No';
export function parseYesNo(raw: string): boolean | null {
  const k = norm(raw);
  if (['yes', 'y', 'true', '1', 'نعم', 'x'].includes(k)) return true;
  if (['no', 'n', 'false', '0', 'لا', ''].includes(k)) return false;
  return null;
}

/** A sheet with a bold, frozen, filtered header row (right-to-left in Arabic). */
export function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  header: string[],
  widths: number[],
  locale: Locale,
) {
  const ws = wb.addWorksheet(name.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1, rightToLeft: locale === 'ar' }],
  });
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, header.length) },
  };
  return ws;
}

/** Workbook with the rows of one catalogue and a "Lists" sheet of the allowed coded values. */
export async function catalogueWorkbook<T>(
  sheetName: string,
  columns: ExcelColumn<T>[],
  rows: T[],
  locale: Locale,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProcessHub';
  const ws = addSheet(
    wb,
    sheetName,
    columns.map((c) => c[locale]),
    columns.map((c) => c.width),
    locale,
  );
  for (const item of rows) ws.addRow(columns.map((c) => c.get(item)));
  columns.forEach((c, i) => {
    if (c.date) ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
  });
  const coded = columns.filter((c) => c.values);
  if (coded.length) {
    const lists = addSheet(
      wb,
      locale === 'ar' ? 'القوائم' : 'Lists',
      coded.map((c) => c[locale]),
      coded.map(() => 24),
      locale,
    );
    const depth = Math.max(0, ...coded.map((c) => c.values!.length));
    for (let r = 0; r < depth; r++) lists.addRow(coded.map((c) => c.values![r] ?? null));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Reads the first sheet of an uploaded workbook: header cells are matched by column key, English
 * or Arabic label. Checks the ZIP signature, size and row count; `required` columns must exist.
 */
export async function readUpload<T>(
  file: Express.Multer.File | undefined,
  columns: ExcelColumn<T>[],
  required: string[] = ['code'],
) {
  if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
  if (file.size > EXCEL_IMPORT_MAX_BYTES) throw badRequest('FILE_TOO_LARGE');
  if (file.buffer.subarray(0, 4).toString('hex') !== '504b0304')
    throw badRequest('INVALID_FILE_TYPE');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('INVALID_FILE_TYPE');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('EMPTY_FILE');
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => norm(cellText(v)));
  const index = new Map<string, number>();
  for (const c of columns) {
    const at = header.findIndex((h) => h && [c.key, c.en, c.ar].some((l) => norm(l) === h));
    if (at > 0) index.set(c.key, at);
  }
  for (const r of required) if (!index.has(r)) throw badRequest('MISSING_CODE_COLUMN');
  const rows: { row: number; values: Record<string, string> }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const values: Record<string, string> = {};
    for (const [k, i] of index) values[k] = cellText(r.getCell(i).value);
    if (Object.values(values).some((v) => v !== '')) rows.push({ row: n, values });
  });
  if (rows.length > EXCEL_IMPORT_MAX_ROWS) throw badRequest('TOO_MANY_ROWS');
  return { rows, present: new Set(index.keys()) };
}

/** Lookup of codes / names / e-mails (normalised) to ids. */
export function lookup<T extends { id: string }>(items: T[], ...keys: ((x: T) => string | null)[]) {
  const map = new Map<string, string>();
  for (const i of items)
    for (const k of keys) {
      const v = k(i);
      if (v) map.set(norm(v), i.id);
    }
  return map;
}

export const splitList = (raw: string) =>
  raw
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
