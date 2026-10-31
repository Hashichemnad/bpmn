import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  rateRisk,
  worstLifecycle,
  type AppLifecycle,
  type CapabilityMapDto,
  type CapabilityMetricsDto,
  type EaRef,
  type ImpactDto,
  type LandscapeDto,
  type LandscapeQuery,
  type Locale,
  type ProcessStatus,
  type TraceGrcRef,
  type TraceQuery,
  type TraceRowDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { XLSX_TYPE, addSheet, type ExcelFile } from '../common/excel';
import { elementLabel } from '../models/bpmn-xml';
import { GrcSettingsService } from '../grc/grc-settings.service';
import { EaService, toAppRef } from './ea.service';
import { compareNatural } from '../common/compare';

const procRef = { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } };
const ref = (o: { id: string; code: string | null; nameEn: string; nameAr: string }): EaRef => ({
  id: o.id,
  code: o.code,
  nameEn: o.nameEn,
  nameAr: o.nameAr,
});
const stepKey = (processId: string, elementId: string) => `${processId}|${elementId}`;
const pick = (locale: Locale, o: { nameEn: string; nameAr: string } | null | undefined) =>
  !o ? '' : locale === 'ar' ? o.nameAr || o.nameEn : o.nameEn || o.nameAr;

/**
 * Architecture views (Phase 4.3 step 2, D-110): capability map metrics, the application landscape,
 * the traceability chain capability → process → step → application → data object (+ the risks
 * and controls on those steps) and the impact analysis of an application.
 */
@Injectable()
export class EaViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ea: EaService,
    private readonly grcSettings: GrcSettingsService,
  ) {}

  /**
   * Risks and controls linked to steps of the given processes (only for users with `grc.read`;
   * others get an empty map). Retired items are left out.
   */
  private async grcOnSteps(processIds: string[], user: AuthUser) {
    const out = new Map<string, { risks: TraceGrcRef[]; controls: TraceGrcRef[] }>();
    if (!user.permissions.has(PERMISSIONS.GRC_READ) || !processIds.length) return out;
    const settings = await this.grcSettings.get();
    const links = await this.prisma.objectLink.findMany({
      where: {
        processId: { in: processIds },
        repoObject: {
          deletedAt: null,
          OR: [
            { type: 'RISK', risk: { status: { not: 'RETIRED' } } },
            { type: 'CONTROL', control: { status: { not: 'RETIRED' } } },
          ],
        },
      },
      include: { repoObject: { include: { risk: true, control: true } } },
    });
    for (const l of links) {
      const k = stepKey(l.processId, l.bpmnElementId);
      const entry = out.get(k) ?? { risks: [], controls: [] };
      const o = l.repoObject;
      if (o.risk) {
        if (entry.risks.some((r) => r.id === o.id)) continue;
        const rating = rateRisk(o.risk, settings.bands);
        entry.risks.push({
          ...ref(o),
          type: 'RISK',
          detail: rating.residualBand,
          score: rating.residualScore,
        } as TraceGrcRef & { score: number });
      } else if (o.control) {
        if (entry.controls.some((c) => c.id === o.id)) continue;
        entry.controls.push({ ...ref(o), type: 'CONTROL', detail: o.control.effectiveness });
      }
      out.set(k, entry);
    }
    return out;
  }

  // ---------- Capability map ----------

  async capabilityMap(user: AuthUser): Promise<CapabilityMapDto> {
    const caps = await this.ea.listCapabilities();
    const children = new Map<string, string[]>();
    for (const c of caps)
      if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
    const byId = new Map(caps.map((c) => [c.id, c]));
    const subtree = (id: string): string[] => [id, ...(children.get(id) ?? []).flatMap(subtree)];

    // Highest residual risk per process (any step), when the user may read Risk & Compliance.
    const processIds = [...new Set(caps.flatMap((c) => c.processes.map((p) => p.id)))];
    const grc = await this.grcOnSteps(processIds, user);
    const riskOf = new Map<string, { score: number; band: string | null }>();
    for (const [k, v] of grc) {
      const pid = k.split('|')[0];
      for (const r of v.risks as (TraceGrcRef & { score: number })[]) {
        const cur = riskOf.get(pid);
        if (!cur || r.score > cur.score) riskOf.set(pid, { score: r.score, band: r.detail });
      }
    }

    return {
      capabilities: caps.map((c) => {
        const ids = subtree(c.id);
        const processes = new Set<string>();
        const apps = new Map<string, AppLifecycle>();
        for (const id of ids) {
          const x = byId.get(id)!;
          for (const p of x.processes) processes.add(p.id);
          for (const a of x.applications) apps.set(a.id, a.lifecycle);
        }
        const lifecycles: CapabilityMetricsDto['lifecycles'] = {};
        for (const l of apps.values()) lifecycles[l] = (lifecycles[l] ?? 0) + 1;
        let risk: { score: number; band: string | null } | null = null;
        for (const p of processes) {
          const r = riskOf.get(p);
          if (r && (!risk || r.score > risk.score)) risk = r;
        }
        return {
          ...c,
          metrics: {
            processCount: processes.size,
            applicationCount: apps.size,
            lifecycles,
            worstLifecycle: worstLifecycle([...apps.values()]),
            maxRiskScore: risk?.score ?? null,
            maxRiskBand: risk?.band ?? null,
          },
        };
      }),
    };
  }

  // ---------- Landscape ----------

  async landscape(q: LandscapeQuery): Promise<LandscapeDto> {
    await this.ea.ensureApplicationRows();
    let capabilityIds: string[] | undefined;
    if (q.capabilityId) {
      const caps = await this.prisma.capability.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true },
      });
      const sub = (id: string): string[] => [
        id,
        ...caps.filter((c) => c.parentId === id).flatMap((c) => sub(c.id)),
      ];
      capabilityIds = sub(q.capabilityId);
    }
    const apps = await this.prisma.application.findMany({
      where: { object: { deletedAt: null } },
      include: {
        object: { select: { code: true, nameEn: true, nameAr: true, deletedAt: true } },
        department: { select: { id: true, nameEn: true, nameAr: true } },
        capabilities: { select: { capabilityId: true } },
      },
    });
    const inFilter = (a: (typeof apps)[number]) =>
      (!q.departmentId || a.departmentId === q.departmentId) &&
      (!q.lifecycle || a.lifecycle === q.lifecycle) &&
      (!capabilityIds || a.capabilities.some((c) => capabilityIds!.includes(c.capabilityId)));
    const selected = new Set(apps.filter(inFilter).map((a) => a.objectId));
    const interfaces = await this.prisma.appInterface.findMany({
      where: { deletedAt: null },
      include: {
        dataObjects: {
          where: { dataObject: { deletedAt: null } },
          include: { dataObject: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
        },
      },
    });
    const shown = new Set(selected);
    if (q.neighbours)
      for (const i of interfaces) {
        if (selected.has(i.sourceId)) shown.add(i.targetId);
        if (selected.has(i.targetId)) shown.add(i.sourceId);
      }
    return {
      nodes: apps
        .filter((a) => shown.has(a.objectId))
        .map((a) => ({
          ...toAppRef(a),
          criticality: a.criticality,
          department: a.department,
          neighbour: !selected.has(a.objectId),
        })),
      edges: interfaces
        .filter((i) => shown.has(i.sourceId) && shown.has(i.targetId))
        .map((i) => ({
          id: i.id,
          sourceId: i.sourceId,
          targetId: i.targetId,
          direction: i.direction,
          technology: i.technology,
          status: i.status,
          nameEn: i.nameEn,
          nameAr: i.nameAr,
          dataObjects: i.dataObjects.map((d) => d.dataObject),
        })),
    };
  }

  // ---------- Traceability ----------

  async trace(q: TraceQuery, user: AuthUser): Promise<TraceRowDto[]> {
    await this.ea.ensureApplicationRows();
    // Scope: processes of the capability (and its sub-capabilities), one process, or the steps
    // of an application / the applications using a data object.
    const caps = await this.prisma.capability.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        parentId: true,
        processes: { select: { processId: true } },
        applications: { select: { applicationId: true } },
      },
    });
    const sub = (id: string): string[] => [
      id,
      ...caps.filter((c) => c.parentId === id).flatMap((c) => sub(c.id)),
    ];
    let processIds: string[] | undefined;
    let appIds: string[] | undefined;
    if (q.capabilityId) {
      const scope = caps.filter((c) => sub(q.capabilityId!).includes(c.id));
      processIds = [...new Set(scope.flatMap((c) => c.processes.map((p) => p.processId)))];
    }
    if (q.processId)
      processIds = processIds ? processIds.filter((p) => p === q.processId) : [q.processId];
    if (q.applicationId) appIds = [q.applicationId];
    if (q.dataObjectId) {
      const d = await this.prisma.dataObject.findFirst({
        where: { id: q.dataObjectId, deletedAt: null },
        include: { usages: true },
      });
      const ids = new Set([
        ...(d?.systemOfRecordId ? [d.systemOfRecordId] : []),
        ...(d?.usages.map((u) => u.applicationId) ?? []),
      ]);
      appIds = appIds ? appIds.filter((a) => ids.has(a)) : [...ids];
    }

    const links = await this.prisma.objectLink.findMany({
      where: {
        process: { deletedAt: null, ...(processIds ? { id: { in: processIds } } : {}) },
        repoObject: {
          type: 'SYSTEM',
          deletedAt: null,
          ...(appIds ? { id: { in: appIds } } : {}),
        },
      },
      include: {
        process: procRef,
        repoObject: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
            application: {
              select: {
                objectId: true,
                lifecycle: true,
                appType: true,
                object: { select: { code: true, nameEn: true, nameAr: true, deletedAt: true } },
                dataUsages: {
                  where: { dataObject: { deletedAt: null } },
                  include: { dataObject: true },
                },
                recordOf: { where: { deletedAt: null } },
              },
            },
          },
        },
      },
      orderBy: [{ process: { code: 'asc' } }, { bpmnElementId: 'asc' }],
    });
    // Processes in scope without any application on their steps still appear (one row each).
    const linkedProcesses = new Set(links.map((l) => l.processId));
    const bare =
      processIds && !appIds
        ? await this.prisma.process.findMany({
            where: {
              id: { in: processIds.filter((p) => !linkedProcesses.has(p)) },
              deletedAt: null,
            },
            ...procRef,
          })
        : [];
    const allProcessIds = [...linkedProcesses, ...bare.map((p) => p.id)];
    const [labels, grc] = await Promise.all([
      this.ea.labels([...linkedProcesses]),
      this.grcOnSteps(allProcessIds, user),
    ]);
    const capsOf = (processId: string) =>
      caps.filter((c) => c.processes.some((p) => p.processId === processId)).map(ref);
    const strip = (l: TraceGrcRef[]) =>
      l.map(({ id, code, nameEn, nameAr, type, detail }) => ({
        id,
        code,
        nameEn,
        nameAr,
        type,
        detail,
      }));

    const rows: TraceRowDto[] = [];
    const seen = new Set<string>();
    for (const l of links) {
      const a = l.repoObject.application;
      const key = `${l.processId}|${l.bpmnElementId}|${l.repoObjectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const data = new Map<string, TraceRowDto['dataObjects'][number]>();
      for (const r of a?.recordOf ?? [])
        data.set(r.id, {
          ...ref(r),
          create: false,
          read: false,
          update: false,
          delete: false,
          systemOfRecord: true,
        });
      for (const u of a?.dataUsages ?? [])
        if (!q.dataObjectId || u.dataObjectId === q.dataObjectId || data.has(u.dataObjectId))
          data.set(u.dataObjectId, {
            ...ref(u.dataObject),
            create: u.canCreate,
            read: u.canRead,
            update: u.canUpdate,
            delete: u.canDelete,
            systemOfRecord: data.get(u.dataObjectId)?.systemOfRecord ?? false,
          });
      const onStep = grc.get(stepKey(l.processId, l.bpmnElementId));
      rows.push({
        capabilities: capsOf(l.processId),
        process: { ...l.process, status: l.process.status as ProcessStatus },
        bpmnElementId: l.bpmnElementId,
        element: elementLabel(labels.get(l.processId) ?? new Map(), l.bpmnElementId),
        application: a ? toAppRef(a) : null,
        dataObjects: [...data.values()].filter((d) => !q.dataObjectId || d.id === q.dataObjectId),
        risks: strip(onStep?.risks ?? []),
        controls: strip(onStep?.controls ?? []),
      });
    }
    for (const p of bare) {
      const risks = new Map<string, TraceGrcRef>();
      const controls = new Map<string, TraceGrcRef>();
      for (const [k, v] of grc)
        if (k.startsWith(`${p.id}|`)) {
          for (const r of strip(v.risks)) risks.set(r.id, r);
          for (const c of strip(v.controls)) controls.set(c.id, c);
        }
      rows.push({
        capabilities: capsOf(p.id),
        process: { ...p, status: p.status as ProcessStatus },
        bpmnElementId: null,
        element: null,
        application: null,
        dataObjects: [],
        risks: [...risks.values()],
        controls: [...controls.values()],
      });
    }
    return rows;
  }

  async traceExport(q: TraceQuery, user: AuthUser, meta: RequestMeta): Promise<ExcelFile> {
    const rows = await this.trace(q, user);
    const locale = q.locale;
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const ws = addSheet(
      wb,
      L('Traceability', 'التتبع'),
      [
        L('Capabilities', 'القدرات'),
        L('Process', 'العملية'),
        L('Step', 'الخطوة'),
        L('Application', 'التطبيق'),
        L('Lifecycle', 'دورة الحياة'),
        L('Data objects (CRUD)', 'كائنات البيانات (CRUD)'),
        L('Risks', 'المخاطر'),
        L('Controls', 'الضوابط'),
      ],
      [26, 30, 30, 26, 14, 36, 30, 30],
      locale,
    );
    for (const r of rows)
      ws.addRow([
        r.capabilities.map((c) => `${c.code ?? ''} ${pick(locale, c)}`.trim()).join('; '),
        `${r.process.code} ${pick(locale, r.process)}`,
        this.stepText(r.bpmnElementId, r.element, locale),
        r.application ? `${r.application.code ?? ''} ${pick(locale, r.application)}`.trim() : '',
        r.application ? LIFECYCLE[r.application.lifecycle][ar ? 1 : 0] : '',
        r.dataObjects.map((d) => `${pick(locale, d)} (${crud(d)})`).join('; '),
        r.risks.map((x) => `${x.code ?? ''} ${pick(locale, x)}`.trim()).join('; '),
        r.controls.map((x) => `${x.code ?? ''} ${pick(locale, x)}`.trim()).join('; '),
      ]);
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'Application',
      userId: user.id,
      summary: { report: 'ea-traceability', rows: rows.length, ...q },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: 'traceability.xlsx',
      contentType: XLSX_TYPE,
    };
  }

  private stepText(
    elementId: string | null,
    element: { nameEn: string; nameAr: string } | null,
    locale: Locale,
  ) {
    if (!elementId) return '';
    if (elementId === PROCESS_ELEMENT_ID)
      return locale === 'ar' ? 'العملية كاملة' : 'Whole process';
    return pick(locale, element) || elementId;
  }

  // ---------- Impact analysis ----------

  async impact(id: string, user: AuthUser): Promise<ImpactDto> {
    const detail = await this.ea.getApplication(id);
    const processIds = [...new Set(detail.steps.map((s) => s.process.id))];
    const grc = await this.grcOnSteps(processIds, user);
    const strip = (l: TraceGrcRef[]) =>
      l.map(({ id: i, code, nameEn, nameAr, type, detail: d }) => ({
        id: i,
        code,
        nameEn,
        nameAr,
        type,
        detail: d,
      }));
    const steps = detail.steps.map((s) => {
      const onStep = grc.get(stepKey(s.process.id, s.bpmnElementId));
      return { ...s, risks: strip(onStep?.risks ?? []), controls: strip(onStep?.controls ?? []) };
    });
    const controls = new Map<string, ImpactDto['controls'][number]>();
    for (const s of steps)
      for (const c of s.controls) {
        const cur = controls.get(c.id);
        controls.set(c.id, {
          ...c,
          runsIn: cur?.runsIn ?? false,
          onSteps: (cur?.onSteps ?? 0) + 1,
        });
      }
    if (user.permissions.has(PERMISSIONS.GRC_READ)) {
      const running = await this.prisma.control.findMany({
        where: { systemId: id, status: { not: 'RETIRED' }, object: { deletedAt: null } },
        include: { object: true },
      });
      for (const c of running) {
        const cur = controls.get(c.objectId);
        controls.set(c.objectId, {
          ...ref(c.object),
          type: 'CONTROL',
          detail: c.effectiveness,
          runsIn: true,
          onSteps: cur?.onSteps ?? 0,
        });
      }
    }
    const risks = new Set(steps.flatMap((s) => s.risks.map((r) => r.id)));
    return {
      application: {
        id: detail.item.id,
        code: detail.item.code,
        nameEn: detail.item.nameEn,
        nameAr: detail.item.nameAr,
        lifecycle: detail.item.lifecycle,
        appType: detail.item.appType,
      },
      summary: {
        processes: processIds.length,
        steps: steps.length,
        controls: controls.size,
        risks: risks.size,
        interfaces: detail.interfaces.length,
        dataObjects: detail.dataObjects.length,
        capabilities: detail.item.capabilities.length,
      },
      steps,
      controls: [...controls.values()].sort((a, b) =>
        compareNatural(a.code ?? a.nameEn, b.code ?? b.nameEn),
      ),
      interfaces: detail.interfaces,
      dataObjects: detail.dataObjects,
      capabilities: detail.item.capabilities,
    };
  }

  async impactExport(
    id: string,
    locale: Locale,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<ExcelFile> {
    const d = await this.impact(id, user);
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const name = (o: { code: string | null; nameEn: string; nameAr: string }) =>
      `${o.code ?? ''} ${pick(locale, o)}`.trim();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const sum = addSheet(
      wb,
      L('Summary', 'الملخص'),
      [L('Measure', 'المؤشر'), L('Count', 'العدد')],
      [50, 12],
      locale,
    );
    sum.addRow([L('Application', 'التطبيق'), name(d.application)]);
    sum.addRow([L('Lifecycle', 'دورة الحياة'), LIFECYCLE[d.application.lifecycle][ar ? 1 : 0]]);
    for (const [en, a, n] of [
      ['Processes affected', 'العمليات المتأثرة', d.summary.processes],
      ['Steps affected', 'الخطوات المتأثرة', d.summary.steps],
      ['Controls affected', 'الضوابط المتأثرة', d.summary.controls],
      ['Risks on supported steps', 'المخاطر على الخطوات المدعومة', d.summary.risks],
      ['Interfaces', 'الواجهات', d.summary.interfaces],
      ['Data objects', 'كائنات البيانات', d.summary.dataObjects],
      ['Capabilities', 'القدرات', d.summary.capabilities],
    ] as const)
      sum.addRow([L(en, a), n]);
    const steps = addSheet(
      wb,
      L('Processes and steps', 'العمليات والخطوات'),
      [
        L('Process', 'العملية'),
        L('Step', 'الخطوة'),
        L('Risks', 'المخاطر'),
        L('Controls', 'الضوابط'),
      ],
      [34, 34, 40, 40],
      locale,
    );
    for (const s of d.steps)
      steps.addRow([
        `${s.process.code} ${pick(locale, s.process)}`,
        this.stepText(s.bpmnElementId, s.element, locale),
        s.risks.map(name).join('; '),
        s.controls.map(name).join('; '),
      ]);
    const controls = addSheet(
      wb,
      L('Controls', 'الضوابط'),
      [
        L('Control', 'الضابط'),
        L('Runs in the application', 'يعمل داخل التطبيق'),
        L('On supported steps', 'على الخطوات المدعومة'),
      ],
      [44, 20, 20],
      locale,
    );
    for (const c of d.controls)
      controls.addRow([name(c), c.runsIn ? L('Yes', 'نعم') : L('No', 'لا'), c.onSteps]);
    const itf = addSheet(
      wb,
      L('Interfaces', 'الواجهات'),
      [
        L('Source', 'المصدر'),
        L('Target', 'الهدف'),
        L('Technology', 'التقنية'),
        L('Data objects', 'كائنات البيانات'),
      ],
      [30, 30, 16, 40],
      locale,
    );
    for (const i of d.interfaces)
      itf.addRow([
        name(i.source),
        name(i.target),
        i.technology,
        i.dataObjects.map((o) => pick(locale, o)).join('; '),
      ]);
    const data = addSheet(
      wb,
      L('Data objects', 'كائنات البيانات'),
      [L('Data object', 'كائن البيانات'), L('System of record', 'نظام السجل'), 'CRUD'],
      [40, 18, 10],
      locale,
    );
    for (const o of d.dataObjects)
      data.addRow([name(o), o.systemOfRecord ? L('Yes', 'نعم') : '', crud(o)]);
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'Application',
      entityId: id,
      userId: user.id,
      summary: { report: 'ea-impact', locale, steps: d.summary.steps },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `impact-${(d.application.code || 'application').replace(/[^A-Za-z0-9_-]/g, '_')}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }
}

const LIFECYCLE: Record<AppLifecycle, [string, string]> = {
  PLANNED: ['Planned', 'مخطط'],
  ACTIVE: ['Active', 'نشط'],
  PHASING_OUT: ['Phasing out', 'قيد الإيقاف التدريجي'],
  RETIRED: ['Retired', 'موقوف'],
};
const crud = (u: { create: boolean; read: boolean; update: boolean; delete: boolean }) =>
  `${u.create ? 'C' : ''}${u.read ? 'R' : ''}${u.update ? 'U' : ''}${u.delete ? 'D' : ''}`;
