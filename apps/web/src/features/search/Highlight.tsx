import { HIGHLIGHT_END, HIGHLIGHT_START } from '@processhub/shared';

/** Renders a search snippet; matches are wrapped in private-use markers by the server. */
export function Highlight({ text }: { text: string }) {
  const parts: { text: string; hit: boolean }[] = [];
  let rest = text;
  while (rest) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start < 0) {
      parts.push({ text: rest, hit: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), hit: false });
    const end = rest.indexOf(HIGHLIGHT_END, start);
    const stop = end < 0 ? rest.length : end;
    parts.push({ text: rest.slice(start + 1, stop), hit: true });
    rest = end < 0 ? '' : rest.slice(end + 1);
  }
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}
