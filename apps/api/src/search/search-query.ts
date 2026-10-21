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
