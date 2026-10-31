import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  IMPORT_LIMITS,
  type ImportColumnDto,
  type ImportFieldDto,
  type ImportIssue,
  type Locale,
} from '@processhub/shared';
import { XLSX_TYPE, addSheet, cellText, norm, type ExcelFile } from '../../common/excel';
import type { LoadedImportFile } from '../importer';
import { ImportFileError, checkOfficePackage, decodeText } from '../safe-upload';

/** A column of a tabular import (Excel / CSV): key, bilingual header and accepted aliases. */
export interface TabularField {
  key: string;
  en: string;
  ar: string;
  required?: boolean;
  aliases?: string[];
  width?: number;
  /** Allowed values listed on the template's "Lists" sheet. */
  values?: readonly string[];
}

export interface TabularRow {
  /** 1-based row number in the file (header = 1). */
  row: number;
  values: Record<string, string>;
}

export interface TabularResult {
  rows: TabularRow[];
  columns: ImportColumnDto[];
  fields: ImportFieldDto[];
  issues: ImportIssue[];
}

/** Reads the first sheet of a workbook or a CSV file (delimiter detected: , ; tab |). */
export async function readTable(
  file: LoadedImportFile,
): Promise<{ headers: string[]; rows: string[][] }> {
  if (file.ext === 'csv') {
    const text = decodeText(file.data);
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = [';', '\t', '|', ','].reduce((best, d) =>
      first.split(d).length > first.split(best).length ? d : best,
    );
    let records: string[][];
    try {
      records = parseCsv(text, {
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
        bom: true,
        to: IMPORT_LIMITS.rows + 1,
      }) as string[][];
    } catch {
      throw new ImportFileError('CSV_INVALID', { file: file.fileName });
    }
    const [headers = [], ...rows] = records;
    return { headers: headers.map((h) => h.trim()), rows: rows.map((r) => r.map((c) => c.trim())) };
  }
  await checkOfficePackage(file.data, file.fileName, 'xl/workbook.xml');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.data as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('FILE_TYPE_MISMATCH', { file: file.fileName });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportFileError('EMPTY_FILE', { file: file.fileName });
  const width = ws.columnCount;
  const headers: string[] = [];
  for (let c = 1; c <= width; c++) headers.push(cellText(ws.getRow(1).getCell(c).value));
  const rows: string[][] = [];
  ws.eachRow((r, n) => {
    if (n === 1 || rows.length > IMPORT_LIMITS.rows) return;
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(r.getCell(c).value));
    rows.push(cells);
  });
  return { headers, rows };
}

/**
 * Reads a tabular file and maps its columns to fields: the stored mapping (field → header) wins,
 * else headers are matched by key, English / Arabic label or alias. Rows without any value are
 * dropped; row numbers are those of the file.
 */
export async function readTabular(
  file: LoadedImportFile,
  fields: TabularField[],
  mapping: Record<string, string> | undefined,
): Promise<TabularResult> {
  const { headers, rows } = await readTable(file);
  const normHeaders = headers.map(norm);
  const index = new Map<string, number>();
  for (const f of fields) {
    const explicit = mapping?.[f.key];
    if (explicit !== undefined) {
      const at = normHeaders.indexOf(norm(explicit));
      if (explicit && at >= 0) index.set(f.key, at);
      continue;
    }
    const names = [f.key, f.en, f.ar, ...(f.aliases ?? [])].map(norm);
    const at = normHeaders.findIndex(
      (h, i) => h && names.includes(h) && ![...index.values()].includes(i),
    );
    if (at >= 0) index.set(f.key, at);
  }
  const issues: ImportIssue[] = [];
  for (const f of fields)
    if (f.required && !index.has(f.key))
      issues.push({ level: 'ERROR', code: 'COLUMN_MISSING', params: { column: f.en } });
  if (rows.length > IMPORT_LIMITS.rows)
    throw new ImportFileError('TOO_MANY_ROWS', { max: IMPORT_LIMITS.rows });
  const byColumn = new Map([...index].map(([k, i]) => [i, k]));
  const columns: ImportColumnDto[] = headers
    .map((header, i) => ({
      header,
      field: byColumn.get(i) ?? null,
      sample: rows.find((r) => r[i])?.[i]?.slice(0, 40) ?? '',
    }))
    .filter((c) => c.header);
  const out: TabularRow[] = [];
  rows.forEach((cells, n) => {
    const values: Record<string, string> = {};
    for (const [k, i] of index) values[k] = (cells[i] ?? '').trim();
    if (Object.values(values).some((v) => v !== '')) out.push({ row: n + 2, values });
  });
  return {
    rows: out,
    columns,
    fields: fields.map((f) => ({ key: f.key, required: !!f.required })),
    issues,
  };
}

/** Template workbook: one header row in the user's language plus a "Lists" sheet of coded values. */
export async function tabularTemplate(
  fileKey: string,
  name: string,
  fields: TabularField[],
  examples: string[][],
  locale: Locale,
): Promise<ExcelFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProcessHub';
  const ws = addSheet(
    wb,
    name,
    fields.map((f) => f[locale]),
    fields.map((f) => f.width ?? 20),
    locale,
  );
  for (const r of examples) ws.addRow(r);
  const coded = fields.filter((f) => f.values);
  if (coded.length) {
    const lists = addSheet(
      wb,
      locale === 'ar' ? 'القوائم' : 'Lists',
      coded.map((f) => f[locale]),
      coded.map(() => 24),
      locale,
    );
    const depth = Math.max(0, ...coded.map((f) => f.values!.length));
    for (let r = 0; r < depth; r++) lists.addRow(coded.map((f) => f.values![r] ?? null));
  }
  return {
    data: Buffer.from(await wb.xlsx.writeBuffer()),
    fileName: `${fileKey}-template.xlsx`,
    contentType: XLSX_TYPE,
  };
}

export const issue = (
  level: 'ERROR' | 'WARNING',
  code: string,
  params?: Record<string, string | number>,
): ImportIssue => ({ level, code, ...(params ? { params } : {}) });

export const splitCells = (raw: string) =>
  raw
    .split(/[;,\n،]/)
    .map((s) => s.trim())
    .filter(Boolean);

export { norm };
