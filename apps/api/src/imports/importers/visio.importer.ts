import { Injectable } from '@nestjs/common';
import type { ImportColumnDto, ImportKind } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelsService } from '../../models/models.service';
import { structureToBpmn } from '../../ai/bpmn/structure-to-bpmn';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import { ImportFileError } from '../safe-upload';
import { applyBpmnSuggestions } from './bpmn-tools';
import { applyDiagramItems, type DiagramPayload } from './bpmn.importer';
import { baseName, librarySuggestions, loadProcessRefs, matchProcess } from './process-target';
import { issue } from './tabular';
import { applyVisioPositions, readVisio, resolveMapping } from './visio-tools';

/**
 * Visio .vsdx (M15 step 3): every page with mapped shapes becomes a BPMN draft (lanes, flows,
 * shared auto-layout). The shape mapping table (master → BPMN type) is shown with the preview
 * and can be changed per batch (`options.shapeMapping`); unmapped shapes are reported.
 */
@Injectable()
export class VisioImporter implements Importer {
  readonly kinds: ImportKind[] = ['VISIO'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
  ) {}

  async parse(ctx: ParseContext) {
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
    const mapOf = resolveMapping(ctx.options.shapeMapping);
    const masters = new Map<string, number>();
    const items: ParsedItem[] = [];
    for (const [n, f] of ctx.files.entries()) {
      await ctx.progress(n / ctx.files.length, f.fileName);
      let pages;
      try {
        pages = await readVisio(f.data, f.fileName, ctx.options.shapeMapping);
      } catch (e) {
        if (!(e instanceof ImportFileError)) throw e;
        items.push({
          ref: `file:${f.fileName}`,
          entity: 'PROCESS_MODEL',
          key: baseName(f.fileName),
          nameEn: baseName(f.fileName),
          nameAr: '',
          action: 'SKIP',
          matchId: null,
          matchBy: null,
          source: f.fileName,
          issues: [issue('ERROR', e.code, e.params)],
          changes: [],
          suggestions: [],
          skip: false,
        });
        continue;
      }
      const single = pages.filter((p) => p.structure.nodes.length).length === 1;
      for (const [i, page] of pages.entries()) {
        for (const [m, c] of page.masters) masters.set(m, (masters.get(m) ?? 0) + c);
        const s = page.structure;
        if (!s.nodes.length) continue;
        const fileKey = single ? baseName(f.fileName) : `${baseName(f.fileName)} – ${page.name}`;
        if (single) {
          s.nameEn = s.nameAr ? s.nameEn : baseName(f.fileName);
        }
        const issues = [...page.issues];
        if (!s.nodes.some((x) => x.type === 'startEvent'))
          issues.push(issue('WARNING', 'NO_START_EVENT'));
        if (!s.flows.length) issues.push(issue('WARNING', 'VISIO_NO_FLOWS'));
        let xml = structureToBpmn(s, { key: `v${n + 1}p${i + 1}` });
        if (ctx.options.visioLayout === 'KEEP') {
          // Visio's vertical swimlanes do not map onto BPMN's horizontal lanes: auto-layout then.
          if (page.verticalLanes) issues.push(issue('WARNING', 'VISIO_KEEP_VERTICAL_LANES'));
          else xml = applyVisioPositions(xml, page.positions);
        }
        const target = await matchProcess(
          ctx,
          processes,
          single ? f.fileName : fileKey,
          [fileKey],
          s,
        );
        items.push({
          ref: `file:${f.fileName}#${page.name}`,
          entity: 'PROCESS_MODEL',
          key: fileKey,
          nameEn: s.nameEn || (s.nameAr ? '' : fileKey),
          nameAr: s.nameAr,
          action: target.action,
          matchId: target.matchId,
          matchBy: target.matchBy,
          source: `${f.fileName} › ${page.name}`,
          issues: [...issues, ...target.issues],
          changes: target.changes,
          suggestions: [
            ...librarySuggestions(
              'ROLE',
              s.lanes.map((l) => ({ id: l.id, name: l.nameEn || l.nameAr })),
              roles,
            ),
            ...librarySuggestions(
              'TERM',
              s.nodes.map((x) => ({ id: x.id, name: x.nameEn || x.nameAr })),
              terms,
            ),
          ],
          skip: false,
          facts: {
            shapes: page.shapes,
            elements: s.nodes.length,
            flows: s.flows.length,
            lanes: s.lanes.length,
            unmapped: [...page.unmapped.values()].reduce((a, b) => a + b, 0),
          },
          data: { xml, code: target.code, externalKey: fileKey, fileKey } satisfies DiagramPayload,
        });
      }
    }
    if (!items.length) throw new ImportFileError('NO_DIAGRAMS_FOUND');
    // The mapping table of the preview: master name → BPMN type, with the number of shapes.
    const columns: ImportColumnDto[] = [...masters]
      .sort((a, b) => b[1] - a[1])
      .map(([m, count]) => ({ header: m, field: mapOf(m), sample: String(count) }));
    return { items, columns };
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
