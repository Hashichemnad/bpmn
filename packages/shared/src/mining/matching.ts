/**
 * Auto-matching of event log activities to BPMN steps (Phase 5.1, D-130): labels in English and
 * Arabic are normalised (case, punctuation, Arabic diacritics, tatweel, alef / ya / ta marbuta
 * variants) and compared; then the synonyms of dictionary terms the step is linked to (or whose
 * name equals the step label). Unmatched activities stay for manual mapping.
 */
export function normaliseLabel(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s\p{P}\p{S}_]+/gu, ' ')
    .trim();
}

export interface MatchStep {
  id: string;
  nameEn: string;
  nameAr: string;
  /** Synonyms (EN and AR) of the dictionary term linked to the step or named like it. */
  synonyms?: string[];
}

export type ActivityMatchKind = 'LABEL' | 'SYNONYM' | 'MANUAL';

export interface ActivityMatch {
  elementId: string;
  match: Exclude<ActivityMatchKind, 'MANUAL'>;
}

/** Best automatic match of each activity (label first, then synonyms); unmatched are absent. */
export function autoMatchActivities(
  activities: string[],
  steps: MatchStep[],
): Map<string, ActivityMatch> {
  const byLabel = new Map<string, string>();
  const bySynonym = new Map<string, string>();
  for (const s of steps) {
    for (const l of [s.nameEn, s.nameAr]) {
      const k = normaliseLabel(l ?? '');
      if (k && !byLabel.has(k)) byLabel.set(k, s.id);
    }
    for (const syn of s.synonyms ?? []) {
      const k = normaliseLabel(syn);
      if (k && !bySynonym.has(k)) bySynonym.set(k, s.id);
    }
  }
  const out = new Map<string, ActivityMatch>();
  for (const a of activities) {
    const k = normaliseLabel(a);
    const label = byLabel.get(k);
    if (label) out.set(a, { elementId: label, match: 'LABEL' });
    else {
      const syn = bySynonym.get(k);
      if (syn) out.set(a, { elementId: syn, match: 'SYNONYM' });
    }
  }
  return out;
}
