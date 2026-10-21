import { Typography } from 'antd';

/**
 * Renders the assistant's plain-text answers: paragraphs, and "- " lines as a bullet list.
 * Text only (never HTML), with the direction taken from the content.
 */
export function AiText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+/.test(line);
    const content = line.replace(/^[-•*]\s+/, '');
    const last = blocks[blocks.length - 1];
    if (last && last.list === bullet && bullet) last.lines.push(content);
    else blocks.push({ list: bullet, lines: [content] });
  }
  return (
    <div className="ph-ai-text" dir="auto">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i}>
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <Typography.Paragraph key={i}>{b.lines[0]}</Typography.Paragraph>
        ),
      )}
    </div>
  );
}
