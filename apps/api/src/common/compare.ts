/**
 * Natural-order string comparison ("C.2" before "C.10"). One shared collator: calling
 * `localeCompare(…, { numeric: true })` builds a new collator on every comparison, which made
 * sorting a register of 1,500 rows ~25 times slower (final session, part A).
 */
export const compareNatural: (a: string, b: string) => number = new Intl.Collator(undefined, {
  numeric: true,
}).compare;
