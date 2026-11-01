import { Injectable } from '@nestjs/common';
import { assertAiAllowedOnItem } from '../imports/import-settings';
import { SETTING_KEYS, resolveDiagramTheme, type DiagramTheme } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { badRequest, notFound } from '../common/app-exception';
import { readBpmn, type ReadBpmn } from './bpmn/read-bpmn';
import { assertSafeBpmnXml } from '../models/bpmn-xml';
import type { ElementLinks } from './bpmn/describe';

/** Which content of a process the assistant reads. */
export type ProcessSource = { kind: 'working' } | { kind: 'version'; versionNumber: number };

/**
 * Loads process content for prompts: the BPMN as a structure (names and description from the
 * process record) and the library objects linked to each element. Rights are checked by callers.
 */
@Injectable()
export class AiContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Colour theme for generated diagrams (Settings → Branding). */
  async diagramTheme(): Promise<DiagramTheme> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DIAGRAM_THEME },
    });
    return resolveDiagramTheme(row?.value);
  }

  private async record(processId: string) {
    const p = await this.prisma.process.findFirst({
      where: { id: processId, deletedAt: null },
      include: {
        owner: { select: { nameEn: true, nameAr: true, email: true } },
        department: { select: { nameEn: true, nameAr: true } },
        model: { select: { bpmnXml: true } },
      },
    });
    if (!p) throw notFound('Process');
    return p;
  }

  /** The process with a diagram sent by the client (e.g. unsaved modeler changes). */
  async processWithXml(processId: string, xml: string) {
    assertSafeBpmnXml(xml);
    const p = await this.record(processId);
    return {
      process: p,
      xml,
      ...this.withRecord(readBpmn(xml), p),
      links: await this.links(processId),
    };
  }

  /** Refuses imported content while AI on imported documents is off (SEC-35). */
  assertAllowedOn(type: 'PROCESS' | 'PAGE' | 'DIAGRAM', id: string) {
    return assertAiAllowedOnItem(this.prisma, type, id);
  }

  async process(processId: string, source: ProcessSource = { kind: 'working' }) {
    await assertAiAllowedOnItem(this.prisma, 'PROCESS', processId);
    const p = await this.record(processId);
    let xml: string | null = null;
    if (source.kind === 'working') xml = p.model?.bpmnXml ?? null;
    else {
      const v = await this.prisma.processVersion.findUnique({
        where: { processId_versionNumber: { processId, versionNumber: source.versionNumber } },
        select: { bpmnXml: true },
      });
      if (!v) throw notFound('Version');
      xml = v.bpmnXml;
    }
    if (!xml) throw badRequest('AI_NO_DIAGRAM', 'The process has no diagram yet');
    const read = this.withRecord(readBpmn(xml), p);
    return { process: p, xml, ...read, links: await this.links(processId) };
  }

  /** The structure of a diagram sent by the client (e.g. unsaved modeler changes). */
  fromXml(
    xml: string,
    p: { nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string },
  ): ReadBpmn {
    return this.withRecord(readBpmn(xml), p);
  }

  private withRecord(
    read: ReadBpmn,
    p: { nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string },
  ): ReadBpmn {
    read.structure.nameEn = p.nameEn || read.structure.nameEn;
    read.structure.nameAr = p.nameAr || read.structure.nameAr;
    read.structure.descriptionEn = p.descriptionEn;
    read.structure.descriptionAr = p.descriptionAr;
    return read;
  }

  async links(processId: string): Promise<ElementLinks> {
    const rows = await this.prisma.objectLink.findMany({
      where: { processId, repoObject: { deletedAt: null } },
      select: {
        bpmnElementId: true,
        relation: true,
        repoObject: { select: { type: true, nameEn: true, nameAr: true } },
      },
    });
    const out: ElementLinks = {};
    for (const r of rows)
      (out[r.bpmnElementId] ??= []).push({ ...r.repoObject, relation: r.relation });
    return out;
  }
}
