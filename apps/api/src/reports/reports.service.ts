import { GrcSettingsService } from '../grc/grc-settings.service';
import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  SETTING_KEYS,
  extractBpmnLabels,
  isGrcObjectType,
  portalHiddenTypes,
  rateRisk,
  type HandbookInput,
  type HandbookPlanDto,
  type HandbookPlanInput,
  type Locale,
  type ProcessStatus,
  type ReportQuery,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ObjectsService } from '../objects/objects.service';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ReportDataService, type ReportProcess } from './report-data.service';
import {
  buildHandbook,
  imageInfo,
  type HandbookGrcRow,
  type HandbookSystemRow,
  type ReportImage,
} from './handbook-docx';
import { buildObjectReport, buildRaci } from './xlsx-reports';
import { pick, reportTexts } from './report-i18n';

export interface ReportFile {
  data: Buffer;
  fileName: string;
  contentType: string;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/** File names without characters that file systems or headers do not accept. */
const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .trim()
    .slice(0, 120);

/**
 * Reports and exports (Modeler design B2, D-087): process handbook (.docx), RACI (.xlsx) and
 * object "where used" reports (.xlsx). Content follows the user's permissions (Viewers: published
 * versions only, as in the portal); every download is audited (EXPORT).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly objects: ObjectsService,
    private readonly data: ReportDataService,
    private readonly grcSettings: GrcSettingsService,
  ) {}

  /**
   * Rows of the handbook's "Risks and controls" section: GRC readers see every linked item; others
   * (portal) only what Settings → Risk & Compliance shows in the portal.
   */
  private async grcRows(processes: ReportProcess[], user: AuthUser, locale: Locale) {
    const settings = await this.grcSettings.get();
    const hidden = user.permissions.has(PERMISSIONS.GRC_READ)
      ? []
      : portalHiddenTypes(settings.portalVisibility);
    const t = reportTexts(locale);
    const links = processes.flatMap((p) =>
      p.links
        .filter((l) => isGrcObjectType(l.object.type) && !hidden.includes(l.object.type as never))
        .map((l) => ({ p, l })),
    );
    const details = await this.prisma.repoObject.findMany({
      where: { id: { in: [...new Set(links.map((x) => x.l.object.id))] }, deletedAt: null },
      include: { risk: true, control: true },
    });
    const byId = new Map(details.map((d) => [d.id, d]));
    const out = new Map<string, HandbookGrcRow[]>();
    for (const p of processes) out.set(p.id, []);
    const labels = new Map(processes.map((p) => [p.id, extractBpmnLabels(p.bpmnXml ?? '')]));
    for (const { p, l } of links) {
      const d = byId.get(l.object.id);
      if (!d) continue;
      const label = labels.get(p.id)?.get(l.bpmnElementId);
      let detail = '';
      if (d.risk) {
        const r = rateRisk(d.risk, settings.bands);
        const band = settings.bands.find((b) => b.key === r.residualBand);
        detail = `${band ? (locale === 'ar' ? band.nameAr : band.nameEn) : ''} · ${r.residualScore}`;
      } else if (d.control) detail = t.effectiveness[d.control.effectiveness] ?? '';
      out.get(p.id)!.push({
        step:
          l.bpmnElementId === PROCESS_ELEMENT_ID
            ? t.wholeProcess
            : (label && pick(locale, label)) || l.bpmnElementId,
        type: t.grcTypes[d.type] ?? d.type,
        item: `${d.code ? `${d.code} ` : ''}${pick(locale, d)}`,
        detail,
      });
    }
    const order = { RISK: 0, CONTROL: 1, REQUIREMENT: 2 } as Record<string, number>;
    for (const rows of out.values())
      rows.sort(
        (a, b) =>
          a.step.localeCompare(b.step) ||
          (order[a.type] ?? 0) - (order[b.type] ?? 0) ||
          a.item.localeCompare(b.item),
      );
    return out;
  }

  /** Rows of the handbook's "Systems and data" section: applications on the steps of each process. */
  private async systemRows(processes: ReportProcess[], locale: Locale) {
    const t = reportTexts(locale);
    const ids = [
      ...new Set(
        processes.flatMap((p) =>
          p.links.filter((l) => l.object.type === 'SYSTEM').map((l) => l.object.id),
        ),
      ),
    ];
    const apps = await this.prisma.application.findMany({
      where: { objectId: { in: ids }, object: { deletedAt: null } },
      include: {
        dataUsages: { where: { dataObject: { deletedAt: null } }, include: { dataObject: true } },
        recordOf: { where: { deletedAt: null } },
      },
    });
    const byId = new Map(apps.map((a) => [a.objectId, a]));
    const out = new Map<string, HandbookSystemRow[]>();
    for (const p of processes) {
      const labels = extractBpmnLabels(p.bpmnXml ?? '');
      const perApp = new Map<string, { name: string; steps: string[] }>();
      for (const l of p.links) {
        if (l.object.type !== 'SYSTEM') continue;
        const entry = perApp.get(l.object.id) ?? {
          name: `${l.object.code ? `${l.object.code} ` : ''}${pick(locale, l.object)}`,
          steps: [],
        };
        const label = labels.get(l.bpmnElementId);
        const step =
          l.bpmnElementId === PROCESS_ELEMENT_ID
            ? t.wholeProcess
            : (label && pick(locale, label)) || l.bpmnElementId;
        if (!entry.steps.includes(step)) entry.steps.push(step);
        perApp.set(l.object.id, entry);
      }
      out.set(
        p.id,
        [...perApp.entries()]
          .map(([id, e]) => {
            const a = byId.get(id);
            const data = new Map<string, string>();
            for (const r of a?.recordOf ?? []) data.set(r.id, `${pick(locale, r)} ★`);
            for (const u of a?.dataUsages ?? []) {
              const flags = `${u.canCreate ? 'C' : ''}${u.canRead ? 'R' : ''}${u.canUpdate ? 'U' : ''}${u.canDelete ? 'D' : ''}`;
              data.set(
                u.dataObjectId,
                `${pick(locale, u.dataObject)} (${flags})${data.has(u.dataObjectId) ? ' ★' : ''}`,
              );
            }
            return {
              application: e.name,
              lifecycle: a ? (t.lifecycles[a.lifecycle] ?? a.lifecycle) : '',
              steps: e.steps.join(', '),
              dataObjects: [...data.values()].join('; '),
            };
          })
          .sort((x, y) => x.application.localeCompare(y.application)),
      );
    }
    return out;
  }

  /** The processes of a handbook and the diagram XML the browser renders as images. */
  async handbookPlan(input: HandbookPlanInput, user: AuthUser): Promise<HandbookPlanDto> {
    const source = this.data.sourceFor(user, input.source);
    const processes = await this.data.collect(input.processId, input.includeChildren, user, source);
    return {
      source,
      processes: processes.map((p) => ({
        id: p.id,
        code: p.code,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        bpmnXml: p.bpmnXml,
      })),
    };
  }

  async handbook(input: HandbookInput, user: AuthUser, meta: RequestMeta): Promise<ReportFile> {
    const source = this.data.sourceFor(user, input.source);
    const processes = await this.data.collect(input.processId, input.includeChildren, user, source);
    const ids = new Set(processes.map((p) => p.id));
    const diagrams = new Map<string, ReportImage>();
    for (const img of input.images) {
      if (!ids.has(img.processId)) continue;
      const info = imageInfo(Buffer.from(img.png, 'base64'));
      if (!info || info.type !== 'png' || info.width > 20_000 || info.height > 20_000)
        throw badRequest('INVALID_IMAGE');
      diagrams.set(img.processId, info);
    }
    const [settings, logo] = await Promise.all([this.orgSettings(), this.logo()]);
    const root = processes[0];
    const locale = input.locale;
    const data = await buildHandbook({
      locale,
      source,
      orgName: pick(locale, { nameEn: settings.nameEn, nameAr: settings.nameAr }) || 'ProcessHub',
      root,
      processes,
      diagrams,
      logo,
      generatedBy: pick(locale, user) || user.email,
      generatedAt: new Date(),
      grc: input.includeRisks ? await this.grcRows(processes, user, locale) : undefined,
      systems:
        input.includeSystems && user.permissions.has(PERMISSIONS.EA_READ)
          ? await this.systemRows(processes, locale)
          : undefined,
    });
    await this.logExport('handbook', root.id, user, meta, {
      source,
      locale,
      includeChildren: input.includeChildren,
      ...(input.includeRisks ? { includeRisks: true } : {}),
      ...(input.includeSystems ? { includeSystems: true } : {}),
      processes: processes.map((p) => p.code),
    });
    return {
      data,
      contentType: DOCX,
      fileName: safeName(
        `${root.code} ${pick(locale, root)} - ${reportTexts(locale).handbookTitle}.docx`,
      ),
    };
  }

  async raci(
    processId: string,
    q: ReportQuery,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<ReportFile> {
    const source = this.data.sourceFor(user, q.source);
    const [p] = await this.data.collect(processId, false, user, source);
    const data = await buildRaci([p], q.locale);
    await this.logExport('raci', p.id, user, meta, { source, locale: q.locale });
    return {
      data,
      contentType: XLSX,
      fileName: safeName(`${p.code} ${pick(q.locale, p)} - RACI.xlsx`),
    };
  }

  async objectReport(
    id: string,
    locale: Locale,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<ReportFile> {
    const object = await this.objects.get(id);
    const usage = await this.objects.usage(id);
    const statuses = new Map(
      (
        await this.prisma.process.findMany({
          where: { id: { in: [...new Set(usage.map((u) => u.process.id))] } },
          select: { id: true, status: true },
        })
      ).map((p) => [p.id, p.status as ProcessStatus]),
    );
    const data = await buildObjectReport(
      object,
      usage.map((u) => ({
        process: { ...u.process, status: statuses.get(u.process.id) ?? 'DRAFT' },
        bpmnElementId: u.bpmnElementId,
        element: u.element,
        relation: u.relation,
      })),
      locale,
    );
    await this.logExport('object', id, user, meta, { locale, rows: usage.length }, 'RepoObject');
    return {
      data,
      contentType: XLSX,
      fileName: safeName(`${pick(locale, object)} - ${reportTexts(locale).objectReport}.xlsx`),
    };
  }

  private async logExport(
    report: 'handbook' | 'raci' | 'object',
    entityId: string,
    user: AuthUser,
    meta: RequestMeta,
    summary: Record<string, unknown>,
    entityType: 'Process' | 'RepoObject' = 'Process',
  ) {
    await this.audit.log({
      action: 'EXPORT',
      entityType,
      entityId,
      userId: user.id,
      summary: { report, ...summary },
      meta,
    });
  }

  async orgSettings() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [SETTING_KEYS.ORG_NAME_EN, SETTING_KEYS.ORG_NAME_AR] } },
    });
    const v = (k: string) => {
      const value = rows.find((r) => r.key === k)?.value;
      return typeof value === 'string' ? value : '';
    };
    return { nameEn: v(SETTING_KEYS.ORG_NAME_EN), nameAr: v(SETTING_KEYS.ORG_NAME_AR) };
  }

  /** The organisation logo when it is a PNG or JPEG (SVG / WebP logos are left out). */
  async logo(): Promise<ReportImage | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.LOGO } });
    const value = row?.value as { key?: string; contentType?: string } | undefined;
    if (!value?.key || !['image/png', 'image/jpeg'].includes(value.contentType ?? '')) return null;
    try {
      return imageInfo(await toBuffer(await this.storage.get(value.key)));
    } catch {
      return null;
    }
  }
}
