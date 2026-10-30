import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import type { AuditEngagementDetailDto, AuditFindingDto, Locale } from '@processhub/shared';
import { fitImage, type ReportImage } from './handbook-docx';

const FONT = 'Arial';
const ACCENT = '1F4E79';
const MUTED = '64748B';
const HEADER_FILL = 'E8EEF6';
const MARGIN = 1020;

const TEXTS: Record<Locale, Record<string, string>> & { en: Record<string, string> } = {
  en: {
    title: 'Internal audit report',
    generatedOn: 'Generated on {date} by {user}',
    contents: 'Contents',
    summary: 'Executive summary',
    objective: 'Objective',
    scope: 'Scope',
    scopeProcesses: 'Processes',
    scopeDepartments: 'Departments',
    scopeRisks: 'Risks',
    scopeControls: 'Controls',
    scopeRequirements: 'Requirements',
    period: 'Audit period',
    team: 'Audit team',
    lead: 'Lead auditor',
    findingsTable: 'Summary of findings',
    findings: 'Findings',
    responses: 'Management responses',
    code: 'No.',
    finding: 'Finding',
    rating: 'Rating',
    owner: 'Owner',
    target: 'Target date',
    status: 'Response',
    condition: 'Condition',
    criteria: 'Criteria',
    cause: 'Cause',
    effect: 'Effect',
    recommendation: 'Recommendation',
    trace: 'Where it was found',
    process: 'Process',
    step: 'Step',
    risk: 'Risk',
    control: 'Control',
    requirement: 'Requirement',
    agreedAction: 'Agreed action',
    comment: 'Comment',
    issue: 'Follow-up issue',
    none: '—',
    noFindings: 'No findings were raised.',
    PENDING: 'Pending',
    ACCEPTED: 'Agreed',
    DISAGREED: 'Not agreed',
    PLANNED: 'Planned',
    FIELDWORK: 'Fieldwork',
    REPORTING: 'Reporting',
    FOLLOW_UP: 'Follow-up',
    CLOSED: 'Closed',
    engagementStatus: 'Status',
    page: 'Page',
  },
  ar: {
    title: 'تقرير التدقيق الداخلي',
    generatedOn: 'أُنشئ في {date} بواسطة {user}',
    contents: 'المحتويات',
    summary: 'الملخص التنفيذي',
    objective: 'الهدف',
    scope: 'النطاق',
    scopeProcesses: 'العمليات',
    scopeDepartments: 'الإدارات',
    scopeRisks: 'المخاطر',
    scopeControls: 'الضوابط',
    scopeRequirements: 'المتطلبات',
    period: 'فترة التدقيق',
    team: 'فريق التدقيق',
    lead: 'رئيس الفريق',
    findingsTable: 'ملخص النتائج',
    findings: 'النتائج',
    responses: 'ردود الإدارة',
    code: 'الرقم',
    finding: 'النتيجة',
    rating: 'التصنيف',
    owner: 'المسؤول',
    target: 'التاريخ المستهدف',
    status: 'الرد',
    condition: 'الوضع القائم',
    criteria: 'المعيار',
    cause: 'السبب',
    effect: 'الأثر',
    recommendation: 'التوصية',
    trace: 'موضع الملاحظة',
    process: 'العملية',
    step: 'الخطوة',
    risk: 'الخطر',
    control: 'الضابط',
    requirement: 'المتطلب',
    agreedAction: 'الإجراء المتفق عليه',
    comment: 'تعليق',
    issue: 'ملاحظة المتابعة',
    none: '—',
    noFindings: 'لم تُسجل أي نتائج.',
    PENDING: 'بانتظار الرد',
    ACCEPTED: 'موافق',
    DISAGREED: 'غير موافق',
    PLANNED: 'مخطط',
    FIELDWORK: 'العمل الميداني',
    REPORTING: 'إعداد التقرير',
    FOLLOW_UP: 'المتابعة',
    CLOSED: 'مغلق',
    engagementStatus: 'الحالة',
    page: 'صفحة',
  },
};

type Texts = Record<keyof (typeof TEXTS)['en'], string>;

export interface AuditReportInput {
  locale: Locale;
  orgName: string;
  logo: ReportImage | null;
  engagement: AuditEngagementDetailDto;
  /** Severity scale (name and colour of each rating key). */
  ratings: { key: string; nameEn: string; nameAr: string; colour: string }[];
  generatedBy: string;
  generatedAt: Date;
}

/** Audit report (.docx): cover, scope, summary, findings table, findings and management responses. */
export async function buildAuditReport(input: AuditReportInput): Promise<Buffer> {
  const { locale, engagement: e } = input;
  const t = TEXTS[locale] as Texts;
  const rtl = locale === 'ar';
  const pick = (o: object, field = 'name') => {
    const r = o as Record<string, unknown>;
    const en = String(r[`${field}En`] ?? '');
    const ar = String(r[`${field}Ar`] ?? '');
    return rtl ? ar || en : en || ar;
  };
  const ref = (r: { code: string | null; nameEn: string; nameAr: string } | null) =>
    r ? [r.code, pick(r)].filter(Boolean).join(' ') : t.none;
  const date = (d: string | Date | null) =>
    d
      ? new Intl.DateTimeFormat(rtl ? 'ar' : 'en-GB', { dateStyle: 'long' }).format(new Date(d))
      : t.none;
  const user = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? pick(u) || u.email : t.none;
  const rating = (key: string) => input.ratings.find((r) => r.key === key);

  const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({
      text,
      rightToLeft: rtl,
      bold: opts.bold,
      boldComplexScript: opts.bold,
      size: opts.size,
      sizeComplexScript: opts.size,
      color: opts.color,
      font: FONT,
    });
  const para = (
    children: ParagraphChild[] | string,
    opts: {
      heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
      after?: number;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
      pageBreakBefore?: boolean;
    } = {},
  ) =>
    new Paragraph({
      children: typeof children === 'string' ? [run(children)] : children,
      bidirectional: rtl,
      heading: opts.heading,
      alignment: opts.align,
      pageBreakBefore: opts.pageBreakBefore,
      spacing: { after: opts.after ?? 120 },
    });
  const paras = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.length ? lines.map((l) => para(l)) : [para(t.none)];
  };
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (
    content: string,
    opts: { header?: boolean; width?: number; fill?: string; color?: string } = {},
  ) =>
    new TableCell({
      children: [
        para([run(content || t.none, { bold: opts.header, size: 18, color: opts.color })], {
          after: 0,
        }),
      ],
      shading:
        opts.header || opts.fill
          ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill ?? HEADER_FILL }
          : undefined,
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      borders,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });
  const table = (rows: TableRow[]) =>
    new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: rtl });
  const field = (label: string, value: string) => [
    para([run(label, { bold: true, color: ACCENT })], { after: 40 }),
    ...paras(value),
  ];
  const ratingCell = (key: string, width?: number) => {
    const r = rating(key);
    return cell(r ? pick(r) : key, {
      width,
      fill: r?.colour.replace('#', ''),
      color: r ? 'FFFFFF' : undefined,
    });
  };

  // ----- Cover -----
  const cover: (Paragraph | Table)[] = [];
  if (input.logo) {
    cover.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: input.logo.type,
            data: input.logo.data,
            transformation: fitImage(input.logo, 220, 110),
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 1200, after: 600 },
      }),
    );
  }
  cover.push(
    para([run(input.orgName, { size: 28, color: MUTED })], {
      align: AlignmentType.CENTER,
      after: 600,
    }),
    para([run(t.title, { bold: true, size: 56, color: ACCENT })], {
      align: AlignmentType.CENTER,
      after: 240,
    }),
    para([run(`${e.code} · ${pick(e, 'title')}`, { size: 36 })], {
      align: AlignmentType.CENTER,
      after: 400,
    }),
    para([run(`${t.engagementStatus}: ${t[e.status]}`, { size: 22, color: MUTED })], {
      align: AlignmentType.CENTER,
    }),
    para(
      [
        run(
          t.generatedOn
            .replace('{date}', date(input.generatedAt))
            .replace('{user}', input.generatedBy),
          { size: 20, color: MUTED },
        ),
      ],
      {
        align: AlignmentType.CENTER,
      },
    ),
  );

  // ----- Summary and scope -----
  const body: (Paragraph | Table)[] = [
    para(t.summary, { heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
    ...paras(pick(e, 'summary')),
    para(t.objective, { heading: HeadingLevel.HEADING_2 }),
    ...paras(pick(e, 'objective')),
    para(t.scope, { heading: HeadingLevel.HEADING_2 }),
    ...(pick(e, 'scope') ? paras(pick(e, 'scope')) : []),
    table(
      [
        [t.scopeProcesses, e.scope.processes.map(ref).join('\n')],
        [t.scopeDepartments, e.scope.departments.map((d) => pick(d)).join('\n')],
        [t.scopeRisks, e.scope.risks.map(ref).join('\n')],
        [t.scopeControls, e.scope.controls.map(ref).join('\n')],
        [t.scopeRequirements, e.scope.requirements.map(ref).join('\n')],
        [
          t.period,
          `${date(e.actualStart ?? e.plannedStart)} – ${date(e.actualEnd ?? e.plannedEnd)}`,
        ],
        [t.lead, user(e.lead)],
        [t.team, e.team.map(user).join(', ')],
      ].map(
        ([k, v]) =>
          new TableRow({
            children: [
              cell(k, { header: true, width: 28 }),
              new TableCell({
                children: (v || t.none)
                  .split('\n')
                  .map((l) => para([run(l, { size: 18 })], { after: 0 })),
                borders,
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
              }),
            ],
          }),
      ),
    ),
  ];

  // ----- Findings table -----
  body.push(para(t.findingsTable, { heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
  if (!e.findings.length) body.push(para(t.noFindings));
  else
    body.push(
      table([
        new TableRow({
          tableHeader: true,
          children: [
            cell(t.code, { header: true, width: 8 }),
            cell(t.finding, { header: true, width: 38 }),
            cell(t.rating, { header: true, width: 12 }),
            cell(t.owner, { header: true, width: 16 }),
            cell(t.target, { header: true, width: 14 }),
            cell(t.status, { header: true, width: 12 }),
          ],
        }),
        ...e.findings.map(
          (f) =>
            new TableRow({
              children: [
                cell(f.code),
                cell(pick(f, 'title')),
                ratingCell(f.rating),
                cell(user(f.responseOwner)),
                cell(date(f.targetDate)),
                cell(t[f.responseStatus]),
              ],
            }),
        ),
      ]),
    );

  // ----- Findings in detail with the management responses -----
  if (e.findings.length)
    body.push(para(t.findings, { heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
  const traceRows = (f: AuditFindingDto) =>
    [
      [t.process, ref(f.process)],
      [t.step, f.elementLabel ? pick(f.elementLabel) : (f.bpmnElementId ?? '')],
      [t.risk, ref(f.risk)],
      [t.control, ref(f.control)],
      [t.requirement, ref(f.requirement)],
    ].filter(([, v]) => v && v !== t.none);
  for (const f of e.findings) {
    body.push(
      para([run(`${f.code} · ${pick(f, 'title')}`)], { heading: HeadingLevel.HEADING_2 }),
      table([
        new TableRow({
          children: [cell(t.rating, { header: true, width: 28 }), ratingCell(f.rating)],
        }),
      ]),
      para(''),
      ...field(t.condition, pick(f, 'condition')),
      ...field(
        t.criteria,
        [pick(f, 'criteria'), f.requirement ? ref(f.requirement) : ''].filter(Boolean).join('\n'),
      ),
      ...field(t.cause, pick(f, 'cause')),
      ...field(t.effect, pick(f, 'effect')),
      ...field(t.recommendation, pick(f, 'recommendation')),
    );
    const trace = traceRows(f);
    if (trace.length)
      body.push(
        para([run(t.trace, { bold: true, color: ACCENT })], { after: 40 }),
        table(
          trace.map(
            ([k, v]) => new TableRow({ children: [cell(k, { header: true, width: 28 }), cell(v)] }),
          ),
        ),
        para(''),
      );
    body.push(
      para([run(t.responses, { bold: true, color: ACCENT })], { after: 40 }),
      table(
        [
          [t.status, t[f.responseStatus]],
          [t.owner, user(f.responseOwner)],
          [t.agreedAction, pick(f, 'agreedAction')],
          [t.target, date(f.targetDate)],
          [t.comment, f.responseComment],
          [t.issue, f.issue?.code ?? ''],
        ].map(
          ([k, v]) => new TableRow({ children: [cell(k, { header: true, width: 28 }), cell(v)] }),
        ),
      ),
    );
  }

  const doc = new Document({
    creator: input.generatedBy,
    title: `${t.title} ${e.code}`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: {
          page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                bidirectional: rtl,
                alignment: AlignmentType.CENTER,
                children: [
                  run(`${e.code} · ${t.page} `, { size: 16, color: MUTED }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: MUTED,
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...cover, ...body],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
