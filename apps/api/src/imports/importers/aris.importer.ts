import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { epcIssues, type DiagramType, type ImportKind } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertValidContent, nextDiagramCode } from '../../diagrams/diagrams.service';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import { ImportFileError, decodeText } from '../safe-upload';
import { readAml, type ArisModel, type ArisObject } from './aris-tools';
import { sourceDocs } from './bpmn.importer';
import { baseName } from './process-target';
import { issue, norm } from './tabular';

interface ObjectPayload {
  kind: 'object';
  externalKey: string;
  type: 'ROLE' | 'SYSTEM';
  defId: string;
}
interface ModelPayload {
  kind: 'model';
  externalKey: string;
  type: DiagramType;
  content: string;
  /** Node id → external key of the library object it shows. */
  objectNodes: [string, string][];
}

/** Creates a draft diagram of an import (generated code, owner, parent process). */
export async function createImportedDiagram(
  tx: Prisma.TransactionClient,
  ctx: ApplyContext,
  input: { type: DiagramType; nameEn: string; nameAr: string; content: string; changeNote: string },
) {
  const code = await nextDiagramCode(tx, input.type);
  const d = await tx.diagram.create({
    data: {
      type: input.type,
      code,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      processId: ctx.options.parentProcessId ?? null,
      ownerId: ctx.options.defaultOwnerId ?? ctx.actor.id,
      content: input.content,
      contentUpdatedById: ctx.actor.id,
      importBatchId: ctx.batchId,
      createdById: ctx.actor.id,
      updatedById: ctx.actor.id,
    },
  });
  await tx.diagramVersion.create({
    data: {
      diagramId: d.id,
      versionNumber: 1,
      content: input.content,
      changeNote: input.changeNote,
      createdById: ctx.actor.id,
    },
  });
  return d;
}

/** New content of an existing draft diagram (re-import) as the next version. */
export async function updateImportedDiagram(
  tx: Prisma.TransactionClient,
  ctx: ApplyContext,
  id: string,
  content: string,
  changeNote: string,
) {
  const d = await tx.diagram.findFirstOrThrow({ where: { id, deletedAt: null } });
  if (d.status !== 'DRAFT') throw new Error('NOT_DRAFT');
  const last = await tx.diagramVersion.aggregate({
    where: { diagramId: id },
    _max: { versionNumber: true },
  });
  await tx.diagram.update({
    where: { id },
    data: {
      content,
      contentUpdatedAt: new Date(),
      contentUpdatedById: ctx.actor.id,
      updatedById: ctx.actor.id,
    },
  });
  await tx.diagramVersion.create({
    data: {
      diagramId: id,
      versionNumber: (last._max.versionNumber ?? 0) + 1,
      content,
      changeNote,
      createdById: ctx.actor.id,
    },
  });
  return d;
}

/**
 * ARIS AML exports (M15 step 3, D-160): roles / org units and application systems into the
 * library (matched by name or an earlier import), EPCs into the EPC diagram type (then the
 * existing EPC → BPMN conversion on the diagram page), value-added chains into value chains.
 */
@Injectable()
export class ArisImporter implements Importer {
  readonly kinds: ImportKind[] = ['ARIS'];

  constructor(private readonly prisma: PrismaService) {}

  async parse(ctx: ParseContext) {
    const docs = await sourceDocs(ctx.files, ['xml', 'aml']);
    const library = await this.prisma.repoObject.findMany({
      where: { type: { in: ['ROLE', 'SYSTEM'] }, deletedAt: null },
      select: { id: true, type: true, nameEn: true, nameAr: true },
    });
    const items: ParsedItem[] = [];
    const batchIssues = [];
    for (const [n, d] of docs.entries()) {
      await ctx.progress(n / docs.length, d.path);
      const aml = readAml(decodeText(await d.read()), d.path);
      if (aml.skipped.length)
        batchIssues.push(
          issue('WARNING', 'ARIS_MODELS_SKIPPED', {
            count: aml.skipped.length,
            types: [...new Set(aml.skipped.map((s) => s.typeNum))].join(', '),
          }),
        );
      const objKey = (o: ArisObject) => `aris:${o.guid}`;
      const prevObjects = await ctx.previous('REPO_OBJECT', aml.objects.map(objKey));
      // Objects first (order 0), so diagrams can link to them.
      for (const o of aml.objects) {
        const prev = prevObjects.get(objKey(o));
        const byName = library.find(
          (l) =>
            l.type === o.type &&
            ((o.nameEn && norm(l.nameEn) === norm(o.nameEn)) ||
              (o.nameAr && norm(l.nameAr) === norm(o.nameAr))),
        );
        const matchId = prev ?? byName?.id ?? null;
        items.push({
          ref: `object:${d.source}#${o.id}`,
          entity: 'REPO_OBJECT',
          key: o.type,
          nameEn: o.nameEn,
          nameAr: o.nameAr,
          action: matchId ? 'SKIP' : 'CREATE',
          matchId,
          matchBy: prev ? 'EXTERNAL_ID' : byName ? 'NAME' : null,
          source: d.source,
          issues: matchId ? [issue('WARNING', 'LIBRARY_OBJECT_EXISTS')] : [],
          changes: [],
          suggestions: [],
          skip: false,
          order: 0,
          data: {
            kind: 'object',
            externalKey: objKey(o),
            type: o.type,
            defId: o.id,
          } satisfies ObjectPayload,
        });
      }
      const defKey = new Map(aml.objects.map((o) => [o.id, objKey(o)]));
      const modelKey = (m: ArisModel) => `aris:${m.guid}`;
      const prevModels = await ctx.previous('DIAGRAM', aml.models.map(modelKey));
      for (const m of aml.models) {
        const content = JSON.stringify(m.content);
        const issues = [...m.issues];
        try {
          assertValidContent(m.kind, content);
        } catch {
          issues.push(issue('ERROR', 'INVALID_DIAGRAM'));
        }
        if (m.kind === 'EPC')
          for (const x of epcIssues(m.content).slice(0, 5))
            issues.push(issue('WARNING', `EPC_${x.code}`, { element: x.elementId ?? '' }));
        const prev = prevModels.get(modelKey(m));
        let action: ParsedItem['action'] = 'CREATE';
        if (prev) {
          const existing = await this.prisma.diagram.findUnique({ where: { id: prev } });
          if (ctx.options.updateExisting === false) action = 'SKIP';
          else if (existing?.status !== 'DRAFT') {
            action = 'SKIP';
            issues.push(issue('WARNING', 'NOT_DRAFT_SKIPPED', { status: existing?.status ?? '' }));
          } else action = 'UPDATE';
        }
        items.push({
          ref: `model:${d.source}#${m.id}`,
          entity: 'DIAGRAM',
          key: m.kind,
          nameEn: m.nameEn || (m.nameAr ? '' : baseName(d.path)),
          nameAr: m.nameAr,
          action,
          matchId: prev ?? null,
          matchBy: prev ? 'EXTERNAL_ID' : null,
          source: d.source,
          issues,
          changes: [],
          suggestions: [],
          skip: false,
          order: 1,
          facts: {
            elements: m.content.nodes.length,
            flows: m.content.edges.length,
            objects: m.objectNodes.size,
          },
          data: {
            kind: 'model',
            externalKey: modelKey(m),
            type: m.kind,
            content,
            objectNodes: [...m.objectNodes].map(([node, def]) => [node, defKey.get(def) ?? '']),
          } satisfies ModelPayload,
        });
      }
    }
    if (!items.length) throw new ImportFileError('NO_DIAGRAMS_FOUND');
    return { items, issues: batchIssues };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[], all?: ParsedItem[]) {
    // External key → library object id: matched (skipped) objects and those created now.
    const objectIds = new Map<string, string>();
    for (const i of all ?? items)
      if ((i.data as ObjectPayload).kind === 'object' && i.matchId)
        objectIds.set((i.data as ObjectPayload).externalKey, i.matchId);
    for (const item of items) {
      const p = item.data as ObjectPayload | ModelPayload;
      if (p.kind === 'object') {
        const res = await ctx.step(item, async (tx) => {
          const o = await tx.repoObject.create({
            data: {
              type: p.type,
              nameEn: item.nameEn,
              nameAr: item.nameAr,
              status: 'APPROVED',
              ownerId: ctx.options.defaultOwnerId ?? null,
              importBatchId: ctx.batchId,
              createdById: ctx.actor.id,
              updatedById: ctx.actor.id,
            },
          });
          return {
            entity: 'REPO_OBJECT',
            entityId: o.id,
            outcome: 'CREATED',
            externalKey: p.externalKey,
          };
        });
        if (res?.[0]?.entityId) objectIds.set(p.externalKey, res[0].entityId);
        continue;
      }
      const note = `Imported from ${item.source} (${ctx.batchNumber})`;
      // Resource shapes point at their library object.
      const content = JSON.parse(p.content) as { nodes: { id: string; objectId?: string }[] };
      const links: [string, string][] = [];
      for (const [node, key] of p.objectNodes) {
        const id = objectIds.get(key);
        const n = content.nodes.find((x) => x.id === node);
        if (id && n) {
          n.objectId = id;
          links.push([node, id]);
        }
      }
      const json = JSON.stringify(content);
      await ctx.step(item, async (tx) => {
        const d =
          item.action === 'UPDATE' && item.matchId
            ? await updateImportedDiagram(tx, ctx, item.matchId, json, note)
            : await createImportedDiagram(tx, ctx, {
                type: p.type,
                nameEn: item.nameEn,
                nameAr: item.nameAr,
                content: json,
                changeNote: note,
              });
        const objects = await tx.repoObject.findMany({
          where: { id: { in: links.map((l) => l[1]) } },
          select: { id: true, type: true },
        });
        await tx.diagramLink.deleteMany({ where: { diagramId: d.id } });
        for (const [elementId, repoObjectId] of links) {
          const type = objects.find((o) => o.id === repoObjectId)?.type;
          if (!type) continue;
          await tx.diagramLink.create({
            data: {
              diagramId: d.id,
              elementId,
              repoObjectId,
              relation: type === 'SYSTEM' ? 'SUPPORTS' : 'PERFORMS',
              createdById: ctx.actor.id,
            },
          });
        }
        return {
          entity: 'DIAGRAM',
          entityId: d.id,
          outcome: item.action === 'UPDATE' ? 'UPDATED' : 'CREATED',
          externalKey: p.externalKey,
          key: d.code,
          after: { type: p.type, links: links.length },
        };
      });
    }
  }
}
