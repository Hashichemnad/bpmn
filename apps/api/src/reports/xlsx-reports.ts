import ExcelJS from 'exceljs';
import type { LinkRelation, Locale, ObjectType } from '@processhub/shared';
import { minutesText, pick, reportTexts, stepTypeText, statusText, fill } from './report-i18n';
import type { ReportProcess } from './report-data.service';
import { reportSteps } from './report-steps';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF6' },
};

/** Bold header row, frozen, with filters; right-to-left sheet in Arabic. */
function sheet(
  wb: ExcelJS.Workbook,
  name: string,
  locale: Locale,
  header: string[],
  widths: number[],
) {
  const ws = wb.addWorksheet(name.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1, rightToLeft: locale === 'ar' }],
  });
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  return ws;
}

/**
 * RACI / responsibility matrix (Excel, D-087): steps × roles. R = the role performs the step
 * (its lane or a "performs" link), A = the performer of an approval step. Second sheet: IT systems
 * per step; third: the steps with their attributes; fourth: the legend.
 */
export async function buildRaci(processes: ReportProcess[], locale: Locale): Promise<Buffer> {
  const t = reportTexts(locale);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProcessHub';
  const rows = processes.flatMap((p) => reportSteps(p, locale).map((s) => ({ p, s })));
  const roles = [...new Set(rows.flatMap((r) => r.s.roles))];
  const multi = processes.length > 1;
  const lead = multi ? [t.process] : [];

  const raci = sheet(
    wb,
    t.raciSheet,
    locale,
    [...lead, '#', t.step, t.type, ...roles],
    [...(multi ? [28] : []), 5, 40, 14, ...roles.map(() => 16)],
  );
  rows.forEach(({ p, s }, i) => {
    const letter = s.type === 'approval' ? 'A' : 'R';
    const row = raci.addRow([
      ...(multi ? [`${p.code} ${pick(locale, p)}`] : []),
      i + 1,
      s.name,
      stepTypeText(locale, s.type),
      ...roles.map((r) => (s.roles.includes(r) ? letter : null)),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    for (let c = lead.length + 4; c <= lead.length + 3 + roles.length; c++) {
      const cell = row.getCell(c);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (cell.value === 'A') cell.font = { bold: true, color: { argb: 'FF6D28D9' } };
      if (cell.value === 'R') cell.font = { bold: true, color: { argb: 'FF1D4ED8' } };
    }
  });
  raci.getRow(1).alignment = { textRotation: 0, wrapText: true, vertical: 'middle' };

  const systems = sheet(
    wb,
    t.systemsSheet,
    locale,
    [...lead, '#', t.step, t.system],
    [...(multi ? [28] : []), 5, 40, 40],
  );
  rows.forEach(({ p, s }, i) => {
    for (const sys of s.systems.length ? s.systems : [''])
      systems.addRow([...(multi ? [`${p.code} ${pick(locale, p)}`] : []), i + 1, s.name, sys]);
  });

  const steps = sheet(
    wb,
    t.stepsSheet,
    locale,
    [
      ...lead,
      '#',
      t.step,
      t.type,
      t.role,
      t.system,
      t.description,
      t.processing,
      t.waiting,
      t.sla,
      t.frequency,
      t.cost,
      t.inputs,
      t.outputs,
    ],
    [...(multi ? [28] : []), 5, 36, 14, 24, 24, 50, 12, 12, 12, 12, 12, 30, 30],
  );
  rows.forEach(({ p, s }, i) => {
    const a = s.attributes;
    const time = (m?: number) => (m === undefined ? '' : minutesText(locale, m));
    const row = steps.addRow([
      ...(multi ? [`${p.code} ${pick(locale, p)}`] : []),
      i + 1,
      s.name,
      stepTypeText(locale, s.type),
      s.roles.join(', '),
      s.systems.join(', '),
      s.description,
      time(a.durationMinutes),
      time(a.waitingMinutes),
      time(a.slaMinutes),
      a.frequencyPerMonth ?? '',
      a.costPerExecution ?? '',
      (locale === 'ar' ? a.inputsAr || a.inputsEn : a.inputsEn || a.inputsAr) ?? '',
      (locale === 'ar' ? a.outputsAr || a.outputsEn : a.outputsEn || a.outputsAr) ?? '',
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
  });

  const legend = sheet(wb, t.legendSheet, locale, ['', t.description], [8, 80]);
  for (const [k, v] of t.raciLegend) legend.addRow([k, v]);
  legend.addRow([]);
  for (const p of processes)
    legend.addRow([
      p.code,
      `${pick(locale, p)} — ${statusText(locale, p.status)}${p.versionNumber ? ` · v${p.versionNumber}` : ''}`,
    ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface ObjectUsageRow {
  process: { code: string; nameEn: string; nameAr: string; status: ReportProcess['status'] };
  bpmnElementId: string;
  element: { nameEn: string; nameAr: string } | null;
  relation: LinkRelation;
}

/** "Where used" of a role, IT system or dictionary term (Excel, D-087). */
export async function buildObjectReport(
  object: { type: ObjectType; code: string | null; nameEn: string; nameAr: string },
  usage: ObjectUsageRow[],
  locale: Locale,
): Promise<Buffer> {
  const t = reportTexts(locale);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProcessHub';
  const ws = sheet(
    wb,
    t.objectReport,
    locale,
    [t.code, t.process, t.status, t.element, t.relation],
    [12, 40, 14, 40, 18],
  );
  for (const u of usage)
    ws.addRow([
      u.process.code,
      pick(locale, u.process),
      statusText(locale, u.process.status),
      pick(locale, u.element) || u.bpmnElementId,
      t.relations[u.relation],
    ]);
  const info = sheet(wb, t.objectType, locale, [t.objectType, pick(locale, object)], [24, 60]);
  info.addRow([t.objectTypes[object.type], object.code ?? '']);
  info.addRow([
    t.objectReport,
    fill(t.usedIn, { n: usage.length, p: new Set(usage.map((u) => u.process.code)).size }),
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
