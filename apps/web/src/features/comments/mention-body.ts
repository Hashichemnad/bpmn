import { commentSegments, mentionToken } from '@processhub/shared';

/** Converts the visible "@Name" mentions into stored `@[Name](id)` tokens. */
export function toStoredBody(text: string, picked: Map<string, string>): string {
  let out = text;
  for (const [name, id] of [...picked.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(`@${name}`).join(mentionToken(name, id));
  }
  return out;
}

/** Stored body → editable text with "@Name" and the name → id map. */
export function fromStoredBody(body: string): { text: string; picked: Map<string, string> } {
  const picked = new Map<string, string>();
  const text = commentSegments(body)
    .map((s) => {
      if (s.type === 'text') return s.text;
      picked.set(s.name, s.userId);
      return `@${s.name}`;
    })
    .join('');
  return { text, picked };
}
