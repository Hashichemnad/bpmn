import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type ContentRefDto,
  type ContentStatus,
  type ContentType,
  type DiagramType,
  type ProcessCategory,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DocsAccessService } from '../docs/docs-access.service';
import { canEditModel, canEditProcess } from '../processes/processes.service';
import { AUDIT_ENTITY } from './edit-guard';
import { forbidden, notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';

/** A process or page as seen by the governance workflow. */
export interface ContentItem {
  type: ContentType;
  id: string;
  status: ContentStatus;
  titleEn: string;
  titleAr: string;
  code?: string;
  spaceId?: string;
  category?: ProcessCategory;
  /** Diagrams: the notation. */
  diagramType?: DiagramType;
  departmentId: string | null;
  ownerId: string | null;
  workflowId: string | null;
  /** Pages: the default workflow of the space. */
  spaceWorkflowId?: string | null;
  nextReviewAt: Date | null;
  latestVersion: number | null;
  updatedAt: Date;
  canRead: boolean;
  canEdit: boolean;
  /** Configure the workflow and review date, archive / restore. */
  canManage: boolean;
}

export const userRefSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;

/** In-app path of an item in the workspace. */
export function itemLink(item: Pick<ContentItem, 'type' | 'id' | 'spaceId'>, suffix = ''): string {
  if (item.type === 'DIAGRAM') return `/diagrams/${item.id}${suffix}`;
  return item.type === 'PROCESS'
    ? `/processes/${item.id}${suffix}`
    : `/docs/${item.spaceId}/pages/${item.id}${suffix}`;
}

export function toRef(item: ContentItem): ContentRefDto {
  return {
    entityType: item.type,
    entityId: item.id,
    titleEn: item.titleEn,
    titleAr: item.titleAr,
    ...(item.code ? { code: item.code } : {}),
    ...(item.spaceId ? { spaceId: item.spaceId } : {}),
    ...(item.diagramType ? { diagramType: item.diagramType } : {}),
  };
}

/** Notification params identifying an item. */
export const itemParams = (item: ContentItem) => ({
  titleEn: item.titleEn,
  titleAr: item.titleAr,
  ...(item.code ? { code: item.code } : {}),
});

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docsAccess: DocsAccessService,
  ) {}

  /** Loads an active item with the user's rights. Throws NOT_FOUND if it cannot be read. */
  async load(type: ContentType, id: string, user: AuthUser | null): Promise<ContentItem> {
    const item = await this.find(type, id, user);
    if (!item || (user && !item.canRead)) throw notFound(AUDIT_ENTITY[type]);
    return item;
  }

  async find(type: ContentType, id: string, user: AuthUser | null): Promise<ContentItem | null> {
    const manage = !!user?.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE);
    if (type === 'PROCESS') {
      const p = await this.prisma.process.findFirst({ where: { id, deletedAt: null } });
      if (!p) return null;
      const last = await this.prisma.processVersion.aggregate({
        where: { processId: id },
        _max: { versionNumber: true },
      });
      const owner = !!user && p.ownerId === user.id;
      return {
        type,
        id,
        status: p.status as ContentStatus,
        titleEn: p.nameEn,
        titleAr: p.nameAr,
        code: p.code,
        category: p.category as ProcessCategory,
        departmentId: p.departmentId,
        ownerId: p.ownerId,
        workflowId: p.workflowId,
        nextReviewAt: p.nextReviewAt,
        latestVersion: last._max.versionNumber ?? null,
        updatedAt: p.updatedAt,
        canRead: !!user?.permissions.has(PERMISSIONS.PROCESSES_READ),
        canEdit: !!user && (canEditModel(user, p) || canEditProcess(user, p)),
        canManage: !!user && (manage || owner || user.permissions.has(PERMISSIONS.PROCESSES_EDIT)),
      };
    }
    if (type === 'DIAGRAM') {
      const d = await this.prisma.diagram.findFirst({
        where: { id, deletedAt: null },
        include: { process: { select: { category: true } } },
      });
      if (!d) return null;
      const last = await this.prisma.diagramVersion.aggregate({
        where: { diagramId: id },
        _max: { versionNumber: true },
      });
      const owner = !!user && d.ownerId === user.id;
      return {
        type,
        id,
        status: d.status as ContentStatus,
        titleEn: d.nameEn,
        titleAr: d.nameAr,
        code: d.code,
        diagramType: d.type as DiagramType,
        // The parent process's category picks the category default workflow (D-120).
        category: d.process?.category as ProcessCategory | undefined,
        departmentId: d.departmentId,
        ownerId: d.ownerId,
        workflowId: d.workflowId,
        nextReviewAt: d.nextReviewAt,
        latestVersion: last._max.versionNumber ?? null,
        updatedAt: d.updatedAt,
        canRead: !!user?.permissions.has(PERMISSIONS.PROCESSES_READ),
        canEdit: !!user && (canEditModel(user, d) || canEditProcess(user, d)),
        canManage: !!user && (manage || owner || user.permissions.has(PERMISSIONS.PROCESSES_EDIT)),
      };
    }
    const page = await this.prisma.page.findFirst({
      where: { id, deletedAt: null, space: { deletedAt: null } },
      include: { space: { include: { grants: true } } },
    });
    if (!page) return null;
    const access = user
      ? this.docsAccess.access(user, page.space)
      : { canView: false, canEdit: false, canManage: false };
    const ownerId = page.ownerId ?? page.space.ownerId;
    return {
      type,
      id,
      status: page.status as ContentStatus,
      titleEn: page.titleEn,
      titleAr: page.titleAr,
      spaceId: page.spaceId,
      departmentId: page.space.departmentId,
      ownerId,
      workflowId: page.workflowId,
      spaceWorkflowId: page.space.workflowId,
      nextReviewAt: page.nextReviewAt,
      latestVersion: page.version > 0 ? page.version : null,
      updatedAt: page.updatedAt,
      canRead: access.canView,
      canEdit: access.canEdit,
      canManage:
        !!user &&
        access.canView &&
        (manage || access.canManage || (!!ownerId && ownerId === user.id)),
    };
  }

  /**
   * IDs of the given items the user may publish — `canRead && (canEdit || canManage)` of `find`,
   * computed for many items with one query per type instead of `find` per item.
   */
  async publishableIds(
    type: ContentType,
    rows: { id: string; ownerId: string | null; spaceId?: string; spaceOwnerId?: string | null }[],
    user: AuthUser,
  ): Promise<Set<string>> {
    const manage = user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE);
    if (type !== 'PAGE') {
      if (!user.permissions.has(PERMISSIONS.PROCESSES_READ)) return new Set();
      return new Set(
        rows
          .filter(
            (r) =>
              canEditModel(user, r) ||
              canEditProcess(user, r) ||
              manage ||
              r.ownerId === user.id ||
              user.permissions.has(PERMISSIONS.PROCESSES_EDIT),
          )
          .map((r) => r.id),
      );
    }
    const spaces = await this.prisma.space.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.spaceId!))] }, deletedAt: null },
      include: { grants: true },
    });
    const accessBySpace = new Map(spaces.map((sp) => [sp.id, this.docsAccess.access(user, sp)]));
    return new Set(
      rows
        .filter((r) => {
          const access = accessBySpace.get(r.spaceId!);
          if (!access?.canView) return false;
          const ownerId = r.ownerId ?? r.spaceOwnerId ?? null;
          return access.canEdit || manage || access.canManage || (!!ownerId && ownerId === user.id);
        })
        .map((r) => r.id),
    );
  }

  /** Titles of many items at once (deleted items included, so history keeps its labels). */
  async refs(
    keys: { entityType: ContentType; entityId: string }[],
  ): Promise<Map<string, ContentRefDto>> {
    const ids = (t: ContentType) => [
      ...new Set(keys.filter((k) => k.entityType === t).map((k) => k.entityId)),
    ];
    const [processes, pages, diagrams] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: ids('PROCESS') } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.page.findMany({
        where: { id: { in: ids('PAGE') } },
        select: { id: true, titleEn: true, titleAr: true, spaceId: true },
      }),
      this.prisma.diagram.findMany({
        where: { id: { in: ids('DIAGRAM') } },
        select: { id: true, code: true, nameEn: true, nameAr: true, type: true },
      }),
    ]);
    const map = new Map<string, ContentRefDto>();
    for (const p of processes) {
      map.set(`PROCESS:${p.id}`, {
        entityType: 'PROCESS',
        entityId: p.id,
        titleEn: p.nameEn,
        titleAr: p.nameAr,
        code: p.code,
      });
    }
    for (const d of diagrams) {
      map.set(`DIAGRAM:${d.id}`, {
        entityType: 'DIAGRAM',
        entityId: d.id,
        titleEn: d.nameEn,
        titleAr: d.nameAr,
        code: d.code,
        diagramType: d.type as DiagramType,
      });
    }
    for (const p of pages) {
      map.set(`PAGE:${p.id}`, {
        entityType: 'PAGE',
        entityId: p.id,
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        spaceId: p.spaceId,
      });
    }
    return map;
  }

  /** Ids of pages the user may read (restricted spaces filtered out). */
  async readablePageFilter(user: AuthUser) {
    if (!user.permissions.has(PERMISSIONS.DOCS_READ)) return { spaceIds: [] as string[] };
    return { spaceIds: await this.docsAccess.visibleSpaceIds(user) };
  }

  /** True when the working BPMN model differs from the latest version. */
  async hasUnversionedChanges(item: ContentItem): Promise<boolean> {
    if (item.type === 'DIAGRAM') {
      const [d, version] = await Promise.all([
        this.prisma.diagram.findUnique({ where: { id: item.id }, select: { content: true } }),
        item.latestVersion
          ? this.prisma.diagramVersion.findUnique({
              where: {
                diagramId_versionNumber: { diagramId: item.id, versionNumber: item.latestVersion },
              },
              select: { content: true },
            })
          : null,
      ]);
      return !!d && (!version || version.content !== d.content);
    }
    if (item.type !== 'PROCESS') return false;
    const [model, version] = await Promise.all([
      this.prisma.processModel.findUnique({
        where: { processId: item.id },
        select: { bpmnXml: true },
      }),
      item.latestVersion
        ? this.prisma.processVersion.findUnique({
            where: {
              processId_versionNumber: { processId: item.id, versionNumber: item.latestVersion },
            },
            select: { bpmnXml: true },
          })
        : null,
    ]);
    if (!model) return false;
    return !version || version.bpmnXml !== model.bpmnXml;
  }

  async users(ids: (string | null | undefined)[]): Promise<Map<string, UserRef>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: userRefSelect,
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  assertCanManage(item: ContentItem) {
    if (!item.canManage) throw forbidden('You cannot manage the lifecycle of this item');
  }
}
