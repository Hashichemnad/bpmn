import { Injectable } from '@nestjs/common';
import { isArabicText, type ImportKind } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSafeDmnXml } from '../../diagrams/dmn-xml';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import { ImportFileError, decodeText, parseSafeXml } from '../safe-upload';
import { sourceDocs } from './bpmn.importer';
import { createImportedDiagram, updateImportedDiagram } from './aris.importer';
import { baseName } from './process-target';
import { issue } from './tabular';

interface DmnPayload {
  xml: string;
  externalKey: string;
}

/**
 * DMN 1.3 decision tables (M15 step 3) into the DMN diagram type, with the same server checks as
 * the diagram editor's import (`assertSafeDmnXml`: no DTD, no external references, no markup).
 * Matched by an earlier import of the same file name.
 */
@Injectable()
export class DmnImporter implements Importer {
  readonly kinds: ImportKind[] = ['DMN'];

  constructor(private readonly prisma: PrismaService) {}

  async parse(ctx: ParseContext) {
    const docs = await sourceDocs(ctx.files, ['dmn', 'xml']);
    if (!docs.length) throw new ImportFileError('NO_DIAGRAMS_FOUND');
    const keys = docs.map((d) => `dmn:${baseName(d.path)}`);
    const prev = await ctx.previous('DIAGRAM', keys);
    const items: ParsedItem[] = [];
    for (const [n, d] of docs.entries()) {
      await ctx.progress(n / docs.length, d.path);
      const externalKey = keys[n];
      const fileKey = baseName(d.path);
      const base = {
        ref: `file:${d.source}`,
        entity: 'DIAGRAM' as const,
        key: fileKey,
        source: d.source,
        changes: [],
        suggestions: [],
        skip: false,
      };
      try {
        const xml = decodeText(await d.read()).replace(/^\uFEFF/, '');
        const doc = parseSafeXml(xml, d.path);
        try {
          assertSafeDmnXml(xml);
        } catch {
          throw new ImportFileError('NOT_DMN', { file: d.path });
        }
        const name = doc.documentElement.getAttribute('name')?.trim() || fileKey;
        const decisions = doc.getElementsByTagNameNS('*', 'decision').length;
        const issues = decisions ? [] : [issue('WARNING', 'DMN_NO_DECISIONS')];
        const matchId = prev.get(externalKey) ?? null;
        let action: ParsedItem['action'] = matchId ? 'UPDATE' : 'CREATE';
        if (matchId) {
          const existing = await this.prisma.diagram.findUnique({ where: { id: matchId } });
          if (ctx.options.updateExisting === false) action = 'SKIP';
          else if (existing?.status !== 'DRAFT') {
            action = 'SKIP';
            issues.push(issue('WARNING', 'NOT_DRAFT_SKIPPED', { status: existing?.status ?? '' }));
          }
        }
        const arabic = isArabicText(name);
        items.push({
          ...base,
          nameEn: arabic ? '' : name,
          nameAr: arabic ? name : '',
          action,
          matchId,
          matchBy: matchId ? 'FILE_NAME' : null,
          issues,
          facts: { decisions },
          data: { xml, externalKey } satisfies DmnPayload,
        });
      } catch (e) {
        if (!(e instanceof ImportFileError)) throw e;
        items.push({
          ...base,
          nameEn: fileKey,
          nameAr: '',
          action: 'SKIP',
          matchId: null,
          matchBy: null,
          issues: [issue('ERROR', e.code, e.params)],
        });
      }
    }
    return { items };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    for (const item of items) {
      const p = item.data as DmnPayload;
      const note = `Imported from ${item.source} (${ctx.batchNumber})`;
      await ctx.step(item, async (tx) => {
        const d =
          item.action === 'UPDATE' && item.matchId
            ? await updateImportedDiagram(tx, ctx, item.matchId, p.xml, note)
            : await createImportedDiagram(tx, ctx, {
                type: 'DMN',
                nameEn: item.nameEn,
                nameAr: item.nameAr,
                content: p.xml,
                changeNote: note,
              });
        return {
          entity: 'DIAGRAM',
          entityId: d.id,
          outcome: item.action === 'UPDATE' ? 'UPDATED' : 'CREATED',
          externalKey: p.externalKey,
          key: d.code,
        };
      });
    }
  }
}
