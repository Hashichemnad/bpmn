import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  SETTING_KEYS,
  epcToBpmn,
  parseDiagramContent,
  resolveDiagramTheme,
  type ConvertEpcInput,
  type EpcConversionResultDto,
  type GraphContent,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, forbidden } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ProcessesService } from '../processes/processes.service';
import { ModelsService } from '../models/models.service';
import { structureToBpmn, type PreservedElement } from '../ai/bpmn/structure-to-bpmn';
import type { ProcessStructure } from '../ai/bpmn/process-structure';
import { DiagramsService } from './diagrams.service';

/**
 * EPC → BPMN (D-124): converts the working content of an EPC into a new draft process with the
 * shared layered layout and theme colours, links the systems / documents of its functions and
 * returns the mapping report. The EPC itself is not changed.
 */
@Injectable()
export class EpcConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly diagrams: DiagramsService,
    private readonly processes: ProcessesService,
    private readonly models: ModelsService,
  ) {}

  async convert(
    id: string,
    input: ConvertEpcInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<EpcConversionResultDto> {
    const d = await this.diagrams.findActive(id);
    if (d.type !== 'EPC') throw badRequest('NOT_EPC', 'Only EPC diagrams can be converted');
    if (
      !actor.permissions.has(PERMISSIONS.MODELS_EDIT) &&
      !actor.permissions.has(PERMISSIONS.MODELS_EDIT_OWN)
    )
      throw forbidden('You cannot create process models');
    const parsed = parseDiagramContent('EPC', d.content);
    if (!parsed.ok || !parsed.content) throw badRequest('INVALID_DIAGRAM');
    const conversion = epcToBpmn(parsed.content as GraphContent, {
      nameEn: input.nameEn ?? d.nameEn,
      nameAr: input.nameAr ?? d.nameAr,
    });
    if (!conversion.structure.nodes.length)
      throw badRequest('EMPTY_DIAGRAM', 'The EPC has no elements to convert');
    const preserve = new Map<string, PreservedElement>();
    for (const [el, processId] of conversion.linkedProcesses)
      preserve.set(el, { linkedProcessId: processId });
    for (const [lane, roleId] of conversion.laneRoles) preserve.set(lane, { roleId });
    const themeRow = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DIAGRAM_THEME },
    });
    const bpmnXml = structureToBpmn(conversion.structure as ProcessStructure, {
      key: randomBytes(4).toString('hex'),
      preserve,
      theme: resolveDiagramTheme(themeRow?.value),
    });
    const process = await this.processes.create(
      {
        code: input.code,
        nameEn: input.nameEn ?? d.nameEn,
        nameAr: input.nameAr ?? d.nameAr,
        descriptionEn: d.descriptionEn,
        descriptionAr: d.descriptionAr,
        category: input.category,
        parentId: input.parentId ?? null,
        ownerId: d.ownerId,
        departmentId: d.departmentId,
      },
      actor,
      meta,
    );
    // The new process belongs to the EPC's owner; model rights are checked for the converter.
    await this.models.saveModel(
      process.id,
      bpmnXml,
      { ...actor, permissions: new Set([...actor.permissions, PERMISSIONS.MODELS_EDIT]) },
      meta,
    );
    let linked = 0;
    for (const l of conversion.objectLinks) {
      const exists = await this.prisma.repoObject.findFirst({
        where: { id: l.objectId, type: l.kind, deletedAt: null },
      });
      if (!exists) continue;
      await this.models.createLink(
        process.id,
        {
          bpmnElementId: l.elementId,
          repoObjectId: l.objectId,
          relation: l.kind === 'SYSTEM' ? 'SUPPORTS' : 'INPUT',
        },
        { ...actor, permissions: new Set([...actor.permissions, PERMISSIONS.MODELS_EDIT]) },
        meta,
      );
      linked++;
    }
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'Diagram',
      entityId: id,
      userId: actor.id,
      summary: { convertedTo: { processId: process.id, code: process.code }, objectLinks: linked },
      meta,
    });
    return { processId: process.id, code: process.code, report: conversion.report };
  }
}
