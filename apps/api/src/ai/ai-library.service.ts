import { Injectable } from '@nestjs/common';
import {
  matchByName,
  normalizeTerm,
  type AiObjectRef,
  type AiSuggestedLinkDto,
  type AiGeneratedProcessDto,
  type Locale,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isActivity, type ProcessStructure } from './bpmn/process-structure';

type Entry = AiObjectRef;

/** At most this many glossary pairs are sent with one request. */
const GLOSSARY_MAX = 150;

/**
 * The organisation's library as context for the assistant: roles and IT systems to reuse in
 * generated processes (and to propose links to), and approved EN↔AR terminology for translation.
 */
@Injectable()
export class AiLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog(): Promise<{ roles: Entry[]; systems: Entry[]; documents: Entry[] }> {
    const rows = await this.prisma.repoObject.findMany({
      where: { deletedAt: null, type: { in: ['ROLE', 'SYSTEM', 'DOCUMENT'] } },
      select: { id: true, type: true, code: true, nameEn: true, nameAr: true },
      orderBy: [{ type: 'asc' }, { nameEn: 'asc' }],
      take: 2000,
    });
    return {
      roles: rows.filter((r) => r.type === 'ROLE'),
      systems: rows.filter((r) => r.type === 'SYSTEM'),
      documents: rows.filter((r) => r.type === 'DOCUMENT'),
    };
  }

  /** Text block listing roles and systems for prompts ("reuse these exact names"). */
  static catalogPrompt(c: { roles: Entry[]; systems: Entry[] }): string {
    const line = (e: Entry) => `- ${e.nameEn || e.nameAr} | ${e.nameAr || e.nameEn}`;
    return [
      'Existing roles in the library (English | Arabic):',
      ...(c.roles.length ? c.roles.slice(0, 200).map(line) : ['(none)']),
      '',
      'Existing IT systems in the library (English | Arabic):',
      ...(c.systems.length ? c.systems.slice(0, 200).map(line) : ['(none)']),
    ].join('\n');
  }

  /**
   * Links to propose for a generated structure: every activity of a lane to the matching role
   * (PERFORMS) and steps that name an IT system to the matching system (SUPPORTS).
   */
  static suggestLinks(
    s: ProcessStructure,
    c: { roles: Entry[]; systems: Entry[] },
  ): Pick<AiGeneratedProcessDto, 'suggestedLinks' | 'unmatched'> {
    const suggestedLinks: AiSuggestedLinkDto[] = [];
    const unmatched: AiGeneratedProcessDto['unmatched'] = [];
    const seenUnmatched = new Set<string>();
    const noteUnmatched = (type: 'ROLE' | 'SYSTEM', nameEn: string, nameAr: string) => {
      const key = `${type}|${normalizeTerm(nameEn || nameAr)}`;
      if (seenUnmatched.has(key)) return;
      seenUnmatched.add(key);
      unmatched.push({ type, nameEn, nameAr });
    };
    const activities = s.nodes.filter((n) => isActivity(n.type));
    for (const lane of s.lanes) {
      const role = matchByName({ en: lane.nameEn, ar: lane.nameAr }, c.roles);
      if (!role) {
        noteUnmatched('ROLE', lane.nameEn, lane.nameAr);
        continue;
      }
      for (const n of activities.filter((a) => a.lane === lane.id))
        suggestedLinks.push({
          elementId: n.id,
          elementNameEn: n.nameEn,
          elementNameAr: n.nameAr,
          object: role,
          relation: 'PERFORMS',
        });
    }
    for (const n of activities.filter((a) => a.systemEn || a.systemAr)) {
      const system = matchByName({ en: n.systemEn, ar: n.systemAr }, c.systems);
      if (!system) {
        noteUnmatched('SYSTEM', n.systemEn, n.systemAr);
        continue;
      }
      suggestedLinks.push({
        elementId: n.id,
        elementNameEn: n.nameEn,
        elementNameAr: n.nameAr,
        object: system,
        relation: 'SUPPORTS',
      });
    }
    return { suggestedLinks, unmatched };
  }

  /**
   * Approved translations (library objects incl. approved dictionary terms, and process names)
   * whose source-language term occurs
   * in the text, as "source → target" lines for the translation prompt.
   */
  async glossary(text: string, source: Locale): Promise<string[]> {
    const [objects, processes] = await Promise.all([
      this.prisma.repoObject.findMany({
        // Proposed (draft) dictionary terms are not approved terminology yet.
        where: { deletedAt: null, status: 'APPROVED', nameEn: { not: '' }, nameAr: { not: '' } },
        select: { nameEn: true, nameAr: true },
        take: 3000,
      }),
      this.prisma.process.findMany({
        where: { deletedAt: null, nameEn: { not: '' }, nameAr: { not: '' } },
        select: { nameEn: true, nameAr: true },
        take: 3000,
      }),
    ]);
    const haystack = ` ${normalizeTerm(text)} `;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const e of [...objects, ...processes]) {
      const from = source === 'en' ? e.nameEn : e.nameAr;
      const to = source === 'en' ? e.nameAr : e.nameEn;
      const key = normalizeTerm(from);
      if (!key || seen.has(key) || !haystack.includes(` ${key} `)) continue;
      seen.add(key);
      out.push(`${from} → ${to}`);
      if (out.length >= GLOSSARY_MAX) break;
    }
    return out;
  }
}
