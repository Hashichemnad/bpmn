import { Injectable } from '@nestjs/common';
import PptxGenJS from 'pptxgenjs';
import {
  PERMISSIONS,
  kpiRag,
  portalHiddenTypes,
  rateRisk,
  thresholdsFor,
  type Locale,
  type PptxExportInput,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GrcSettingsService } from '../grc/grc-settings.service';
import { KpiSettingsService } from '../kpi/kpi-settings.service';
import { forbidden } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import type { ReportProcess } from '../reports/report-data.service';
import { reportSteps } from '../reports/report-steps';
import { categoryText, reportTexts } from '../reports/report-i18n';
import { ExportDataService, type Branding } from './export-data.service';
import type { ExportFile } from './html-export.service';

/** Slide texts not in the handbook texts. */
const T = {
  en: {
    kpiSummary: 'KPI summary',
    riskSummary: 'Risk summary',
    valueChain: 'Value chain',
    processes: 'Processes',
    name: 'Name',
    overview: 'Overview',
    noImage: 'Diagram image not available (renderer not running).',
    kpi: 'KPI',
    target: 'Target',
    latest: 'Latest value',
    period: 'Period',
    status: 'Status',
    risk: 'Risk',
    inherent: 'Inherent',
    residual: 'Residual',
    rating: 'Rating',
    controls: 'Controls',
    linkedRisks: 'Risks and controls of the steps',
    linkedKpis: 'KPIs of the process',
    none: 'None.',
    rag: { GREEN: 'On target', AMBER: 'Watch', RED: 'Off target' },
    draft: 'DRAFT',
    page: 'continued',
  },
  ar: {
    kpiSummary: 'ملخص مؤشرات الأداء',
    riskSummary: 'ملخص المخاطر',
    valueChain: 'سلسلة القيمة',
    processes: 'العمليات',
    name: 'الاسم',
    overview: 'نظرة عامة',
    noImage: 'صورة المخطط غير متاحة (خدمة الرسم لا تعمل).',
    kpi: 'المؤشر',
    target: 'المستهدف',
    latest: 'آخر قيمة',
    period: 'الفترة',
    status: 'الحالة',
    risk: 'الخطر',
    inherent: 'المتأصل',
    residual: 'المتبقي',
    rating: 'التصنيف',
    controls: 'الضوابط',
    linkedRisks: 'مخاطر وضوابط الخطوات',
    linkedKpis: 'مؤشرات أداء العملية',
    none: 'لا يوجد.',
    rag: { GREEN: 'ضمن المستهدف', AMBER: 'تحت المراقبة', RED: 'خارج المستهدف' },
    draft: 'مسودة',
    page: 'تابع',
  },
};

const W = 13.333; // LAYOUT_WIDE, inches
const H = 7.5;
const ROWS_PER_SLIDE = 10;
const RAG_COLOUR = { GREEN: '2E7D32', AMBER: 'B28704', RED: 'C62828' } as const;

const hex = (c: string) => c.replace('#', '').toUpperCase();
const fmt = (d: Date | null, l: Locale) =>
  d ? new Intl.DateTimeFormat(l === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium' }).format(d) : '—';
const name = (
  o: { nameEn?: string | null; nameAr?: string | null } | null | undefined,
  l: Locale,
) => (l === 'ar' ? o?.nameAr || o?.nameEn : o?.nameEn || o?.nameAr) || '';
const userName = (u: UserRef | null | undefined, l: Locale) => (u ? name(u, l) || u.email : '—');
const chunk = <X>(list: X[], n: number): X[][] =>
  list.length
    ? Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))
    : [[]];

type Cell = { text: string; options?: Record<string, unknown> };

/**
 * PowerPoint export (Phase 4.4, D-178) with `pptxgenjs`: a process, a value chain, or a KPI / risk
 * summary. Branded master (Settings → Branding: logo, organisation, export colours), title slide,
 * diagram image from the renderer, step table split over slides, governance facts, KPIs and risks.
 * Arabic decks are right to left (paragraph direction, right alignment, mirrored table columns).
 * Same visibility as the screens; audited (EXPORT).
 */
@Injectable()
export class PptxExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly data: ExportDataService,
    private readonly grcSettings: GrcSettingsService,
    private readonly kpiSettings: KpiSettingsService,
  ) {}

  async export(input: PptxExportInput, user: AuthUser, meta: RequestMeta): Promise<ExportFile> {
    const l = input.locale;
    const branding = await this.data.branding();
    const deck = new Deck(branding, l, input.drafts);
    let title = '';
    // ASCII file names (codes): browsers and mail gateways handle them everywhere.
    let fileBase = 'export';
    let entityType: 'Process' | 'Diagram' | 'Kpi' | 'Risk' = 'Process';
    let entityId = input.id ?? 'summary';

    if (input.scope === 'PROCESS') {
      const [p] = await this.data.processes(input.id!, false, user, input.drafts);
      title = `${p.code} ${name(p, l)}`;
      fileBase = p.code;
      deck.titleSlide(title, categoryText(l, p.category));
      await this.processSlides(deck, p, l, user);
    } else if (input.scope === 'VALUE_CHAIN') {
      entityType = 'Diagram';
      const vc = await this.data.valueChain(input.id!, user, input.drafts);
      title = name(vc.diagram, l);
      fileBase = vc.diagram.code;
      deck.titleSlide(title, T[l].valueChain);
      const img = await this.data.graphImage(vc.content, l, 'png', branding.theme, 2400);
      deck.imageSlide(T[l].valueChain, img);
      const t = reportTexts(l);
      deck.tableSlides(
        T[l].processes,
        [t.code, T[l].name, t.owner, t.version, t.approvedAt],
        vc.processes.map((p) => [
          p.code,
          name(p, l),
          userName(p.owner, l),
          p.versionNumber ? String(p.versionNumber) : '—',
          fmt(p.approvedAt, l),
        ]),
        [1.4, 5, 2.6, 1.2, 2],
      );
    } else if (input.scope === 'KPI_SUMMARY') {
      if (!user.permissions.has(PERMISSIONS.KPI_READ)) throw forbidden();
      entityType = 'Kpi';
      title = T[l].kpiSummary;
      fileBase = 'KPI_summary';
      deck.titleSlide(title, fmt(new Date(), l));
      await this.kpiSlides(deck, l, input.id);
    } else {
      if (!user.permissions.has(PERMISSIONS.GRC_READ)) throw forbidden();
      entityType = 'Risk';
      title = T[l].riskSummary;
      fileBase = 'Risk_summary';
      deck.titleSlide(title, fmt(new Date(), l));
      await this.riskSlides(deck, l, input.id);
    }
    if (!input.id) entityId = input.scope;
    const data = await deck.write();
    await this.audit.log({
      action: 'EXPORT',
      entityType,
      entityId,
      userId: user.id,
      summary: { format: 'pptx', scope: input.scope, locale: l, drafts: input.drafts },
      meta,
    });
    const file = fileBase.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'export';
    return {
      fileName: `${file}${input.drafts ? '_DRAFT' : ''}_${l}.pptx`,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      data,
    };
  }

  private async processSlides(deck: Deck, p: ReportProcess, l: Locale, user: AuthUser) {
    const t = reportTexts(l);
    const img = await this.data.bpmnImage(p.bpmnXml, l, 'png', 2400);
    deck.imageSlide(t.diagram, img);
    const version = p.versionNumber
      ? `${p.versionNumber}${p.versionLabel ? ` (${p.versionLabel})` : ''}`
      : '—';
    deck.factsSlide(t.details, [
      [t.code, p.code],
      [t.category, categoryText(l, p.category)],
      [t.owner, userName(p.owner, l)],
      [t.department, name(p.department, l) || '—'],
      [t.version, version],
      [t.approvedAt, fmt(p.approvedAt, l)],
      [t.approvedBy, p.approvedBy.map((u) => userName(u, l)).join(l === 'ar' ? '، ' : ', ') || '—'],
      [t.publishedAt, fmt(p.publishedAt, l)],
      [
        t.description,
        (l === 'ar' ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr) ||
          '—',
      ],
    ]);
    const steps = reportSteps(p, l);
    deck.tableSlides(
      t.steps,
      ['#', t.step, t.role, t.system, t.documents],
      steps.map((s, i) => [
        String(i + 1),
        s.name,
        s.roles.join(', '),
        s.systems.join(', '),
        s.documents.join(', '),
      ]),
      [0.6, 4.6, 2.8, 2.2, 2.4],
    );
    // Risks / controls / KPIs linked to the process and its steps — as the portal shows them
    // (SEC-34): readers without Risk & Compliance / KPI rights see only what Settings → Risk &
    // Compliance and Settings → KPIs show in the portal (default: none, D-092, D-113).
    const hidden: string[] = user.permissions.has(PERMISSIONS.GRC_READ)
      ? []
      : [...portalHiddenTypes((await this.grcSettings.get()).portalVisibility)];
    if (!user.permissions.has(PERMISSIONS.KPI_READ) && !(await this.kpiSettings.get()).showInPortal)
      hidden.push('KPI');
    const links = p.links.filter((x) => !hidden.includes(x.object.type));
    const grc = links.filter((x) => x.object.type === 'RISK' || x.object.type === 'CONTROL');
    const objects = [...new Map(grc.map((x) => [x.object.id, x.object])).values()];
    deck.tableSlides(
      T[l].linkedRisks,
      [t.type, t.code, T[l].name],
      objects.map((o) => [o.type === 'RISK' ? T[l].risk : T[l].controls, o.code ?? '', name(o, l)]),
      [2, 2, 8.6],
    );
    const kpiIds = [
      ...new Set(links.filter((x) => x.object.type === 'KPI').map((x) => x.object.id)),
    ];
    if (kpiIds.length) await this.kpiSlides(deck, l, undefined, kpiIds, T[l].linkedKpis);
  }

  private async kpiSlides(
    deck: Deck,
    l: Locale,
    departmentId?: string,
    ids?: string[],
    heading?: string,
  ) {
    const kpis = await this.prisma.kpi.findMany({
      where: {
        status: 'ACTIVE',
        object: { deletedAt: null },
        ...(departmentId ? { departmentId } : {}),
        ...(ids ? { objectId: { in: ids } } : {}),
      },
      include: {
        object: true,
        periodTargets: true,
        measurements: { orderBy: { periodStart: 'desc' }, take: 1 },
      },
      orderBy: { object: { code: 'asc' } },
    });
    const t = T[l];
    const rows = kpis.map((k) => {
      const m = k.measurements[0];
      const th = m ? thresholdsFor(k, m.period, k.periodTargets) : k;
      const rag = m ? kpiRag(m.value, th) : null;
      const unit = k.unit ? ` ${k.unit}` : '';
      return {
        cells: [
          k.object.code ?? '',
          name(k.object, l),
          th.target !== null ? `${th.target}${unit}` : '—',
          m ? `${m.value}${unit}` : '—',
          m?.period ?? '—',
          rag ? t.rag[rag] : '—',
        ],
        colour: rag ? RAG_COLOUR[rag] : null,
      };
    });
    deck.tableSlides(
      heading ?? t.kpiSummary,
      [reportTexts(l).code, t.kpi, t.target, t.latest, t.period, t.status],
      rows.map((r) => r.cells),
      [1.4, 4.6, 1.6, 1.6, 1.4, 2],
      rows.map((r) => (r.colour ? { 5: r.colour } : {})),
    );
  }

  private async riskSlides(deck: Deck, l: Locale, departmentId?: string) {
    const settings = await this.grcSettings.get();
    const risks = await this.prisma.risk.findMany({
      where: {
        status: 'ACTIVE',
        object: { deletedAt: null },
        ...(departmentId ? { departmentId } : {}),
      },
      include: { object: true, _count: { select: { controls: true } } },
    });
    const rated = risks
      .map((r) => ({ r, rating: rateRisk(r, settings.bands) }))
      .sort(
        (a, b) =>
          b.rating.residualScore - a.rating.residualScore ||
          b.rating.inherentScore - a.rating.inherentScore,
      );
    const band = (key: string | null) => settings.bands.find((b) => b.key === key);
    const t = T[l];
    // Overview: risks per residual band.
    deck.factsSlide(
      t.overview,
      settings.bands
        .slice()
        .reverse()
        .map((b) => [
          name(b, l),
          String(rated.filter((x) => x.rating.residualBand === b.key).length),
        ]),
    );
    deck.tableSlides(
      t.riskSummary,
      [reportTexts(l).code, t.risk, t.inherent, t.residual, t.rating, t.controls],
      rated.map(({ r, rating }) => [
        r.object.code ?? '',
        name(r.object, l),
        String(rating.inherentScore),
        String(rating.residualScore),
        name(band(rating.residualBand), l) || '—',
        String(r._count.controls),
      ]),
      [1.4, 5.4, 1.3, 1.3, 2, 1.2],
      rated.map(({ rating }) => {
        const b = band(rating.residualBand);
        return b ? { 4: hex(b.colour) } : {};
      }),
    );
  }
}

/** A branded deck: master slide, RTL handling, slide helpers. */
class Deck {
  private readonly pptx = new PptxGenJS();
  private readonly rtl: boolean;
  private readonly primary: string;
  private readonly accent: string;
  private readonly font = 'Segoe UI';

  constructor(
    private readonly b: Branding,
    private readonly l: Locale,
    private readonly draft: boolean,
  ) {
    this.rtl = l === 'ar';
    this.primary = hex(b.template.primaryColor);
    this.accent = hex(b.template.accentColor);
    this.pptx.layout = 'LAYOUT_WIDE';
    this.pptx.rtlMode = this.rtl;
    this.pptx.author = 'ProcessHub';
    this.pptx.company = name({ nameEn: b.orgNameEn, nameAr: b.orgNameAr }, l) || 'ProcessHub';
    const logo = this.logoData();
    this.pptx.defineSlideMaster({
      title: 'PH',
      background: { color: 'FFFFFF' },
      objects: [
        { rect: { x: 0, y: 0, w: W, h: 0.12, fill: { color: this.primary } } },
        { rect: { x: 0, y: H - 0.08, w: W, h: 0.08, fill: { color: this.accent } } },
        ...(logo && b.template.logoOnEverySlide
          ? [
              {
                image: {
                  data: logo,
                  x: this.rtl ? 0.3 : W - 1.5,
                  y: 0.25,
                  w: 1.2,
                  h: 0.6,
                  sizing: { type: 'contain' as const, w: 1.2, h: 0.6 },
                },
              },
            ]
          : []),
        ...(draft
          ? [
              {
                text: {
                  text: T[l].draft,
                  options: {
                    x: W / 2 - 2,
                    y: 0.2,
                    w: 4,
                    h: 0.5,
                    fontSize: 20,
                    bold: true,
                    color: 'C62828',
                    align: 'center' as const,
                    fontFace: this.font,
                  },
                },
              },
            ]
          : []),
      ],
      slideNumber: { x: this.rtl ? 0.3 : W - 0.8, y: H - 0.45, fontSize: 10, color: '5B6571' },
    });
  }

  private logoData(): string | null {
    if (!this.b.logo) return null;
    return `${this.b.logo.contentType};base64,${this.b.logo.data.toString('base64')}`;
  }

  private text(extra: Record<string, unknown> = {}) {
    return {
      fontFace: this.font,
      rtlMode: this.rtl,
      align: (this.rtl ? 'right' : 'left') as 'right' | 'left',
      color: '1F2933',
      ...extra,
    };
  }

  private heading(slide: PptxGenJS.Slide, title: string) {
    slide.addText(
      title,
      this.text({
        x: 0.5,
        y: 0.3,
        w: W - 2.4,
        h: 0.7,
        fontSize: 24,
        bold: true,
        color: this.primary,
        ...(this.rtl ? { x: 1.9 } : {}),
      }),
    );
  }

  titleSlide(title: string, subtitle: string) {
    const s = this.pptx.addSlide();
    s.background = { color: this.primary };
    const logo = this.logoData();
    if (logo)
      s.addImage({
        data: logo,
        x: this.rtl ? W - 2.6 : 0.6,
        y: 0.6,
        w: 2,
        h: 1,
        sizing: { type: 'contain', w: 2, h: 1 },
      });
    const org = name({ nameEn: this.b.orgNameEn, nameAr: this.b.orgNameAr }, this.l);
    s.addText(
      title,
      this.text({ x: 0.6, y: 2.6, w: W - 1.2, h: 1.4, fontSize: 36, bold: true, color: 'FFFFFF' }),
    );
    s.addText(
      subtitle,
      this.text({ x: 0.6, y: 4.0, w: W - 1.2, h: 0.6, fontSize: 18, color: 'FFFFFF' }),
    );
    s.addText(
      [org, fmt(new Date(), this.l), this.draft ? T[this.l].draft : ''].filter(Boolean).join(' · '),
      this.text({ x: 0.6, y: H - 1.2, w: W - 1.2, h: 0.5, fontSize: 12, color: 'E6ECF2' }),
    );
  }

  imageSlide(title: string, img: { data: Buffer; width: number; height: number } | null) {
    const s = this.pptx.addSlide({ masterName: 'PH' });
    this.heading(s, title);
    if (!img || !img.width || !img.height) {
      s.addText(
        T[this.l].noImage,
        this.text({ x: 0.5, y: 3, w: W - 1, h: 0.6, fontSize: 14, color: '5B6571' }),
      );
      return;
    }
    const boxW = W - 1;
    const boxH = H - 1.6;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    s.addImage({
      data: `image/png;base64,${img.data.toString('base64')}`,
      x: 0.5 + (boxW - w) / 2,
      y: 1.15 + (boxH - h) / 2,
      w,
      h,
    });
  }

  factsSlide(title: string, facts: string[][]) {
    const s = this.pptx.addSlide({ masterName: 'PH' });
    this.heading(s, title);
    const rows = facts.map(([k, v]) =>
      this.row([{ text: k, options: { bold: true, color: '5B6571' } }, { text: v }]),
    );
    s.addTable(rows, {
      x: 0.5,
      y: 1.2,
      w: W - 1,
      colW: this.cols([3.4, W - 4.4]),
      fontSize: 13,
      fontFace: this.font,
      border: { type: 'solid', pt: 0.5, color: 'DFE3E8' },
      valign: 'top',
    });
  }

  /** A table split over as many slides as needed (header repeated). */
  tableSlides(
    title: string,
    header: string[],
    rows: string[][],
    colW: number[],
    fills: Partial<Record<number, string>>[] = [],
  ) {
    const pages = chunk(rows, ROWS_PER_SLIDE);
    pages.forEach((page, i) => {
      const s = this.pptx.addSlide({ masterName: 'PH' });
      this.heading(s, i ? `${title} (${T[this.l].page} ${i + 1}/${pages.length})` : title);
      if (!page.length) {
        s.addText(
          T[this.l].none,
          this.text({ x: 0.5, y: 1.4, w: W - 1, h: 0.5, fontSize: 14, color: '5B6571' }),
        );
        return;
      }
      const head = this.row(
        header.map((h) => ({
          text: h,
          options: { bold: true, color: 'FFFFFF', fill: { color: this.primary } },
        })),
      );
      const body = page.map((r, j) => {
        const fill = fills[i * ROWS_PER_SLIDE + j] ?? {};
        return this.row(
          r.map((c, k) => ({
            text: c,
            options: fill[k] ? { color: 'FFFFFF', bold: true, fill: { color: fill[k] } } : {},
          })),
        );
      });
      s.addTable([head, ...body], {
        x: 0.5,
        y: 1.2,
        w: W - 1,
        colW: this.cols(colW),
        fontSize: 11,
        fontFace: this.font,
        border: { type: 'solid', pt: 0.5, color: 'DFE3E8' },
        valign: 'top',
        autoPage: false,
      });
    });
  }

  /** Cells with direction and alignment; Arabic tables mirror the column order. */
  private row(cells: Cell[]): PptxGenJS.TableRow {
    const out = cells.map((c) => ({
      text: c.text,
      options: {
        rtlMode: this.rtl,
        align: (this.rtl ? 'right' : 'left') as 'right' | 'left',
        ...c.options,
      },
    }));
    return this.rtl ? out.reverse() : out;
  }

  private cols(widths: number[]): number[] {
    const total = widths.reduce((a, b) => a + b, 0);
    const scaled = widths.map((w) => (w * (W - 1)) / total);
    return this.rtl ? scaled.reverse() : scaled;
  }

  async write(): Promise<Buffer> {
    return (await this.pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  }
}
