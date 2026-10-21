/**
 * Line diff (longest common subsequence) of two texts, as "+ added" / "- removed" lines, for
 * summarising what changed between two page versions. Bounded so huge pages stay cheap.
 */
export function diffLines(a: string, b: string, maxLines = 1500): string[] {
  const x = a ? a.split('\n').slice(0, maxLines) : [];
  const y = b ? b.split('\n').slice(0, maxLines) : [];
  const m = x.length;
  const n = y.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < m) out.push(`- ${x[i++]}`);
  while (j < n) out.push(`+ ${y[j++]}`);
  return out;
}
