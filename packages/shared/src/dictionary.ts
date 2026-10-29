import { decodeXml } from './bpmn-validation';
import type { LabelSourceType, Locale } from './constants';

/**
 * Dictionary (Modeler design B2): approved business terms, roles and IT systems suggested while a
 * modeler types a label. Matching is case-insensitive and tolerant of the usual Arabic spelling
 * variants, so "اداره" finds "إدارة" and "Approve" finds "approval".
 */

// Tashkeel (harakat, shadda, sukun, superscript alef) and tatweel.
const ARABIC_MARKS = /[ً-ٰٟـ]/g;

/** Lower-cased, trimmed, single-spaced text with Arabic letter variants folded together. */
export function normaliseSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the autocomplete ranks: a library object with its names and synonyms. */
export interface SuggestionCandidate {
  id: string;
  type: LabelSourceType;
  nameEn: string;
  nameAr: string;
  synonymsEn?: string[];
  synonymsAr?: string[];
}

export interface RankedSuggestion<T extends SuggestionCandidate> {
  candidate: T;
  score: number;
  /** The synonym that matched (null when a name matched). */
  synonym: string | null;
}

const TYPE_ORDER: Record<LabelSourceType, number> = { TERM: 0, ROLE: 1, SYSTEM: 2 };

/** 100 exact, 80 prefix, 60 a word starts with the query, 40 contains it, 0 no match. */
function matchScore(text: string, query: string): number {
  const t = normaliseSearchText(text);
  if (!t) return 0;
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  if (t.split(' ').some((w) => w.startsWith(query))) return 60;
  return t.includes(query) ? 40 : 0;
}

/**
 * Ranks candidates for what the user typed: names in the active language first, then names in the
 * other language, then synonyms; ties go to terms, then roles, then systems, then shorter names.
 */
export function rankSuggestions<T extends SuggestionCandidate>(
  candidates: readonly T[],
  query: string,
  locale: Locale,
  limit = 8,
): RankedSuggestion<T>[] {
  const q = normaliseSearchText(query);
  if (!q) return [];
  const [primary, secondary] = locale === 'ar' ? ['nameAr', 'nameEn'] : ['nameEn', 'nameAr'];
  const ranked: RankedSuggestion<T>[] = [];
  for (const c of candidates) {
    let best = { score: 0, synonym: null as string | null };
    const consider = (text: string, bonus: number, synonym: string | null) => {
      const s = matchScore(text, q);
      if (s && s + bonus > best.score) best = { score: s + bonus, synonym };
    };
    consider(c[primary as 'nameEn'], 10, null);
    consider(c[secondary as 'nameEn'], 5, null);
    const synonyms = [
      ...(locale === 'ar' ? (c.synonymsAr ?? []) : (c.synonymsEn ?? [])),
      ...(locale === 'ar' ? (c.synonymsEn ?? []) : (c.synonymsAr ?? [])),
    ];
    for (const syn of synonyms) consider(syn, 0, syn);
    if (best.score) ranked.push({ candidate: c, ...best });
  }
  const label = (c: T) => (locale === 'ar' ? c.nameAr || c.nameEn : c.nameEn || c.nameAr);
  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        TYPE_ORDER[a.candidate.type] - TYPE_ORDER[b.candidate.type] ||
        label(a.candidate).length - label(b.candidate).length ||
        label(a.candidate).localeCompare(label(b.candidate)),
    )
    .slice(0, limit);
}

/**
 * Elements whose label comes from a library object (`ph:labelRef="<object id>"`), by element id.
 * The API keeps an object link per such element in sync, and "Rename" updates their labels.
 */
export function extractLabelRefs(xml: string): Map<string, string> {
  const refs = new Map<string, string>();
  const tagRe = /<[\w:-]+\s([^>]*?)\/?>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(xml))) {
    const ref = /(?:^|\s)[\w-]+:labelRef="([^"]+)"/.exec(tag[1])?.[1]?.trim();
    if (!ref) continue;
    const id = /(?:^|\s)id="([^"]+)"/.exec(tag[1])?.[1];
    if (id) refs.set(decodeXml(id), decodeXml(ref));
  }
  return refs;
}
