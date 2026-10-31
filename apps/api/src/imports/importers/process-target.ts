import type { Prisma, ProcessCategory } from '@prisma/client';
import {
  PERMISSIONS,
  findProcessCodes,
  type ImportChange,
  type ImportIssue,
  type ImportMatchBy,
  type ImportSuggestion,
} from '@processhub/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ParseContext, ParsedItem } from '../importer';
import { issue, norm } from './tabular';

/** Name of a file without folders and extension. */
export const baseName = (path: string) =>
  (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').trim();

export interface ProcessRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: string;
  ownerId: string | null;
  hasModel: boolean;
}

export interface ProcessTarget {
  action: ParsedItem['action'];
  matchId: string | null;
  matchBy: ImportMatchBy | null;
  /** Code for a new process taken from the file name (when free). */
  code: string | null;
  issues: ImportIssue[];
  changes: ImportChange[];
}

/** Loads processes once per parse for matching diagrams to processes. */
export async function loadProcessRefs(prisma: PrismaService): Promise<ProcessRef[]> {
  const rows = await prisma.process.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      status: true,
      ownerId: true,
      model: { select: { processId: true } },
    },
  });
  return rows.map(({ model, ...p }) => ({ ...p, hasModel: !!model }));
}

/**
 * Where a diagram goes (D-156): by process code in the file name, then an earlier import of the
 * same external id / file name, then the exact process name — or a new draft process.
 */
export async function matchProcess(
  ctx: ParseContext,
  processes: ProcessRef[],
  file: string,
  externalKeys: string[],
  names: { nameEn: string; nameAr: string },
): Promise<ProcessTarget> {
  const issues: ImportIssue[] = [];
  const codes = findProcessCodes(baseName(file));
  const byCode = new Map(processes.map((p) => [norm(p.code), p]));
  const fileCode = codes.find((c) => byCode.has(norm(c))) ?? null;
  let match: ProcessRef | undefined;
  let matchBy: ImportMatchBy | null = null;
  if ((ctx.options.attachTo ?? 'MATCH_OR_CREATE') === 'MATCH_OR_CREATE') {
    if (fileCode) {
      match = byCode.get(norm(fileCode));
      matchBy = 'CODE';
    }
    if (!match) {
      const prev = await ctx.previous('PROCESS', externalKeys);
      const id = externalKeys.map((k) => prev.get(k)).find(Boolean);
      match = id ? processes.find((p) => p.id === id) : undefined;
      if (match) matchBy = 'FILE_NAME';
    }
    if (!match) {
      const wanted = [names.nameEn, names.nameAr, baseName(file)].map(norm).filter(Boolean);
      const hits = processes.filter(
        (p) => wanted.includes(norm(p.nameEn)) || wanted.includes(norm(p.nameAr)),
      );
      if (hits.length === 1) {
        match = hits[0];
        matchBy = 'NAME';
      } else if (hits.length > 1)
        issues.push(issue('WARNING', 'AMBIGUOUS_NAME', { count: hits.length }));
    }
  }
  const freeCode = codes.find((c) => !byCode.has(norm(c))) ?? null;
  // Process Owners (import.own, D-164): only their own processes, new ones under their own parent.
  const owner = !ctx.actor.permissions.has(PERMISSIONS.IMPORT_MANAGE);
  if (owner && match && match.ownerId !== ctx.actor.id)
    return {
      action: 'SKIP',
      matchId: match.id,
      matchBy,
      code: null,
      issues: [...issues, issue('ERROR', 'NOT_OWN_PROCESS', { code: match.code })],
      changes: [],
    };
  if (!match) {
    if (owner && !ctx.options.parentProcessId) issues.push(issue('ERROR', 'OWN_PARENT_REQUIRED'));
    return { action: 'CREATE', matchId: null, matchBy: null, code: freeCode, issues, changes: [] };
  }
  let action: ParsedItem['action'] = 'UPDATE';
  if (ctx.options.updateExisting === false) action = 'SKIP';
  else if (match.status !== 'DRAFT') {
    action = 'SKIP';
    issues.push(issue('WARNING', 'NOT_DRAFT_SKIPPED', { status: match.status }));
  } else if (match.hasModel) issues.push(issue('WARNING', 'MODEL_REPLACED', { code: match.code }));
  return {
    action,
    matchId: match.id,
    matchBy,
    code: null,
    issues,
    changes: [{ field: 'model', from: match.hasModel ? match.code : null, to: file }],
  };
}

/** Next free child code ("C.02" → "C.02.03") or root code ("C.07") for a new process. */
export async function nextProcessCode(
  tx: Prisma.TransactionClient,
  parent: { code: string } | null,
  category: ProcessCategory,
): Promise<string> {
  const prefix = parent ? `${parent.code}.` : `${category[0]}.`;
  const rows = await tx.process.findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  });
  let max = 0;
  for (const r of rows) {
    const rest = r.code.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

/** Creates the draft process of an imported diagram (code from the file or generated). */
export async function createDraftProcess(
  tx: Prisma.TransactionClient,
  opts: {
    parentProcessId?: string | null;
    processCategory?: ProcessCategory;
    ownerId?: string | null;
    batchId: string | null;
    actorId: string;
  },
  input: { code: string | null; nameEn: string; nameAr: string },
) {
  const parent = opts.parentProcessId
    ? await tx.process.findFirst({
        where: { id: opts.parentProcessId, deletedAt: null },
        select: { id: true, code: true, level: true, category: true },
      })
    : null;
  const category = (parent?.category ?? opts.processCategory ?? 'CORE') as ProcessCategory;
  let code = input.code;
  if (code && (await tx.process.count({ where: { code: { equals: code, mode: 'insensitive' } } })))
    code = null;
  code ??= await nextProcessCode(tx, parent, category);
  const sort = await tx.process.aggregate({
    where: { parentId: parent?.id ?? null, category, deletedAt: null },
    _max: { sortOrder: true },
  });
  return tx.process.create({
    data: {
      code,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      category,
      parentId: parent?.id ?? null,
      level: (parent?.level ?? 0) + 1,
      sortOrder: (sort._max.sortOrder ?? -1) + 1,
      ownerId: opts.ownerId ?? null,
      status: 'DRAFT',
      importBatchId: opts.batchId,
      createdById: opts.actorId,
      updatedById: opts.actorId,
    },
  });
}

const words = (s: string) =>
  norm(s)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Library suggestions for names found in a diagram: exact matches (name or synonym) are
 * pre-accepted; containment matches (≥ 4 letters) are offered unaccepted.
 */
export function librarySuggestions(
  kind: ImportSuggestion['kind'],
  found: { id: string; name: string }[],
  library: {
    id: string;
    nameEn: string;
    nameAr: string;
    synonymsEn?: string[];
    synonymsAr?: string[];
  }[],
): ImportSuggestion[] {
  const out: ImportSuggestion[] = [];
  for (const f of found) {
    const w = words(f.name);
    if (!w) continue;
    let best: { o: (typeof library)[number]; exact: boolean } | null = null;
    for (const o of library) {
      const names = [o.nameEn, o.nameAr, ...(o.synonymsEn ?? []), ...(o.synonymsAr ?? [])]
        .map(words)
        .filter((x) => x.length >= 2);
      if (names.includes(w)) {
        best = { o, exact: true };
        break;
      }
      if (
        !best &&
        w.length >= 4 &&
        names.some((n) => n.length >= 4 && (n.includes(w) || w.includes(n)))
      )
        best = { o, exact: false };
    }
    if (best)
      out.push({
        id: `${kind}:${f.id}`,
        kind,
        source: f.name,
        targetId: best.o.id,
        targetLabelEn: best.o.nameEn,
        targetLabelAr: best.o.nameAr,
        at: f.id,
        accepted: best.exact,
      });
  }
  return out;
}
