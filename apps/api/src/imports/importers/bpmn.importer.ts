import { Injectable } from '@nestjs/common';
import type { ImportKind } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelsService } from '../../models/models.service';
import type { RequestMeta } from '../../common/auth-user';
import type {
  ApplyContext,
  Importer,
  LoadedImportFile,
  ParseContext,
  ParsedItem,
} from '../importer';
import { ImportFileError, decodeText, extensionOf, openSafeZip } from '../safe-upload';
import { analyseBpmn, applyBpmnSuggestions } from './bpmn-tools';
import {
  baseName,
  createDraftProcess,
  librarySuggestions,
  loadProcessRefs,
  matchProcess,
} from './process-target';
import { issue } from './tabular';

export const JOB_META: RequestMeta = { ip: null, userAgent: 'import-center' };

/** A document inside the upload: a file or an entry of a ZIP. */
export interface SourceDoc {
  path: string;
  source: string;
  read(): Promise<Buffer>;
}

/** Files of the batch with the given extensions, ZIP archives expanded (safely). */
export async function sourceDocs(files: LoadedImportFile[], exts: string[]): Promise<SourceDoc[]> {
  const out: SourceDoc[] = [];
  for (const f of files) {
    if (f.ext === 'zip') {
      const zip = await openSafeZip(f.data, f.fileName);
      for (const e of zip.entries) {
        if (/(^|\/)(__MACOSX|\.)/.test(e.path)) continue;
        if (!exts.includes(extensionOf(e.path))) continue;
        out.push({
          path: e.path,
          source: `${f.fileName} › ${e.path}`,
          read: () => zip.read(e.path),
        });
      }
    } else out.push({ path: f.fileName, source: f.fileName, read: async () => f.data });
  }
  return out;
}

export interface DiagramPayload {
  xml: string;
  code: string | null;
  externalKey: string;
  fileKey: string;
}

/**
 * Bulk BPMN 2.0 import (M15 step 3): .bpmn / .xml files or a ZIP of them (Signavio, Camunda,
 * Bizagi, ARIS …). Each document becomes the working model (+ version 1) of a matched or new
 * draft process; lanes are matched to library roles and labels to dictionary terms.
 */
@Injectable()
export class BpmnImporter implements Importer {
  readonly kinds: ImportKind[] = ['BPMN'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
  ) {}

  async parse(ctx: ParseContext) {
    const docs = await sourceDocs(ctx.files, ['bpmn', 'xml']);
    if (!docs.length) throw new ImportFileError('NO_DIAGRAMS_FOUND');
    const [processes, roles, terms] = await Promise.all([
      loadProcessRefs(this.prisma),
      this.prisma.repoObject.findMany({
        where: { type: 'ROLE', deletedAt: null },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'TERM', status: 'APPROVED', deletedAt: null },
        select: { id: true, nameEn: true, nameAr: true, synonymsEn: true, synonymsAr: true },
      }),
    ]);
    const items: ParsedItem[] = [];
    for (const [n, d] of docs.entries()) {
      await ctx.progress(n / docs.length, d.path);
      const ref = `file:${d.source}`;
      const fileKey = baseName(d.path);
      try {
        const a = analyseBpmn(decodeText(await d.read()), d.path, {
          stripVendor: (ctx.options.vendorExtensions ?? 'STRIP') === 'STRIP',
          layout: ctx.options.autoLayout ?? 'MISSING',
          key: `imp${n + 1}`,
        });
        const externalKey = fileKey;
        const names = { nameEn: a.nameEn || (a.nameAr ? '' : fileKey), nameAr: a.nameAr };
        const target = await matchProcess(ctx, processes, d.path, [fileKey], names);
        items.push({
          ref,
          entity: 'PROCESS_MODEL',
          key: fileKey,
          nameEn: names.nameEn,
          nameAr: names.nameAr,
          action: target.action,
          matchId: target.matchId,
          matchBy: target.matchBy,
          source: d.source,
          issues: [...a.issues, ...target.issues],
          changes: target.changes,
          suggestions: [
            ...librarySuggestions('ROLE', a.lanes, roles),
            ...librarySuggestions('TERM', a.labels, terms),
          ],
          skip: false,
          facts: {
            elements: a.elements,
            flows: a.flows,
            lanes: a.lanes.length,
            language: a.arabic ? 'AR' : 'EN',
            layout: a.laidOut ? 'auto' : 'file',
          },
          data: { xml: a.xml, code: target.code, externalKey, fileKey } satisfies DiagramPayload,
        });
      } catch (e) {
        if (!(e instanceof ImportFileError)) throw e;
        items.push({
          ref,
          entity: 'PROCESS_MODEL',
          key: fileKey,
          nameEn: fileKey,
          nameAr: '',
          action: 'SKIP',
          matchId: null,
          matchBy: null,
          source: d.source,
          issues: [issue('ERROR', e.code, e.params)],
          changes: [],
          suggestions: [],
          skip: false,
        });
      }
    }
    return { items };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    await applyDiagramItems(ctx, items, this.models, (item, xml) => {
      const roles = new Map<string, string>();
      const terms = new Map<string, string>();
      for (const s of item.suggestions.filter((x) => x.accepted && x.at))
        (s.kind === 'ROLE' ? roles : terms).set(s.at!, s.targetId);
      return applyBpmnSuggestions(xml, roles, terms);
    });
  }
}

/**
 * Writes imported BPMN models: a draft process when needed (step 1), then the working model and
 * version 1 through the modeler's own save (lane roles and label references become object links).
 */
export async function applyDiagramItems(
  ctx: ApplyContext,
  items: ParsedItem[],
  models: ModelsService,
  finalXml: (item: ParsedItem, xml: string) => string,
) {
  for (const item of items) {
    const d = item.data as DiagramPayload;
    let processId = item.action === 'UPDATE' ? item.matchId : null;
    if (!processId) {
      const created = await ctx.step(item, async (tx) => {
        const p = await createDraftProcess(
          tx,
          {
            parentProcessId: ctx.options.parentProcessId,
            processCategory: ctx.options.processCategory,
            ownerId: ctx.options.defaultOwnerId,
            batchId: ctx.batchId,
            actorId: ctx.actor.id,
          },
          {
            code: d.code,
            nameEn: item.nameEn,
            nameAr: item.nameAr,
          },
        );
        return {
          entity: 'PROCESS',
          entityId: p.id,
          outcome: 'CREATED',
          externalKey: d.externalKey,
          key: p.code,
          after: { code: p.code, file: item.source },
        };
      });
      processId = created?.[0]?.entityId ?? null;
      if (!processId) continue;
    }
    const pid = processId;
    await ctx.step(item, async (tx) => {
      const before = await tx.processModel.findUnique({
        where: { processId: pid },
        select: { bpmnXml: true },
      });
      const p = await tx.process.findFirstOrThrow({ where: { id: pid, deletedAt: null } });
      if (p.status !== 'DRAFT') throw new Error('NOT_DRAFT');
      await models.createVersion(
        pid,
        {
          bpmnXml: finalXml(item, d.xml),
          changeNote: `Imported from ${item.source} (${ctx.batchNumber})`,
        },
        ctx.actor,
        JOB_META,
      );
      if (item.action === 'UPDATE')
        await tx.process.update({ where: { id: pid }, data: { updatedById: ctx.actor.id } });
      return [
        {
          entity: 'PROCESS_MODEL',
          entityId: pid,
          outcome: before ? 'UPDATED' : 'CREATED',
          externalKey: d.fileKey,
          key: p.code,
          before: before ? { bytes: before.bpmnXml.length } : null,
          after: { bytes: d.xml.length, file: item.source },
        },
        ...(item.action === 'UPDATE'
          ? [
              {
                entity: 'PROCESS' as const,
                entityId: pid,
                outcome: 'UPDATED' as const,
                externalKey: d.externalKey,
                key: p.code,
              },
            ]
          : []),
      ];
    });
  }
}
