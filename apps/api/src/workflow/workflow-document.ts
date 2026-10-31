import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  fieldLabel,
  formatTemplateValue,
  renderTemplate,
  type DocumentTemplate,
  type FormField,
  type Locale,
} from '@processhub/shared';

export interface DocumentInput {
  template: DocumentTemplate;
  locale: Locale;
  vars: Record<string, unknown>;
  /** Display values (choice labels, user names) for placeholders and the data table. */
  display: Record<string, string>;
  fields: FormField[];
  caseNumber: string;
  processName: string;
  generatedAt: Date;
}

const FONT = 'Arial';

/**
 * "Generate document" step: a Word document from the step's template (title + paragraphs with
 * {{field}} placeholders, plain text only) and optionally a table with the case's form data. Built with
 * the existing `docx` generator; RTL paragraphs for Arabic.
 */
export async function buildCaseDocument(input: DocumentInput): Promise<Buffer> {
  const { template: t, locale, vars, display } = input;
  const rtl = locale === 'ar';
  const run = (text: string, bold = false, size?: number) =>
    new TextRun({
      text,
      rightToLeft: rtl,
      bold,
      boldComplexScript: bold,
      size,
      sizeComplexScript: size,
      font: FONT,
    });
  const para = (
    text: string,
    opts: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; bold?: boolean } = {},
  ) =>
    new Paragraph({
      children: [run(text, opts.bold)],
      heading: opts.heading,
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: 120 },
    });
  const pick = (en: string, ar: string) => (rtl ? ar || en : en || ar);
  const title =
    renderTemplate(pick(t.titleEn, t.titleAr), vars, locale, display) || input.processName;
  const body = renderTemplate(pick(t.bodyEn, t.bodyAr), vars, locale, display);
  const children: (Paragraph | Table)[] = [
    para(title, { heading: HeadingLevel.HEADING_1 }),
    para(
      `${input.caseNumber} · ${new Intl.DateTimeFormat(rtl ? 'ar' : 'en-GB', { dateStyle: 'long' }).format(input.generatedAt)}`,
    ),
    ...body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => para(l)),
  ];
  if (t.includeData) {
    const rows = input.fields
      .filter((f) => f.type !== 'info' && f.type !== 'file')
      .map((f) => [
        fieldLabel(f, locale),
        display[f.key] ?? formatTemplateValue(vars[f.key], locale),
      ]);
    if (rows.length) {
      children.push(
        para(rtl ? 'بيانات الطلب' : 'Request data', { heading: HeadingLevel.HEADING_2 }),
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          visuallyRightToLeft: rtl,
          rows: rows.map(
            ([k, v]) =>
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 35, type: WidthType.PERCENTAGE },
                    children: [para(k, { bold: true })],
                  }),
                  new TableCell({
                    width: { size: 65, type: WidthType.PERCENTAGE },
                    children: [para(v || '—')],
                  }),
                ],
              }),
          ),
        }),
      );
    }
  }
  const doc = new Document({
    creator: 'ProcessHub',
    title,
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
