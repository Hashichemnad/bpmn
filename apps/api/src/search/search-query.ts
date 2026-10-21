/**
 * Turns free text into a safe prefix tsquery string: "Purchase ord" → "purchase:* & ord:*".
 * Only letters and digits survive, so the result can never contain tsquery operators.
 * Prefix matching also evens out Arabic stemming differences between word forms.
 */
export function toPrefixTsQuery(input: string, maxTerms = 8): string | null {
  const terms = (
    input
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).slice(0, maxTerms);
  return terms.length ? terms.map((t) => `${t}:*`).join(' & ') : null;
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Any-term prefix query for natural-language questions ("How do I request a new laptop?"):
 * terms are OR-ed so ranking decides; single characters are skipped. Stop words are removed by
 * the text-search configuration. Same safe character set as toPrefixTsQuery.
 */
export function toAnyTsQuery(input: string, maxTerms = 16): string | null {
  const terms = [
    ...new Set(
      (
        input
          .normalize('NFKC')
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
      ).filter((t) => t.length > 1),
    ),
  ].slice(0, maxTerms);
  return terms.length ? terms.map((t) => `${t}:*`).join(' | ') : null;
}
