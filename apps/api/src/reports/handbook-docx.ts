import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import type { Locale, ReportSource } from '@processhub/shared';
import {
  categoryText,
  fill,
  minutesText,
  pick,
  reportTexts,
  statusText,
  stepTypeText,
} from './report-i18n';
import type { ReportProcess } from './report-data.service';
import { reportSteps, type ReportStep } from './report-steps';

/** A raster image with its pixel size (diagram PNGs from the browser, the organisation logo). */
export interface ReportImage {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

export interface HandbookInput {
  locale: Locale;
  source: ReportSource;
  orgName: string;
  /** Root process of the branch (title on the cover). */
  root: Pick<ReportProcess, 'code' | 'nameEn' | 'nameAr'>;
  processes: ReportProcess[];
  diagrams: Map<string, ReportImage>;
  logo: ReportImage | null;
  generatedBy: string;
  generatedAt: Date;
}

const FONT = 'Arial';
const ACCENT = '1F4E79';
const MUTED = '64748B';
const HEADER_FILL = 'E8EEF6';

/** Landscape A4 body: 29.7 cm − 2 × 1.8 cm margins ≈ 26.1 cm ≈ 985 px at 96 dpi. */
const BODY_WIDTH_PX = 980;
const DIAGRAM_MAX_HEIGHT_PX = 520;
const MARGIN = 1020; // twips (1.8 cm)

/** Fits an image into a box, keeping its proportions. */
export function fitImage(img: { width: number; height: number }, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  return { width: Math.round(img.width * scale), height: Math.round(img.height * scale) };
}

/**
 * Process handbook (Word .docx) for one process or a branch of the process house (D-087): cover
 * with logo, table of contents, then per process: description, details with version and approval
 * data, diagram, step table with roles, IT systems and step attributes, linked documents and the
 * text of linked SOP pages. The Arabic handbook is right-to-left throughout (paragraphs, runs and
 * tables).
 */
export async function buildHandbook(input: HandbookInput): Promise<Buffer> {
  const { locale } = input;
  const t = reportTexts(locale);
  const rtl = locale === 'ar';
  const date = (d: Date) =>
    new Intl.DateTimeFormat(rtl ? 'ar' : 'en-GB', { dateStyle: 'long' }).format(d);

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
      spacingAfter?: number;
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
      spacing: { after: opts.spacingAfter ?? 120 },
    });
  /** Text with line breaks: one paragraph per line. */
  const paras = (text: string) =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => para(l));

  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (content: string | Paragraph[], opts: { header?: boolean; width?: number } = {}) =>
    new TableCell({
      children:
        typeof content === 'string'
          ? [para([run(content || t.none, { bold: opts.header, size: 18 })], { spacingAfter: 0 })]
          : content,
      shading: opts.header
        ? { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_FILL }
        : undefined,
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      borders,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });
  const table = (rows: TableRow[]) =>
    new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: rtl,
    });

  // ----- Cover and contents -----
  const cover: Paragraph[] = [];
  if (input.logo) {
    const size = fitImage(input.logo, 220, 110);
    cover.push(
      new Paragraph({
        children: [
          new ImageRun({ type: input.logo.type, data: input.logo.data, transformation: size }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 1200, after: 600 },
      }),
    );
  }
  cover.push(
    para([run(input.orgName, { size: 28, color: MUTED })], {
      align: AlignmentType.CENTER,
      spacingAfter: 600,
    }),
    para([run(t.handbookTitle, { bold: true, size: 56, color: ACCENT })], {
      align: AlignmentType.CENTER,
      spacingAfter: 240,
    }),
    para([run(`${input.root.code} · ${pick(locale, input.root)}`, { size: 36 })], {
      align: AlignmentType.CENTER,
      spacingAfter: 600,
    }),
    para(
      [
        run(input.source === 'published' ? t.sourcePublished : t.sourceWorking, {
          size: 22,
          color: MUTED,
        }),
      ],
      { align: AlignmentType.CENTER },
    ),
    para(
      [
        run(fill(t.generatedOn, { date: date(input.generatedAt), user: input.generatedBy }), {
          size: 20,
          color: MUTED,
        }),
      ],
      { align: AlignmentType.CENTER },
    ),
    para([run(t.contents, { bold: true, size: 32, color: ACCENT })], { pageBreakBefore: true }),
  );
  const toc = new TableOfContents(t.contents, { hyperlink: true, headingStyleRange: '1-1' });

  // ----- One section per process -----
  const attributeLines = (s: ReportStep): string[] => {
    const a = s.attributes;
    const lines: string[] = [];
    if (a.durationMinutes !== undefined)
      lines.push(`${t.processing}: ${minutesText(locale, a.durationMinutes)}`);
    if (a.waitingMinutes !== undefined)
      lines.push(`${t.waiting}: ${minutesText(locale, a.waitingMinutes)}`);
    if (a.slaMinutes !== undefined) lines.push(`${t.sla}: ${minutesText(locale, a.slaMinutes)}`);
    if (a.frequencyPerMonth !== undefined)
      lines.push(`${t.frequency}: ${fill(t.perMonth, { n: a.frequencyPerMonth })}`);
    if (a.costPerExecution !== undefined)
      lines.push(
        `${t.cost}: ${new Intl.NumberFormat(rtl ? 'ar' : 'en').format(a.costPerExecution)}`,
      );
    const inputs = rtl ? a.inputsAr || a.inputsEn : a.inputsEn || a.inputsAr;
    const outputs = rtl ? a.outputsAr || a.outputsEn : a.outputsEn || a.outputsAr;
    if (inputs) lines.push(`${t.inputs}: ${inputs}`);
    if (outputs) lines.push(`${t.outputs}: ${outputs}`);
    return lines;
  };
  const lines = (items: string[]) =>
    (items.length ? items : [t.none]).map((l) => para([run(l, { size: 18 })], { spacingAfter: 0 }));

  const processSection = (p: ReportProcess): ISectionOptions => {
    const description = rtl
      ? p.descriptionAr || p.descriptionEn
      : p.descriptionEn || p.descriptionAr;
    const details: [string, string][] = [
      [t.code, p.code],
      [t.category, categoryText(locale, p.category)],
      [t.status, statusText(locale, p.status)],
      [t.owner, p.owner ? pick(locale, p.owner) || p.owner.email : ''],
      [t.department, pick(locale, p.department)],
      [t.version, p.versionNumber ? `v${p.versionNumber}` : ''],
      [t.versionLabel, p.versionLabel ?? ''],
      [t.approvedAt, p.approvedAt ? date(p.approvedAt) : ''],
      [t.approvedBy, p.approvedBy.map((u) => pick(locale, u) || u.email).join(', ')],
      [t.publishedAt, p.publishedAt ? date(p.publishedAt) : ''],
    ];
    const diagram = input.diagrams.get(p.id);
    const steps = reportSteps(p, locale);
    const documents = [
      ...new Set(
        p.links.filter((l) => l.object.type === 'DOCUMENT').map((l) => pick(locale, l.object)),
      ),
    ].filter(Boolean);

    const children: (Paragraph | Table)[] = [
      para([run(`${p.code}  ${pick(locale, p)}`)], { heading: HeadingLevel.HEADING_1 }),
      para([run(t.description, { bold: true })], { heading: HeadingLevel.HEADING_2 }),
      ...(description ? paras(description) : [para([run(t.noDescription, { color: MUTED })])]),
      para([run(t.details, { bold: true })], { heading: HeadingLevel.HEADING_2 }),
      table(
        details.map(
          ([k, v]) =>
            new TableRow({
              children: [cell(k, { header: true, width: 28 }), cell(v, { width: 72 })],
            }),
        ),
      ),
      para([run(t.diagram, { bold: true })], {
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: !!diagram,
      }),
      diagram
        ? new Paragraph({
            // An image needs an "auto" line height, or it is clipped to one line.
            spacing: { line: 240, lineRule: LineRuleType.AUTO, after: 120 },
            children: [
              new ImageRun({
                type: diagram.type,
                data: diagram.data,
                transformation: fitImage(diagram, BODY_WIDTH_PX, DIAGRAM_MAX_HEIGHT_PX),
              }),
            ],
            alignment: AlignmentType.CENTER,
          })
        : para([run(t.noDiagram, { color: MUTED })]),
      para([run(t.steps, { bold: true })], { heading: HeadingLevel.HEADING_2 }),
    ];
    if (steps.length)
      children.push(
        table([
          new TableRow({
            tableHeader: true,
            children: [
              cell('#', { header: true, width: 4 }),
              cell(t.step, { header: true, width: 18 }),
              cell(t.type, { header: true, width: 9 }),
              cell(t.role, { header: true, width: 13 }),
              cell(t.system, { header: true, width: 12 }),
              cell(t.description, { header: true, width: 26 }),
              cell(t.attributes, { header: true, width: 18 }),
            ],
          }),
          ...steps.map(
            (s, i) =>
              new TableRow({
                children: [
                  cell(String(i + 1)),
                  cell(s.name),
                  cell(stepTypeText(locale, s.type)),
                  cell(s.roles.join(', ')),
                  cell(s.systems.join(', ')),
                  cell(s.description ? paras(s.description).map((x) => x) : t.none),
                  cell(lines(attributeLines(s))),
                ],
              }),
          ),
        ]),
      );
    else children.push(para([run(t.none, { color: MUTED })]));
    children.push(
      para([run(t.documents, { bold: true })], { heading: HeadingLevel.HEADING_2 }),
      ...(documents.length
        ? documents.map(
            (d) => new Paragraph({ children: [run(d)], bidirectional: rtl, bullet: { level: 0 } }),
          )
        : [para([run(t.noDocuments, { color: MUTED })])]),
    );
    if (p.pages.length) {
      children.push(para([run(t.procedures, { bold: true })], { heading: HeadingLevel.HEADING_2 }));
      for (const page of p.pages) {
        children.push(
          para(
            [
              run(rtl ? page.titleAr || page.titleEn : page.titleEn || page.titleAr, {
                bold: true,
              }),
            ],
            {
              heading: HeadingLevel.HEADING_3,
            },
          ),
          ...paras(rtl ? page.textAr || page.textEn : page.textEn || page.textAr),
        );
      }
    }
    return {
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      footers: { default: footer },
      children,
    };
  };

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: rtl,
        children: [
          new TextRun({
            children: [t.pageBefore, PageNumber.CURRENT, t.pageOf, PageNumber.TOTAL_PAGES],
            rightToLeft: rtl,
            size: 16,
            color: MUTED,
            font: FONT,
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: input.orgName,
    title: `${t.handbookTitle} — ${input.root.code} ${pick(locale, input.root)}`,
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 } },
        heading1: { run: { font: FONT, size: 34, bold: true, color: ACCENT } },
        heading2: { run: { font: FONT, size: 26, bold: true, color: ACCENT } },
        heading3: { run: { font: FONT, size: 22, bold: true } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } },
        },
        footers: { default: footer },
        children: [...cover, toc],
      },
      ...input.processes.map(processSection),
    ],
  });
  return Packer.toBuffer(doc);
}

/** Pixel size of a PNG (IHDR) or JPEG (SOF marker); null when the data is neither. */
export function imageInfo(data: Buffer): ReportImage | null {
  if (
    data.length > 24 &&
    data.readUInt32BE(0) === 0x89504e47 &&
    data.toString('ascii', 12, 16) === 'IHDR'
  )
    return { data, type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return {
          data,
          type: 'jpg',
          height: data.readUInt16BE(i + 5),
          width: data.readUInt16BE(i + 7),
        };
      i += 2 + len;
    }
  }
  return null;
}
