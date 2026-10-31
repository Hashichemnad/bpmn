import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  ROLE_DEPARTMENT_ATTRIBUTE,
  parseBpmnGraph,
  isStepNode,
  type OrgSourceDto,
  type OrgSourcePerson,
  type RoleActivityDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Data behind organisation charts (D-122): departments, positions (Role objects placed in a
 * department by their `departmentId` attribute, else by the departments of the users holding the
 * job role) and, for users who may read the user directory, the people holding each role. Plus
 * what a position does: the steps it performs in the process models (lanes linked to the role and
 * PERFORMS links) with the RACI letter of the B2 report (A for approval steps, R otherwise).
 */
@Injectable()
export class OrgChartService {
  constructor(private readonly prisma: PrismaService) {}

  async source(user: AuthUser): Promise<OrgSourceDto> {
    const [departments, roles, holders] = await Promise.all([
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, nameEn: true, nameAr: true, parentId: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'ROLE', deletedAt: null },
        select: { id: true, nameEn: true, nameAr: true, attributes: true },
      }),
      this.prisma.userJobRole.findMany({
        where: { user: { deletedAt: null, status: 'ACTIVE' }, repoObject: { deletedAt: null } },
        select: {
          repoObjectId: true,
          user: { select: { id: true, nameEn: true, nameAr: true, departmentId: true } },
        },
      }),
    ]);
    const deptIds = new Set(departments.map((d) => d.id));
    const people = new Map<string, OrgSourcePerson>();
    for (const h of holders) {
      const p = people.get(h.user.id) ?? { ...h.user, roleIds: [] as string[] };
      p.roleIds.push(h.repoObjectId);
      people.set(h.user.id, p);
    }
    return {
      departments,
      roles: roles.map((r) => {
        const attr = (r.attributes as Record<string, unknown>)?.[ROLE_DEPARTMENT_ATTRIBUTE];
        const own =
          typeof attr === 'string' && UUID_RE.test(attr) && deptIds.has(attr) ? [attr] : [];
        const viaHolders = holders
          .filter((h) => h.repoObjectId === r.id && h.user.departmentId)
          .map((h) => h.user.departmentId!);
        return {
          id: r.id,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          departmentIds: own.length ? own : [...new Set(viaHolders)],
        };
      }),
      people: user.permissions.has(PERMISSIONS.USERS_READ) ? [...people.values()] : null,
    };
  }

  async roleActivities(roleId: string): Promise<RoleActivityDto[]> {
    const role = await this.prisma.repoObject.findFirst({
      where: { id: roleId, type: 'ROLE', deletedAt: null },
    });
    if (!role) throw notFound('Role');
    const links = await this.prisma.objectLink.findMany({
      where: { repoObjectId: roleId, relation: 'PERFORMS', process: { deletedAt: null } },
      include: {
        process: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
            status: true,
            model: { select: { bpmnXml: true } },
          },
        },
      },
    });
    const byProcess = new Map<string, typeof links>();
    for (const l of links) byProcess.set(l.processId, [...(byProcess.get(l.processId) ?? []), l]);
    const out: RoleActivityDto[] = [];
    for (const rows of byProcess.values()) {
      const p = rows[0].process;
      const graph = parseBpmnGraph(p.model?.bpmnXml ?? '');
      const linked = new Set(rows.map((r) => r.bpmnElementId));
      const steps = graph.nodes
        .filter(isStepNode)
        .filter((n) => linked.has(n.id) || (n.laneId !== null && linked.has(n.laneId)))
        .map((n) => ({
          id: n.id,
          nameEn: n.nameEn || n.name,
          nameAr: n.nameAr,
          letter: (n.stepType === 'approval' ? 'A' : 'R') as 'A' | 'R',
          viaLane: !linked.has(n.id),
        }));
      out.push({
        process: { id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr, status: p.status },
        steps,
      });
    }
    return out.sort((a, b) =>
      a.process.code.localeCompare(b.process.code, undefined, { numeric: true }),
    );
  }
}
