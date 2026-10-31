import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CAPABILITY_MAX_LEVEL,
  extractBpmnLabels,
  isEndOfLife,
  type ApplicationDetailDto,
  type ApplicationDto,
  type ApplicationListQuery,
  type ApplicationRef,
  type BpmnElementLabel,
  type CapabilityDto,
  type CreateApplicationInput,
  type CreateCapabilityInput,
  type CreateDataObjectInput,
  type CreateInterfaceInput,
  type CrudInput,
  type DataObjectDto,
  type DataObjectListQuery,
  type EaStepDto,
  type InterfaceDto,
  type InterfaceListQuery,
  type Paginated,
  type ProcessStatus,
  type UpdateApplicationInput,
  type UpdateCapabilityInput,
  type UpdateDataObjectInput,
  type UpdateInterfaceInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, conflict, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { elementLabel } from '../models/bpmn-xml';
import { compareNatural } from '../common/compare';

type Tx = Prisma.TransactionClient | PrismaClient;

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;
const deptRef = { select: { id: true, nameEn: true, nameAr: true } } as const;
const activeLinks = { process: { deletedAt: null } } satisfies Prisma.ObjectLinkWhereInput;
const appRefSelect = {
  objectId: true,
  lifecycle: true,
  appType: true,
  object: { select: { code: true, nameEn: true, nameAr: true, deletedAt: true } },
} as const;
const procRef = { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } };

const applicationInclude = {
  _count: { select: { links: { where: activeLinks } } },
  application: {
    include: {
      businessOwner: userRef,
      itOwner: userRef,
      department: deptRef,
      capabilities: {
        where: { capability: { deletedAt: null } },
        include: { capability: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
      },
      _count: {
        select: {
          outgoing: { where: { deletedAt: null } },
          incoming: { where: { deletedAt: null } },
        },
      },
    },
  },
} satisfies Prisma.RepoObjectInclude;

const interfaceInclude = {
  source: { select: appRefSelect },
  target: { select: appRefSelect },
  owner: userRef,
  dataObjects: {
    where: { dataObject: { deletedAt: null } },
    include: {
      dataObject: {
        select: { id: true, code: true, nameEn: true, nameAr: true, classification: true },
      },
    },
  },
} satisfies Prisma.AppInterfaceInclude;

const dataObjectInclude = {
  systemOfRecord: { select: appRefSelect },
  owner: userRef,
  usages: {
    where: { application: { object: { deletedAt: null } } },
    include: { application: { select: appRefSelect } },
  },
  _count: { select: { interfaces: { where: { interface: { deletedAt: null } } } } },
} satisfies Prisma.DataObjectInclude;

const capabilityInclude = {
  owner: userRef,
  processes: {
    where: { process: { deletedAt: null } },
    include: { process: procRef },
  },
  applications: {
    where: { application: { object: { deletedAt: null } } },
    include: { application: { select: appRefSelect } },
  },
} satisfies Prisma.CapabilityInclude;

type AppRow = Prisma.RepoObjectGetPayload<{ include: typeof applicationInclude }>;
type InterfaceRow = Prisma.AppInterfaceGetPayload<{ include: typeof interfaceInclude }>;
type DataObjectRow = Prisma.DataObjectGetPayload<{ include: typeof dataObjectInclude }>;
type CapabilityRow = Prisma.CapabilityGetPayload<{ include: typeof capabilityInclude }>;
type AppRefRow = Prisma.ApplicationGetPayload<{ select: typeof appRefSelect }>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);
const codeOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

export const toAppRef = (a: AppRefRow): ApplicationRef => ({
  id: a.objectId,
  code: a.object.code,
  nameEn: a.object.nameEn,
  nameAr: a.object.nameAr,
  lifecycle: a.lifecycle,
  appType: a.appType,
});

export function toApplicationDto(o: AppRow): ApplicationDto {
  const a = o.application!;
  return {
    id: o.id,
    code: o.code,
    nameEn: o.nameEn,
    nameAr: o.nameAr,
    descriptionEn: o.descriptionEn,
    descriptionAr: o.descriptionAr,
    appType: a.appType,
    vendor: a.vendor,
    version: a.version,
    businessOwner: a.businessOwner ?? null,
    itOwner: a.itOwner ?? null,
    department: a.department ?? null,
    hosting: a.hosting,
    hostingCountry: a.hostingCountry,
    lifecycle: a.lifecycle,
    liveFrom: iso(a.liveFrom),
    phaseOutFrom: iso(a.phaseOutFrom),
    retiredAt: iso(a.retiredAt),
    criticality: a.criticality,
    dataClassification: a.dataClassification,
    licenceNotes: a.licenceNotes,
    url: a.url,
    stepCount: o._count.links,
    interfaceCount: a._count.outgoing + a._count.incoming,
    capabilities: a.capabilities.map((c) => c.capability),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toInterfaceDto(i: InterfaceRow): InterfaceDto {
  return {
    id: i.id,
    code: i.code,
    nameEn: i.nameEn,
    nameAr: i.nameAr,
    descriptionEn: i.descriptionEn,
    descriptionAr: i.descriptionAr,
    source: toAppRef(i.source),
    target: toAppRef(i.target),
    direction: i.direction,
    technology: i.technology,
    frequency: i.frequency,
    owner: i.owner ?? null,
    status: i.status,
    dataObjects: i.dataObjects.map((d) => d.dataObject),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function toDataObjectDto(d: DataObjectRow): DataObjectDto {
  return {
    id: d.id,
    code: d.code,
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    definitionEn: d.definitionEn,
    definitionAr: d.definitionAr,
    classification: d.classification,
    systemOfRecord:
      d.systemOfRecord && !d.systemOfRecord.object.deletedAt ? toAppRef(d.systemOfRecord) : null,
    owner: d.owner ?? null,
    usages: d.usages.map((u) => ({
      application: toAppRef(u.application),
      create: u.canCreate,
      read: u.canRead,
      update: u.canUpdate,
      delete: u.canDelete,
    })),
    interfaceCount: d._count.interfaces,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toCapabilityDto(c: CapabilityRow): CapabilityDto {
  return {
    id: c.id,
    code: c.code,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    descriptionEn: c.descriptionEn,
    descriptionAr: c.descriptionAr,
    parentId: c.parentId,
    level: c.level,
    sortOrder: c.sortOrder,
    owner: c.owner ?? null,
    importance: c.importance,
    processes: c.processes.map((p) => ({
      ...p.process,
      status: p.process.status as ProcessStatus,
    })),
    applications: c.applications.map((a) => toAppRef(a.application)),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Sorts and pages in memory (counts are computed; catalogues have hundreds of rows, not millions). */
export function pageOf<T>(
  items: T[],
  q: { page: number; pageSize: number; sort?: string; order: 'asc' | 'desc' },
  sorters: Record<string, (x: T) => string | number>,
  fallback: string,
): Paginated<T> {
  const key = sorters[q.sort ?? ''] ? q.sort! : fallback;
  const get = sorters[key];
  const dir = q.order === 'desc' ? -1 : 1;
  const sorted = [...items].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return compareNatural(String(va), String(vb)) * dir;
  });
  const start = (q.page - 1) * q.pageSize;
  return {
    items: sorted.slice(start, start + q.pageSize),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
  };
}

const matches = (q: string | undefined, ...values: (string | null | undefined)[]) =>
  !q || values.some((v) => v?.toLowerCase().includes(q.toLowerCase()));

const APP_FIELDS = [
  'appType',
  'vendor',
  'version',
  'businessOwnerId',
  'itOwnerId',
  'departmentId',
  'hosting',
  'hostingCountry',
  'lifecycle',
  'liveFrom',
  'phaseOutFrom',
  'retiredAt',
  'criticality',
  'dataClassification',
  'licenceNotes',
  'url',
];
const NAME_FIELDS = ['code', 'nameEn', 'nameAr', 'descriptionEn', 'descriptionAr'];

@Injectable()
export class EaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Reference checks ----------

  private async assertUsers(tx: Tx, ...userIds: (string | null | undefined)[]) {
    const wanted = [...new Set(userIds.filter((v): v is string => !!v))];
    if (!wanted.length) return;
    const n = await tx.user.count({ where: { id: { in: wanted }, deletedAt: null } });
    if (n !== wanted.length) throw badRequest('INVALID_OWNER');
  }

  private async assertDepartment(tx: Tx, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const d = await tx.department.findFirst({ where: { id: departmentId, deletedAt: null } });
    if (!d) throw badRequest('INVALID_DEPARTMENT');
  }

  private async assertApplications(tx: Tx, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    if (!wanted.length) return;
    const n = await tx.application.count({
      where: { objectId: { in: wanted }, object: { deletedAt: null } },
    });
    if (n !== wanted.length) throw badRequest('INVALID_APPLICATION');
  }

  private async assertCapabilities(tx: Tx, ids: string[] | undefined) {
    if (!ids?.length) return;
    const n = await tx.capability.count({ where: { id: { in: ids }, deletedAt: null } });
    if (n !== ids.length) throw badRequest('INVALID_CAPABILITY');
  }

  private async assertProcesses(tx: Tx, ids: string[] | undefined) {
    if (!ids?.length) return;
    const n = await tx.process.count({ where: { id: { in: ids }, deletedAt: null } });
    if (n !== ids.length) throw badRequest('INVALID_PROCESS');
  }

  private async assertDataObjects(tx: Tx, ids: string[] | undefined) {
    if (!ids?.length) return;
    const n = await tx.dataObject.count({ where: { id: { in: ids }, deletedAt: null } });
    if (n !== ids.length) throw badRequest('INVALID_DATA_OBJECT');
  }

  // ---------- Applications ----------

  /**
   * IT system objects created outside the catalogue (seed scripts, older imports) get their
   * application row here, as the migration did for existing ones (D-107).
   */
  async ensureApplicationRows() {
    const missing = await this.prisma.repoObject.findMany({
      where: { type: 'SYSTEM', application: { is: null } },
      select: { id: true },
    });
    if (missing.length)
      await this.prisma.application.createMany({
        data: missing.map((m) => ({ objectId: m.id })),
        skipDuplicates: true,
      });
  }

  async listApplications(q: ApplicationListQuery): Promise<Paginated<ApplicationDto>> {
    await this.ensureApplicationRows();
    const rows = await this.prisma.repoObject.findMany({
      where: {
        type: 'SYSTEM',
        deletedAt: null,
        ...(q.processId ? { links: { some: { processId: q.processId } } } : {}),
        application: {
          is: {
            appType: q.appType,
            lifecycle: q.lifecycle,
            criticality: q.criticality,
            hosting: q.hosting,
            departmentId: q.departmentId,
            ...(q.ownerId
              ? { OR: [{ businessOwnerId: q.ownerId }, { itOwnerId: q.ownerId }] }
              : {}),
            ...(q.capabilityId ? { capabilities: { some: { capabilityId: q.capabilityId } } } : {}),
          },
        },
      },
      include: applicationInclude,
    });
    let items = rows.map(toApplicationDto);
    if (q.q) items = items.filter((a) => matches(q.q, a.code, a.nameEn, a.nameAr, a.vendor));
    if (q.endOfLifeInUse !== undefined)
      items = items.filter(
        (a) => (isEndOfLife(a.lifecycle) && a.stepCount > 0) === q.endOfLifeInUse,
      );
    return pageOf(
      items,
      q,
      {
        code: (x) => x.code ?? '',
        nameEn: (x) => x.nameEn,
        lifecycle: (x) => x.lifecycle,
        criticality: (x) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(x.criticality),
        stepCount: (x) => x.stepCount,
        interfaceCount: (x) => x.interfaceCount,
        updatedAt: (x) => x.updatedAt,
      },
      'nameEn',
    );
  }

  private async findApplication(id: string) {
    const o = await this.prisma.repoObject.findFirst({
      where: { id, type: 'SYSTEM', deletedAt: null },
      include: { application: true },
    });
    if (!o) throw notFound('Application');
    // SYSTEM objects created before the catalogue (or through the library) get their row lazily.
    if (!o.application)
      o.application = await this.prisma.application.create({ data: { objectId: id } });
    return o as typeof o & { application: NonNullable<typeof o.application> };
  }

  async getApplicationDto(id: string): Promise<ApplicationDto> {
    await this.findApplication(id);
    const row = await this.prisma.repoObject.findUniqueOrThrow({
      where: { id },
      include: applicationInclude,
    });
    return toApplicationDto(row);
  }

  async getApplication(id: string): Promise<ApplicationDetailDto> {
    const item = await this.getApplicationDto(id);
    const [interfaces, usages, records, steps] = await Promise.all([
      this.prisma.appInterface.findMany({
        where: { deletedAt: null, OR: [{ sourceId: id }, { targetId: id }] },
        include: interfaceInclude,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dataObjectUsage.findMany({
        where: { applicationId: id, dataObject: { deletedAt: null } },
        include: { dataObject: true },
      }),
      this.prisma.dataObject.findMany({ where: { systemOfRecordId: id, deletedAt: null } }),
      this.steps([id]),
    ]);
    const data = new Map<string, ApplicationDetailDto['dataObjects'][number]>();
    for (const r of records)
      data.set(r.id, {
        id: r.id,
        code: r.code,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        classification: r.classification,
        create: false,
        read: false,
        update: false,
        delete: false,
        systemOfRecord: true,
      });
    for (const u of usages)
      data.set(u.dataObjectId, {
        id: u.dataObject.id,
        code: u.dataObject.code,
        nameEn: u.dataObject.nameEn,
        nameAr: u.dataObject.nameAr,
        classification: u.dataObject.classification,
        create: u.canCreate,
        read: u.canRead,
        update: u.canUpdate,
        delete: u.canDelete,
        systemOfRecord: records.some((r) => r.id === u.dataObjectId),
      });
    return {
      item,
      interfaces: interfaces.map(toInterfaceDto),
      dataObjects: [...data.values()].sort((a, b) =>
        compareNatural(a.code ?? a.nameEn, b.code ?? b.nameEn),
      ),
      steps: (steps.get(id) ?? []).map(({ step }) => step),
    };
  }

  /** Steps of active processes linked to the given library objects (with their bilingual labels). */
  async steps(objectIds: string[]): Promise<Map<string, { linkId: string; step: EaStepDto }[]>> {
    const links = await this.prisma.objectLink.findMany({
      where: { repoObjectId: { in: objectIds }, ...activeLinks },
      include: { process: procRef },
      orderBy: [{ process: { code: 'asc' } }, { bpmnElementId: 'asc' }],
    });
    const labels = await this.labels([...new Set(links.map((l) => l.processId))]);
    const out = new Map<string, { linkId: string; step: EaStepDto }[]>();
    const seen = new Set<string>();
    for (const l of links) {
      // One entry per step even when an object is linked with several relations.
      const key = `${l.repoObjectId}|${l.processId}|${l.bpmnElementId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = out.get(l.repoObjectId) ?? [];
      list.push({
        linkId: l.id,
        step: {
          process: { ...l.process, status: l.process.status as ProcessStatus },
          bpmnElementId: l.bpmnElementId,
          element: elementLabel(labels.get(l.processId) ?? new Map(), l.bpmnElementId),
        },
      });
      out.set(l.repoObjectId, list);
    }
    return out;
  }

  async labels(processIds: string[]) {
    const models = await this.prisma.processModel.findMany({
      where: { processId: { in: processIds } },
      select: { processId: true, bpmnXml: true },
    });
    return new Map<string, Map<string, BpmnElementLabel>>(
      models.map((m) => [m.processId, extractBpmnLabels(m.bpmnXml)]),
    );
  }

  private appData(input: CreateApplicationInput | UpdateApplicationInput) {
    return {
      appType: input.appType,
      vendor: input.vendor,
      version: input.version,
      businessOwnerId: input.businessOwnerId,
      itOwnerId: input.itOwnerId,
      departmentId: input.departmentId,
      hosting: input.hosting,
      hostingCountry: input.hostingCountry,
      lifecycle: input.lifecycle,
      liveFrom: toDate(input.liveFrom),
      phaseOutFrom: toDate(input.phaseOutFrom),
      retiredAt: toDate(input.retiredAt),
      criticality: input.criticality,
      dataClassification: input.dataClassification,
      licenceNotes: input.licenceNotes,
      url: input.url,
    };
  }

  private async assertAppRefs(tx: Tx, input: CreateApplicationInput | UpdateApplicationInput) {
    await this.assertUsers(tx, input.businessOwnerId, input.itOwnerId);
    await this.assertDepartment(tx, input.departmentId);
    await this.assertCapabilities(tx, input.capabilityIds);
  }

  async createApplication(input: CreateApplicationInput, actor: AuthUser, meta: RequestMeta) {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertAppRefs(tx, input);
      const o = await tx.repoObject.create({
        data: {
          type: 'SYSTEM',
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          createdById: actor.id,
          updatedById: actor.id,
          application: { create: this.appData(input) },
        },
      });
      if (input.capabilityIds?.length)
        await tx.capabilityApplication.createMany({
          data: input.capabilityIds.map((capabilityId) => ({ capabilityId, applicationId: o.id })),
        });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Application',
          entityId: o.id,
          userId: actor.id,
          summary: {
            after: {
              code: o.code,
              nameEn: o.nameEn,
              nameAr: o.nameAr,
              lifecycle: input.lifecycle ?? 'ACTIVE',
            },
          },
          meta,
        },
        tx,
      );
      return o.id;
    });
    return this.getApplication(id);
  }

  async updateApplication(
    id: string,
    input: UpdateApplicationInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const before = await this.findApplication(id);
    await this.prisma.$transaction(async (tx) => {
      await this.assertAppRefs(tx, input);
      const o = await tx.repoObject.update({
        where: { id },
        data: {
          code: codeOrNull(input.code),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          updatedById: actor.id,
        },
      });
      const a = await tx.application.update({ where: { objectId: id }, data: this.appData(input) });
      let capabilities: { added: string[]; removed: string[] } | null = null;
      if (input.capabilityIds) {
        const current = await tx.capabilityApplication.findMany({ where: { applicationId: id } });
        const added = input.capabilityIds.filter((c) => !current.some((x) => x.capabilityId === c));
        const removed = current
          .filter((x) => !input.capabilityIds!.includes(x.capabilityId))
          .map((x) => x.capabilityId);
        if (removed.length)
          await tx.capabilityApplication.deleteMany({
            where: { applicationId: id, capabilityId: { in: removed } },
          });
        if (added.length)
          await tx.capabilityApplication.createMany({
            data: added.map((capabilityId) => ({ capabilityId, applicationId: id })),
          });
        if (added.length || removed.length) capabilities = { added, removed };
      }
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Application',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: {
              ...diffFields(before, o, NAME_FIELDS),
              ...diffFields(before.application, a, APP_FIELDS),
            },
            ...(capabilities ? { capabilities } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getApplication(id);
  }

  /** Soft-deletes the library object; its step links go with it (as in the object library). */
  async removeApplication(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findApplication(id);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.objectLink.deleteMany({ where: { repoObjectId: id } });
      const interfaces = await tx.appInterface.updateMany({
        where: { deletedAt: null, OR: [{ sourceId: id }, { targetId: id }] },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await tx.dataObjectUsage.deleteMany({ where: { applicationId: id } });
      await tx.capabilityApplication.deleteMany({ where: { applicationId: id } });
      await tx.repoObject.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Application',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr },
            removedLinks: removed.count,
            removedInterfaces: interfaces.count,
          },
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Interfaces ----------

  async listInterfaces(q: InterfaceListQuery): Promise<Paginated<InterfaceDto>> {
    const rows = await this.prisma.appInterface.findMany({
      where: {
        deletedAt: null,
        source: { object: { deletedAt: null } },
        target: { object: { deletedAt: null } },
        technology: q.technology,
        status: q.status,
        ...(q.applicationId
          ? { OR: [{ sourceId: q.applicationId }, { targetId: q.applicationId }] }
          : {}),
        ...(q.dataObjectId ? { dataObjects: { some: { dataObjectId: q.dataObjectId } } } : {}),
      },
      include: interfaceInclude,
    });
    let items = rows.map(toInterfaceDto);
    if (q.q)
      items = items.filter((i) =>
        matches(
          q.q,
          i.code,
          i.nameEn,
          i.nameAr,
          i.source.nameEn,
          i.source.nameAr,
          i.target.nameEn,
          i.target.nameAr,
        ),
      );
    return pageOf(
      items,
      q,
      {
        code: (x) => x.code ?? '',
        nameEn: (x) => x.nameEn,
        source: (x) => x.source.nameEn,
        target: (x) => x.target.nameEn,
        technology: (x) => x.technology,
        status: (x) => x.status,
        updatedAt: (x) => x.updatedAt,
      },
      'source',
    );
  }

  private async findInterface(id: string) {
    const i = await this.prisma.appInterface.findFirst({ where: { id, deletedAt: null } });
    if (!i) throw notFound('Interface');
    return i;
  }

  async getInterface(id: string): Promise<InterfaceDto> {
    await this.findInterface(id);
    return toInterfaceDto(
      await this.prisma.appInterface.findUniqueOrThrow({
        where: { id },
        include: interfaceInclude,
      }),
    );
  }

  private async replaceInterfaceData(tx: Tx, interfaceId: string, ids: string[]) {
    await tx.interfaceDataObject.deleteMany({ where: { interfaceId } });
    if (ids.length)
      await tx.interfaceDataObject.createMany({
        data: ids.map((dataObjectId) => ({ interfaceId, dataObjectId })),
      });
  }

  async createInterface(input: CreateInterfaceInput, actor: AuthUser, meta: RequestMeta) {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertApplications(tx, [input.sourceId, input.targetId]);
      await this.assertUsers(tx, input.ownerId);
      await this.assertDataObjects(tx, input.dataObjectIds);
      const i = await tx.appInterface.create({
        data: {
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          sourceId: input.sourceId,
          targetId: input.targetId,
          direction: input.direction,
          technology: input.technology,
          frequency: input.frequency,
          ownerId: input.ownerId ?? null,
          status: input.status,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      if (input.dataObjectIds?.length)
        await this.replaceInterfaceData(tx, i.id, input.dataObjectIds);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'AppInterface',
          entityId: i.id,
          userId: actor.id,
          summary: {
            after: {
              code: i.code,
              sourceId: i.sourceId,
              targetId: i.targetId,
              technology: i.technology,
            },
          },
          meta,
        },
        tx,
      );
      return i.id;
    });
    return this.getInterface(id);
  }

  async updateInterface(
    id: string,
    input: UpdateInterfaceInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const before = await this.findInterface(id);
    const source = input.sourceId ?? before.sourceId;
    const target = input.targetId ?? before.targetId;
    if (source === target) throw badRequest('SAME_APPLICATION');
    await this.prisma.$transaction(async (tx) => {
      await this.assertApplications(tx, [input.sourceId, input.targetId]);
      await this.assertUsers(tx, input.ownerId);
      await this.assertDataObjects(tx, input.dataObjectIds);
      const after = await tx.appInterface.update({
        where: { id },
        data: {
          code: codeOrNull(input.code),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          sourceId: input.sourceId,
          targetId: input.targetId,
          direction: input.direction,
          technology: input.technology,
          frequency: input.frequency,
          ownerId: input.ownerId,
          status: input.status,
          updatedById: actor.id,
        },
      });
      if (input.dataObjectIds) await this.replaceInterfaceData(tx, id, input.dataObjectIds);
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'AppInterface',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: diffFields(before, after, [
              ...NAME_FIELDS,
              'sourceId',
              'targetId',
              'direction',
              'technology',
              'frequency',
              'ownerId',
              'status',
            ]),
            ...(input.dataObjectIds ? { dataObjectIds: input.dataObjectIds } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getInterface(id);
  }

  async removeInterface(id: string, actor: AuthUser, meta: RequestMeta) {
    const i = await this.findInterface(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.appInterface.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'AppInterface',
          entityId: id,
          userId: actor.id,
          summary: { before: { code: i.code, sourceId: i.sourceId, targetId: i.targetId } },
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Data objects ----------

  async listDataObjects(q: DataObjectListQuery): Promise<Paginated<DataObjectDto>> {
    const rows = await this.prisma.dataObject.findMany({
      where: {
        deletedAt: null,
        classification: q.classification,
        ...(q.applicationId
          ? {
              OR: [
                { systemOfRecordId: q.applicationId },
                { usages: { some: { applicationId: q.applicationId } } },
              ],
            }
          : {}),
      },
      include: dataObjectInclude,
    });
    let items = rows.map(toDataObjectDto);
    if (q.q) items = items.filter((d) => matches(q.q, d.code, d.nameEn, d.nameAr));
    return pageOf(
      items,
      q,
      {
        code: (x) => x.code ?? '',
        nameEn: (x) => x.nameEn,
        classification: (x) => x.classification,
        updatedAt: (x) => x.updatedAt,
      },
      'nameEn',
    );
  }

  private async findDataObject(id: string) {
    const d = await this.prisma.dataObject.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Data object');
    return d;
  }

  async getDataObject(id: string): Promise<DataObjectDto> {
    await this.findDataObject(id);
    return toDataObjectDto(
      await this.prisma.dataObject.findUniqueOrThrow({ where: { id }, include: dataObjectInclude }),
    );
  }

  private async replaceUsages(tx: Tx, dataObjectId: string, usages: CrudInput[]) {
    const distinct = [...new Map(usages.map((u) => [u.applicationId, u])).values()].filter(
      (u) => u.create || u.read || u.update || u.delete,
    );
    await this.assertApplications(
      tx,
      distinct.map((u) => u.applicationId),
    );
    await tx.dataObjectUsage.deleteMany({ where: { dataObjectId } });
    if (distinct.length)
      await tx.dataObjectUsage.createMany({
        data: distinct.map((u) => ({
          dataObjectId,
          applicationId: u.applicationId,
          canCreate: u.create,
          canRead: u.read,
          canUpdate: u.update,
          canDelete: u.delete,
        })),
      });
    return distinct.map(
      (u) =>
        `${u.applicationId}:${u.create ? 'C' : ''}${u.read ? 'R' : ''}${u.update ? 'U' : ''}${u.delete ? 'D' : ''}`,
    );
  }

  async createDataObject(input: CreateDataObjectInput, actor: AuthUser, meta: RequestMeta) {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertApplications(tx, [input.systemOfRecordId]);
      await this.assertUsers(tx, input.ownerId);
      const d = await tx.dataObject.create({
        data: {
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          definitionEn: input.definitionEn ?? '',
          definitionAr: input.definitionAr ?? '',
          classification: input.classification,
          systemOfRecordId: input.systemOfRecordId ?? null,
          ownerId: input.ownerId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      const usages = input.usages ? await this.replaceUsages(tx, d.id, input.usages) : [];
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'DataObject',
          entityId: d.id,
          userId: actor.id,
          summary: { after: { code: d.code, nameEn: d.nameEn, nameAr: d.nameAr, usages } },
          meta,
        },
        tx,
      );
      return d.id;
    });
    return this.getDataObject(id);
  }

  async updateDataObject(
    id: string,
    input: UpdateDataObjectInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const before = await this.findDataObject(id);
    await this.prisma.$transaction(async (tx) => {
      await this.assertApplications(tx, [input.systemOfRecordId]);
      await this.assertUsers(tx, input.ownerId);
      const after = await tx.dataObject.update({
        where: { id },
        data: {
          code: codeOrNull(input.code),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          definitionEn: input.definitionEn,
          definitionAr: input.definitionAr,
          classification: input.classification,
          systemOfRecordId: input.systemOfRecordId,
          ownerId: input.ownerId,
          updatedById: actor.id,
        },
      });
      const usages = input.usages ? await this.replaceUsages(tx, id, input.usages) : null;
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'DataObject',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: diffFields(before, after, [
              'code',
              'nameEn',
              'nameAr',
              'definitionEn',
              'definitionAr',
              'classification',
              'systemOfRecordId',
              'ownerId',
            ]),
            ...(usages ? { usages } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getDataObject(id);
  }

  async removeDataObject(id: string, actor: AuthUser, meta: RequestMeta) {
    const d = await this.findDataObject(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.dataObjectUsage.deleteMany({ where: { dataObjectId: id } });
      await tx.interfaceDataObject.deleteMany({ where: { dataObjectId: id } });
      await tx.dataObject.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'DataObject',
          entityId: id,
          userId: actor.id,
          summary: { before: { code: d.code, nameEn: d.nameEn, nameAr: d.nameAr } },
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Capabilities ----------

  /** The whole capability map (flat, parent before child, by sort order). */
  async listCapabilities(): Promise<CapabilityDto[]> {
    const rows = await this.prisma.capability.findMany({
      where: { deletedAt: null },
      include: capabilityInclude,
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toCapabilityDto);
  }

  private async findCapability(id: string) {
    const c = await this.prisma.capability.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw notFound('Capability');
    return c;
  }

  async getCapability(id: string): Promise<CapabilityDto> {
    await this.findCapability(id);
    return toCapabilityDto(
      await this.prisma.capability.findUniqueOrThrow({ where: { id }, include: capabilityInclude }),
    );
  }

  /** Level of a capability under the given parent; deeper than level 3 is refused. */
  private async levelUnder(tx: Tx, parentId: string | null | undefined, self?: string) {
    if (!parentId) return 1;
    if (parentId === self) throw badRequest('INVALID_PARENT');
    const parent = await tx.capability.findFirst({ where: { id: parentId, deletedAt: null } });
    if (!parent) throw badRequest('INVALID_PARENT');
    // A capability cannot move below one of its own descendants.
    let cursor: string | null = parent.parentId;
    while (cursor) {
      if (cursor === self) throw badRequest('INVALID_PARENT');
      const up: { parentId: string | null } | null = await tx.capability.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = up?.parentId ?? null;
    }
    const level = parent.level + 1;
    if (level > CAPABILITY_MAX_LEVEL) throw badRequest('CAPABILITY_TOO_DEEP');
    return level;
  }

  /** Depth of the subtree below a capability (0 = no children). */
  private async subtreeDepth(tx: Tx, id: string): Promise<number> {
    const children = await tx.capability.findMany({
      where: { parentId: id, deletedAt: null },
      select: { id: true },
    });
    let depth = 0;
    for (const c of children) depth = Math.max(depth, 1 + (await this.subtreeDepth(tx, c.id)));
    return depth;
  }

  private async setLevels(tx: Tx, parentId: string, level: number) {
    const children = await tx.capability.findMany({
      where: { parentId, deletedAt: null },
      select: { id: true },
    });
    for (const c of children) {
      await tx.capability.update({ where: { id: c.id }, data: { level: level + 1 } });
      await this.setLevels(tx, c.id, level + 1);
    }
  }

  private async replaceCapabilityLinks(
    tx: Tx,
    id: string,
    input: { processIds?: string[]; applicationIds?: string[] },
  ) {
    if (input.processIds) {
      await this.assertProcesses(tx, input.processIds);
      await tx.capabilityProcess.deleteMany({ where: { capabilityId: id } });
      if (input.processIds.length)
        await tx.capabilityProcess.createMany({
          data: input.processIds.map((processId) => ({ capabilityId: id, processId })),
        });
    }
    if (input.applicationIds) {
      await this.assertApplications(tx, input.applicationIds);
      await tx.capabilityApplication.deleteMany({ where: { capabilityId: id } });
      if (input.applicationIds.length)
        await tx.capabilityApplication.createMany({
          data: input.applicationIds.map((applicationId) => ({ capabilityId: id, applicationId })),
        });
    }
  }

  async createCapability(input: CreateCapabilityInput, actor: AuthUser, meta: RequestMeta) {
    const id = await this.prisma.$transaction(async (tx) => {
      const level = await this.levelUnder(tx, input.parentId);
      await this.assertUsers(tx, input.ownerId);
      const sortOrder =
        input.sortOrder ??
        (await tx.capability.count({
          where: { parentId: input.parentId ?? null, deletedAt: null },
        }));
      const c = await tx.capability.create({
        data: {
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          parentId: input.parentId ?? null,
          level,
          sortOrder,
          ownerId: input.ownerId ?? null,
          importance: input.importance,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.replaceCapabilityLinks(tx, c.id, input);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Capability',
          entityId: c.id,
          userId: actor.id,
          summary: {
            after: {
              code: c.code,
              nameEn: c.nameEn,
              nameAr: c.nameAr,
              level,
              parentId: c.parentId,
            },
          },
          meta,
        },
        tx,
      );
      return c.id;
    });
    return this.getCapability(id);
  }

  async updateCapability(
    id: string,
    input: UpdateCapabilityInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const before = await this.findCapability(id);
    await this.prisma.$transaction(async (tx) => {
      let level: number | undefined;
      if (input.parentId !== undefined && input.parentId !== before.parentId) {
        level = await this.levelUnder(tx, input.parentId, id);
        if (level + (await this.subtreeDepth(tx, id)) > CAPABILITY_MAX_LEVEL)
          throw badRequest('CAPABILITY_TOO_DEEP');
      }
      await this.assertUsers(tx, input.ownerId);
      const after = await tx.capability.update({
        where: { id },
        data: {
          code: codeOrNull(input.code),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          parentId: input.parentId,
          level,
          sortOrder: input.sortOrder,
          ownerId: input.ownerId,
          importance: input.importance,
          updatedById: actor.id,
        },
      });
      if (level !== undefined) await this.setLevels(tx, id, level);
      await this.replaceCapabilityLinks(tx, id, input);
      await this.audit.log(
        {
          action: level !== undefined ? 'MOVE' : 'UPDATE',
          entityType: 'Capability',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: diffFields(before, after, [
              ...NAME_FIELDS,
              'parentId',
              'level',
              'sortOrder',
              'ownerId',
              'importance',
            ]),
            ...(input.processIds ? { processIds: input.processIds } : {}),
            ...(input.applicationIds ? { applicationIds: input.applicationIds } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getCapability(id);
  }

  /** Only leaf capabilities can be deleted (sub-capabilities first). */
  async removeCapability(id: string, actor: AuthUser, meta: RequestMeta) {
    const c = await this.findCapability(id);
    const children = await this.prisma.capability.count({
      where: { parentId: id, deletedAt: null },
    });
    if (children) throw conflict('CAPABILITY_HAS_CHILDREN');
    await this.prisma.$transaction(async (tx) => {
      await tx.capabilityProcess.deleteMany({ where: { capabilityId: id } });
      await tx.capabilityApplication.deleteMany({ where: { capabilityId: id } });
      await tx.capability.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Capability',
          entityId: id,
          userId: actor.id,
          summary: { before: { code: c.code, nameEn: c.nameEn, nameAr: c.nameAr } },
          meta,
        },
        tx,
      );
    });
  }
}
