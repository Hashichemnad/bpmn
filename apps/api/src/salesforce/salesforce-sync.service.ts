import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  KPI_DIRECTIONS,
  KPI_FREQUENCIES,
  KPI_STATUSES,
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  isPeriod,
  periodStart,
  type KpiDirection,
  type KpiFrequency,
  type KpiStatus,
  type SalesforceFieldDto,
  type SalesforcePreviewDto,
  type SalesforceRunDto,
  type SalesforceTestResultDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { KpiService, SALESFORCE_FIELDS } from '../kpi/kpi.service';
import { KpiScheduler } from '../kpi/kpi-scheduler.service';
import { SalesforceClient, fieldValue, type SfRecord } from './salesforce-client';
import { SalesforceError, SalesforceHttp } from './salesforce-http';
import {
  SalesforceSettingsService,
  type StoredSalesforceSettings,
} from './salesforce-settings.service';

interface DesiredObjective {
  sfId: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
}
interface DesiredKpi {
  sfId: string;
  url: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  unit?: string;
  direction?: KpiDirection;
  frequency?: KpiFrequency;
  target?: number | null;
  status?: KpiStatus;
  objectiveSfId: string | null;
}
interface DesiredValue {
  sfId: string;
  kpiSfId: string;
  period: string;
  value: number;
  target: number | null;
  comment: string;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const mapValue = <T extends string>(
  raw: unknown,
  map: Record<string, string>,
  allowed: readonly T[],
) => {
  const v = str(raw);
  if (!v) return undefined;
  const mapped =
    map[v] ?? Object.entries(map).find(([k]) => k.toLowerCase() === v.toLowerCase())?.[1] ?? v;
  const up = mapped.toUpperCase().replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(up) ? (up as T) : undefined;
};
const fields = (...names: string[]) => [...new Set(['Id', ...names.filter(Boolean)])].join(', ');

/**
 * Read-only Salesforce KPI import (Phase 4.3, D-115 / D-116): definitions (objectives, KPIs),
 * actual values and the KPI ↔ process mapping, matched by the Salesforce Id stored on the
 * objective / KPI. Preview shows the differences; apply writes them, audited, in a sync run.
 */
@Injectable()
export class SalesforceSyncService implements OnModuleInit {
  private readonly logger = new Logger(SalesforceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly http: SalesforceHttp,
    private readonly settings: SalesforceSettingsService,
    private readonly kpis: KpiService,
    private readonly scheduler: KpiScheduler,
  ) {}

  onModuleInit() {
    this.scheduler.register({ runScheduled: (now) => this.runScheduled(now) });
  }

  private client(s: StoredSalesforceSettings) {
    return new SalesforceClient(this.http, s, this.settings.secrets(s));
  }

  private fail(err: unknown): never {
    if (err instanceof SalesforceError) throw badRequest(err.code, err.message);
    throw err;
  }

  async test(): Promise<SalesforceTestResultDto> {
    const s = await this.settings.get();
    const client = this.client(s);
    try {
      const id = await client.identity();
      const objects: Record<string, boolean> = {};
      const m = s.mapping;
      for (const o of [
        m.kpis.object,
        m.results.object,
        m.objectives.source === 'OBJECT' ? m.objectives.object : '',
        m.processMap.object,
      ].filter(Boolean))
        objects[o] = await client
          .describe(o)
          .then(() => true)
          .catch(() => false);
      return { ok: true, ...id, objects };
    } catch (err) {
      if (err instanceof SalesforceError)
        return { ok: false, error: `${err.code}: ${err.message}` };
      throw err;
    }
  }

  async describe(object: string): Promise<SalesforceFieldDto[]> {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(object)) throw badRequest('INVALID_API_NAME');
    const s = await this.settings.get();
    return this.client(s)
      .describe(object)
      .catch((e) => this.fail(e));
  }

  // ---------- Reading Salesforce ----------

  private async load(s: StoredSalesforceSettings) {
    const client = this.client(s);
    const m = s.mapping;
    const warnings: SalesforcePreviewDto['warnings'] = [];
    const k = m.kpis;
    if (!k.object) throw badRequest('SALESFORCE_INCOMPLETE');
    const kpiRecords = await client.query(
      `SELECT ${fields(k.code, k.nameEn, k.nameAr, k.descriptionEn, k.descriptionAr, k.unit, k.direction, k.frequency, k.target, k.status, m.objectives.source !== 'NONE' ? k.objective : '')} FROM ${k.object}`,
    );

    // Objectives: their own object (lookup on the KPI) or the distinct values of a KPI field.
    const objectives = new Map<string, DesiredObjective>();
    const objectiveOf = new Map<string, string>();
    if (m.objectives.source === 'OBJECT' && m.objectives.object) {
      const o = m.objectives;
      for (const r of await client.query(
        `SELECT ${fields(o.code, o.nameEn, o.nameAr, o.descriptionEn, o.descriptionAr)} FROM ${o.object}`,
      ))
        objectives.set(r.Id, {
          sfId: r.Id,
          code: str(fieldValue(r, o.code)) || null,
          nameEn: str(fieldValue(r, o.nameEn)) || r.Id,
          nameAr: str(fieldValue(r, o.nameAr)),
          descriptionEn: str(fieldValue(r, o.descriptionEn)),
          descriptionAr: str(fieldValue(r, o.descriptionAr)),
        });
      for (const r of kpiRecords) {
        const ref = str(fieldValue(r, k.objective));
        if (ref && objectives.has(ref)) objectiveOf.set(r.Id, ref);
      }
    } else if (m.objectives.source === 'KPI_FIELD' && k.objective) {
      for (const r of kpiRecords) {
        const value = str(fieldValue(r, k.objective));
        if (!value) continue;
        const sfId = `${k.objective}:${value}`.slice(0, 190);
        if (!objectives.has(sfId))
          objectives.set(sfId, {
            sfId,
            code: null,
            nameEn: value,
            nameAr: '',
            descriptionEn: '',
            descriptionAr: '',
          });
        objectiveOf.set(r.Id, sfId);
      }
    }

    const kpis = new Map<string, DesiredKpi>();
    for (const r of kpiRecords) {
      const direction = k.direction
        ? mapValue(fieldValue(r, k.direction), k.directionValues, KPI_DIRECTIONS)
        : undefined;
      const frequency = k.frequency
        ? mapValue(fieldValue(r, k.frequency), k.frequencyValues, KPI_FREQUENCIES)
        : undefined;
      if (k.direction && str(fieldValue(r, k.direction)) && !direction)
        warnings.push({
          record: r.Id,
          code: 'UNMAPPED_VALUE',
          detail: `${k.direction}=${str(fieldValue(r, k.direction))}`,
        });
      if (k.frequency && str(fieldValue(r, k.frequency)) && !frequency)
        warnings.push({
          record: r.Id,
          code: 'UNMAPPED_VALUE',
          detail: `${k.frequency}=${str(fieldValue(r, k.frequency))}`,
        });
      kpis.set(r.Id, {
        sfId: r.Id,
        url: client.recordUrl(r.Id),
        code: str(fieldValue(r, k.code)).slice(0, 50) || null,
        nameEn: str(fieldValue(r, k.nameEn)).slice(0, 300) || str(fieldValue(r, k.code)) || r.Id,
        nameAr: str(fieldValue(r, k.nameAr)).slice(0, 300),
        descriptionEn: str(fieldValue(r, k.descriptionEn)).slice(0, 5000),
        descriptionAr: str(fieldValue(r, k.descriptionAr)).slice(0, 5000),
        unit: k.unit ? str(fieldValue(r, k.unit)).slice(0, 40) : undefined,
        direction,
        frequency,
        target: k.target ? num(fieldValue(r, k.target)) : undefined,
        status: k.status
          ? mapValue(fieldValue(r, k.status), k.statusValues, KPI_STATUSES)
          : undefined,
        objectiveSfId: objectiveOf.get(r.Id) ?? null,
      });
    }

    // Actual values: year + period → 2026-Q1 / 2026-03 / 2026, checked against the KPI frequency.
    const values: DesiredValue[] = [];
    const res = m.results;
    if (s.syncValues && res.object && res.kpi && res.value) {
      const local = new Map(
        (
          await this.prisma.kpi.findMany({
            where: { salesforceId: { in: [...kpis.keys()] } },
            select: { salesforceId: true, frequency: true },
          })
        ).map((x) => [x.salesforceId!, x.frequency as KpiFrequency]),
      );
      for (const r of await client.query(
        `SELECT ${fields(res.kpi, res.year, res.period, res.value, res.target, res.comment)} FROM ${res.object}`,
      )) {
        const kpiSfId = str(fieldValue(r, res.kpi));
        const kpi = kpis.get(kpiSfId);
        if (!kpi) {
          warnings.push({ record: r.Id, code: 'UNKNOWN_KPI', detail: kpiSfId });
          continue;
        }
        const value = num(fieldValue(r, res.value));
        if (value === null) continue;
        const frequency = kpi.frequency ?? local.get(kpiSfId) ?? 'MONTHLY';
        const period = this.period(r, res, frequency);
        if (!period || !isPeriod(period, frequency)) {
          warnings.push({
            record: r.Id,
            code: 'PERIOD_MISMATCH',
            detail: `${str(fieldValue(r, res.year))} ${str(fieldValue(r, res.period))} (${frequency})`,
          });
          continue;
        }
        if (periodStart(period).getTime() > Date.now()) continue;
        values.push({
          sfId: r.Id,
          kpiSfId,
          period,
          value,
          target: res.target ? num(fieldValue(r, res.target)) : null,
          comment: res.comment ? str(fieldValue(r, res.comment)).slice(0, 2000) : '',
        });
      }
    }

    // KPI ↔ process mapping (process code).
    const links: { kpiSfId: string; processCode: string }[] = [];
    const pm = m.processMap;
    if (pm.object && pm.kpi && pm.processCode)
      for (const r of await client.query(
        `SELECT ${fields(pm.kpi, pm.processCode)} FROM ${pm.object}`,
      )) {
        const kpiSfId = str(fieldValue(r, pm.kpi));
        const processCode = str(fieldValue(r, pm.processCode));
        if (kpis.has(kpiSfId) && processCode) links.push({ kpiSfId, processCode });
      }
    return { objectives, kpis, values, links, warnings };
  }

  private period(
    r: SfRecord,
    res: StoredSalesforceSettings['mapping']['results'],
    frequency: KpiFrequency,
  ) {
    const year = str(fieldValue(r, res.year)).slice(0, 4);
    if (!/^\d{4}$/.test(year)) return null;
    const raw = str(fieldValue(r, res.period));
    const mapped = (res.periodValues[raw] ?? raw).toUpperCase();
    if (/^Q[1-4]$/.test(mapped)) return `${year}-${mapped}`;
    const month = /^M(0[1-9]|1[0-2])$/.exec(mapped);
    if (month) return `${year}-${month[1]}`;
    if (mapped === 'YEAR' || (!raw && frequency === 'ANNUAL')) return year;
    return null;
  }

  // ---------- Differences ----------

  private async diff(s: StoredSalesforceSettings) {
    const d = await this.load(s);
    const [localObjectives, localKpis, processes] = await Promise.all([
      this.prisma.strategicObjective.findMany({
        where: { salesforceId: { in: [...d.objectives.keys()] }, deletedAt: null },
      }),
      this.prisma.kpi.findMany({
        where: { salesforceId: { in: [...d.kpis.keys()] }, object: { deletedAt: null } },
        include: {
          object: true,
          objectives: { include: { objective: { select: { salesforceId: true } } } },
          measurements: true,
        },
      }),
      this.prisma.process.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true },
      }),
    ]);
    const preview: SalesforcePreviewDto = {
      objectives: { create: [], update: [], unchanged: 0 },
      kpis: { create: [], update: [], unchanged: 0 },
      measurements: { create: 0, update: 0, unchanged: 0, samples: [] },
      processLinks: { create: 0, unknownProcesses: [] },
      warnings: d.warnings,
    };
    const changesOf = (before: Record<string, unknown>, after: Record<string, unknown>) => {
      const out: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, to] of Object.entries(after))
        if (to !== undefined && (before[key] ?? null) !== (to ?? null))
          out[key] = { from: before[key] ?? null, to };
      return out;
    };

    const objByS = new Map(localObjectives.map((o) => [o.salesforceId!, o]));
    for (const o of d.objectives.values()) {
      const local = objByS.get(o.sfId);
      const fields = {
        code: o.code,
        nameEn: o.nameEn,
        nameAr: o.nameAr,
        descriptionEn: o.descriptionEn,
        descriptionAr: o.descriptionAr,
      };
      if (!local)
        preview.objectives.create.push({ salesforceId: o.sfId, code: o.code, name: o.nameEn });
      else {
        const changes = changesOf(local, fields);
        if (Object.keys(changes).length)
          preview.objectives.update.push({
            salesforceId: o.sfId,
            code: o.code,
            name: o.nameEn,
            changes,
          });
        else preview.objectives.unchanged++;
      }
    }

    const kpiByS = new Map(localKpis.map((k) => [k.salesforceId!, k]));
    const kpiChanges = new Map<string, Record<string, { from: unknown; to: unknown }>>();
    for (const k of d.kpis.values()) {
      const local = kpiByS.get(k.sfId);
      if (!local) {
        preview.kpis.create.push({ salesforceId: k.sfId, code: k.code, name: k.nameEn });
        continue;
      }
      const changes = changesOf(
        {
          ...local.object,
          ...local,
          objective: local.objectives[0]?.objective.salesforceId ?? null,
        },
        {
          code: k.code,
          nameEn: k.nameEn,
          nameAr: s.mapping.kpis.nameAr ? k.nameAr : undefined,
          descriptionEn: s.mapping.kpis.descriptionEn ? k.descriptionEn : undefined,
          descriptionAr: s.mapping.kpis.descriptionAr ? k.descriptionAr : undefined,
          unit: k.unit,
          direction: k.direction,
          frequency: k.frequency,
          target: k.target,
          status: k.status,
          objective: s.mapping.objectives.source !== 'NONE' ? k.objectiveSfId : undefined,
        },
      );
      kpiChanges.set(k.sfId, changes);
      if (Object.keys(changes).length)
        preview.kpis.update.push({ salesforceId: k.sfId, code: k.code, name: k.nameEn, changes });
      else preview.kpis.unchanged++;
    }

    for (const v of d.values) {
      const existing = kpiByS.get(v.kpiSfId)?.measurements.find((m) => m.period === v.period);
      if (!existing) {
        preview.measurements.create++;
        if (preview.measurements.samples.length < 20)
          preview.measurements.samples.push({
            salesforceId: v.sfId,
            code: d.kpis.get(v.kpiSfId)?.code ?? null,
            name: v.period,
            changes: { value: { from: null, to: v.value } },
          });
      } else if (existing.value !== v.value || existing.comment !== v.comment) {
        preview.measurements.update++;
        if (preview.measurements.samples.length < 20)
          preview.measurements.samples.push({
            salesforceId: v.sfId,
            code: d.kpis.get(v.kpiSfId)?.code ?? null,
            name: v.period,
            changes: { value: { from: existing.value, to: v.value } },
          });
      } else preview.measurements.unchanged++;
    }

    const processByCode = new Map(processes.map((p) => [p.code, p.id]));
    const existingLinks = new Set(
      (
        await this.prisma.objectLink.findMany({
          where: {
            relation: 'MEASURES',
            bpmnElementId: PROCESS_ELEMENT_ID,
            repoObjectId: { in: localKpis.map((k) => k.objectId) },
          },
          select: { processId: true, repoObjectId: true },
        })
      ).map((l) => `${l.repoObjectId}|${l.processId}`),
    );
    const linksToCreate: { kpiSfId: string; processId: string }[] = [];
    for (const l of d.links) {
      const processId = processByCode.get(l.processCode);
      if (!processId) {
        if (!preview.processLinks.unknownProcesses.includes(l.processCode))
          preview.processLinks.unknownProcesses.push(l.processCode);
        continue;
      }
      const local = kpiByS.get(l.kpiSfId);
      if (local && existingLinks.has(`${local.objectId}|${processId}`)) continue;
      linksToCreate.push({ kpiSfId: l.kpiSfId, processId });
    }
    preview.processLinks.create = linksToCreate.length;
    return { d, preview, objByS, kpiByS, linksToCreate };
  }

  async preview(): Promise<SalesforcePreviewDto> {
    const s = await this.settings.get();
    if (!s.enabled) throw badRequest('SALESFORCE_DISABLED');
    try {
      return (await this.diff(s)).preview;
    } catch (err) {
      return this.fail(err);
    }
  }

  // ---------- Apply ----------

  async sync(
    actor: AuthUser,
    meta: RequestMeta,
    trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL',
  ): Promise<SalesforceRunDto> {
    const s = await this.settings.get();
    if (!s.enabled) throw badRequest('SALESFORCE_DISABLED');
    const running = await this.prisma.salesforceSyncRun.findFirst({
      where: { status: 'RUNNING', startedAt: { gt: new Date(Date.now() - 30 * 60_000) } },
    });
    if (running) throw conflict('SYNC_RUNNING');
    const run = await this.prisma.salesforceSyncRun.create({
      data: { trigger, userId: trigger === 'MANUAL' ? actor.id : null },
    });
    try {
      const counts = await this.apply(s, actor, meta);
      await this.prisma.salesforceSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          counts: counts.counts,
          warnings: counts.warnings,
        },
      });
      await this.audit.log({
        action: 'SYNC',
        entityType: 'Integration',
        entityId: 'salesforce',
        userId: trigger === 'MANUAL' ? actor.id : null,
        summary: {
          runId: run.id,
          trigger,
          status: 'SUCCESS',
          ...counts.counts,
          warnings: counts.warnings.length,
        },
        meta,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
      await this.prisma.salesforceSyncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message },
      });
      await this.audit.log({
        action: 'SYNC',
        entityType: 'Integration',
        entityId: 'salesforce',
        userId: trigger === 'MANUAL' ? actor.id : null,
        summary: { runId: run.id, trigger, status: 'FAILED', error: message },
        meta,
      });
      await this.notifyFailure(message);
    }
    const row = await this.prisma.salesforceSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    return (await this.settings.toRunDtos([row]))[0];
  }

  private async apply(s: StoredSalesforceSettings, actor: AuthUser, meta: RequestMeta) {
    const { d, preview, objByS, kpiByS, linksToCreate } = await this.diff(s);
    const counts = {
      objectivesCreated: 0,
      objectivesUpdated: 0,
      kpisCreated: 0,
      kpisUpdated: 0,
      valuesCreated: 0,
      valuesUpdated: 0,
      linksCreated: 0,
    };
    const now = new Date();

    // Objectives.
    const objectiveIds = new Map<string, string>([...objByS].map(([sf, o]) => [sf, o.id]));
    for (const o of d.objectives.values()) {
      const input = {
        code: o.code,
        nameEn: o.nameEn,
        nameAr: o.nameAr,
        descriptionEn: o.descriptionEn,
        descriptionAr: o.descriptionAr,
      };
      const local = objByS.get(o.sfId);
      if (!local) {
        const created = await this.kpis.createObjective(input, actor, meta, {
          salesforceId: o.sfId,
        });
        objectiveIds.set(o.sfId, created.id);
        counts.objectivesCreated++;
      } else if (preview.objectives.update.some((u) => u.salesforceId === o.sfId)) {
        await this.kpis.updateObjective(local.id, input, actor, meta, { sync: true });
        counts.objectivesUpdated++;
      }
    }

    // KPIs (definitions; the mapped fields become read-only in ProcessHub).
    const k = s.mapping.kpis;
    const locked = SALESFORCE_FIELDS.filter((f) => (k as Record<string, unknown>)[f] !== '');
    const kpiIds = new Map<string, { id: string; frequency: KpiFrequency }>(
      [...kpiByS].map(([sf, x]) => [
        sf,
        { id: x.objectId, frequency: x.frequency as KpiFrequency },
      ]),
    );
    for (const x of d.kpis.values()) {
      const objective = x.objectiveSfId ? objectiveIds.get(x.objectiveSfId) : undefined;
      const input = {
        code: x.code,
        nameEn: x.nameEn,
        ...(k.nameAr ? { nameAr: x.nameAr } : {}),
        ...(k.descriptionEn ? { descriptionEn: x.descriptionEn } : {}),
        ...(k.descriptionAr ? { descriptionAr: x.descriptionAr } : {}),
        ...(x.unit !== undefined ? { unit: x.unit } : {}),
        ...(x.direction ? { direction: x.direction } : {}),
        ...(x.target !== undefined ? { target: x.target } : {}),
        ...(x.status ? { status: x.status } : {}),
        ...(s.mapping.objectives.source !== 'NONE'
          ? { objectiveIds: objective ? [objective] : [] }
          : {}),
      };
      const local = kpiByS.get(x.sfId);
      let id: string;
      if (!local) {
        id = (
          await this.kpis.create(
            {
              ...input,
              ...(x.frequency ? { frequency: x.frequency } : {}),
              dataSource: 'SALESFORCE',
            },
            actor,
            meta,
          )
        ).item.id;
        counts.kpisCreated++;
      } else {
        id = local.objectId;
        const changed = preview.kpis.update.find((u) => u.salesforceId === x.sfId);
        // A frequency change with recorded values is refused; it is reported as a warning.
        const frequency =
          x.frequency && x.frequency !== local.frequency && !local.measurements.length
            ? { frequency: x.frequency }
            : {};
        if (x.frequency && x.frequency !== local.frequency && local.measurements.length)
          d.warnings.push({ record: x.sfId, code: 'FREQUENCY_HAS_VALUES' });
        if (changed) {
          await this.kpis.update(id, { ...input, ...frequency }, actor, meta, { sync: true });
          counts.kpisUpdated++;
        }
      }
      const saved = await this.prisma.kpi.update({
        where: { objectId: id },
        data: {
          salesforceId: x.sfId,
          salesforceUrl: x.url,
          lastSyncedAt: now,
          lockedFields: [...locked],
          dataSource: 'SALESFORCE',
        },
      });
      kpiIds.set(x.sfId, { id, frequency: saved.frequency as KpiFrequency });
    }

    // Actual values (and their per-period targets).
    for (const v of d.values) {
      const kpi = kpiIds.get(v.kpiSfId);
      if (!kpi || !isPeriod(v.period, kpi.frequency)) continue;
      const existing = await this.prisma.kpiMeasurement.findUnique({
        where: { kpiId_period: { kpiId: kpi.id, period: v.period } },
      });
      if (!existing || existing.value !== v.value || existing.comment !== v.comment) {
        await this.kpis.measure(
          kpi.id,
          { period: v.period, value: v.value, comment: v.comment },
          actor,
          meta,
          {
            source: 'SALESFORCE',
            salesforceId: v.sfId,
          },
        );
        if (existing) counts.valuesUpdated++;
        else counts.valuesCreated++;
      }
      if (v.target !== null)
        await this.prisma.kpiPeriodTarget.upsert({
          where: { kpiId_period: { kpiId: kpi.id, period: v.period } },
          create: { kpiId: kpi.id, period: v.period, target: v.target },
          update: { target: v.target },
        });
    }

    // KPI ↔ process links (whole process).
    for (const l of linksToCreate) {
      const kpi = kpiIds.get(l.kpiSfId);
      if (!kpi) continue;
      const created = await this.prisma.objectLink.createMany({
        data: [
          {
            processId: l.processId,
            bpmnElementId: PROCESS_ELEMENT_ID,
            repoObjectId: kpi.id,
            relation: 'MEASURES',
            createdById: actor.id,
          },
        ],
        skipDuplicates: true,
      });
      counts.linksCreated += created.count;
    }
    return { counts, warnings: d.warnings };
  }

  private async notifyFailure(message: string) {
    const admins = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
      select: { id: true },
    });
    await this.notifications.notify({
      type: 'KPI',
      userIds: admins.map((a) => a.id),
      params: {
        kind: 'syncFailed',
        titleEn: 'Salesforce',
        titleAr: 'Salesforce',
        comment: message.slice(0, 300),
      },
      link: '/settings/salesforce',
    });
  }

  async runs(limit = 20): Promise<SalesforceRunDto[]> {
    const rows = await this.prisma.salesforceSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return this.settings.toRunDtos(rows);
  }

  async runWarnings(id: string) {
    const r = await this.prisma.salesforceSyncRun.findUnique({ where: { id } });
    return (r?.warnings ?? []) as SalesforcePreviewDto['warnings'];
  }

  // ---------- Schedule ----------

  /** Start of the latest scheduled slot (UTC) before `now`. */
  static slot(
    now: Date,
    schedule: StoredSalesforceSettings['schedule'],
    hour: number,
  ): Date | null {
    if (schedule === 'OFF') return null;
    const d = new Date(now);
    if (schedule === 'HOURLY') {
      d.setUTCMinutes(0, 0, 0);
      return d;
    }
    d.setUTCHours(hour, 0, 0, 0);
    if (d > now) d.setUTCDate(d.getUTCDate() - 1);
    if (schedule === 'WEEKLY') while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }

  async runScheduled(now: Date) {
    const s = await this.settings.get();
    if (!s.enabled) return null;
    const slot = SalesforceSyncService.slot(now, s.schedule, s.scheduleHour);
    if (!slot || (s.lastScheduledAt && new Date(s.lastScheduledAt) >= slot)) return null;
    await this.settings.markScheduled(now);
    // Runs as the Super Admin who configured the link (audit trail of the written records).
    const owner = await this.prisma.setting.findUnique({
      where: { key: 'integrations.salesforce' },
    });
    const admin =
      owner?.updatedById ??
      (
        await this.prisma.user.findFirst({
          where: { deletedAt: null, roles: { some: { role: { key: 'SUPER_ADMIN' } } } },
          select: { id: true },
        })
      )?.id;
    if (!admin) return null;
    const actor = {
      id: admin,
      email: 'salesforce-sync',
      permissions: new Set([PERMISSIONS.KPI_EDIT]),
    } as unknown as AuthUser;
    try {
      return await this.sync(actor, { ip: null, userAgent: null }, 'SCHEDULED');
    } catch (err) {
      this.logger.error(`Scheduled Salesforce sync: ${(err as Error).message}`);
      return null;
    }
  }
}
