import type { ShapeOutline } from './notations';

/**
 * Outlines of the shape kinds as SVG path data in local coordinates (0,0 = top-left of the shape).
 * Pure functions: used by the renderer, the docking of connections, palette icons and exports.
 */
export function outlinePath(outline: ShapeOutline, w: number, h: number): string {
  const rect = (r: number) => roundRect(0, 0, w, h, r);
  switch (outline) {
    case 'chevron': {
      const n = Math.min(h / 2, w * 0.2);
      return `M0,0 L${w - n},0 L${w},${h / 2} L${w - n},${h} L0,${h} L${n},${h / 2} Z`;
    }
    case 'event': {
      const i = Math.min(h / 2, w * 0.15, 22);
      return `M${i},0 L${w - i},0 L${w},${h / 2} L${w - i},${h} L${i},${h} L0,${h / 2} Z`;
    }
    case 'connector': {
      const r = Math.min(w, h) / 2;
      return `M${w / 2 - r},${h / 2} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
    }
    case 'orgUnit': {
      const rx = w / 2;
      const ry = h / 2;
      return `M0,${ry} a${rx},${ry} 0 1,0 ${w},0 a${rx},${ry} 0 1,0 ${-w},0 Z`;
    }
    case 'document': {
      const wave = Math.min(10, h * 0.18);
      return `M0,0 L${w},0 L${w},${h - wave} C${w * 0.75},${h - 2.5 * wave} ${w * 0.5},${h + wave} ${w * 0.25},${h - wave} C${w * 0.15},${h - 1.6 * wave} ${w * 0.05},${h - wave} 0,${h - wave * 0.6} Z`;
    }
    case 'function':
    case 'processPath':
      return rect(12);
    case 'position':
      return rect(10);
    case 'person':
      return rect(Math.min(h / 2, 24));
    case 'frame':
      return rect(10);
    case 'block':
      return rect(6);
    case 'unit':
    case 'system':
    case 'information':
    default:
      return rect(2);
  }
}

export function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!rr) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  return [
    `M${x + rr},${y}`,
    `H${x + w - rr}`,
    `A${rr},${rr} 0 0 1 ${x + w},${y + rr}`,
    `V${y + h - rr}`,
    `A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}`,
    `H${x + rr}`,
    `A${rr},${rr} 0 0 1 ${x},${y + h - rr}`,
    `V${y + rr}`,
    `A${rr},${rr} 0 0 1 ${x + rr},${y}`,
    'Z',
  ].join(' ');
}

/** Moves a local path to absolute coordinates (connection docking works on absolute paths). */
export function translatePath(d: string, dx: number, dy: number): string {
  // Only absolute commands with x,y pairs are produced above, except arcs ('a' relative, 'A' absolute).
  return d.replace(/([MLHVCAZa])([^MLHVCAZa]*)/g, (_, cmd: string, args: string) => {
    const nums = args
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (cmd === 'Z' || cmd === 'a') return `${cmd}${args}`;
    if (cmd === 'H') return `H${nums[0] + dx}`;
    if (cmd === 'V') return `V${nums[0] + dy}`;
    if (cmd === 'A')
      return `A${nums[0]},${nums[1]} ${nums[2]} ${nums[3]} ${nums[4]} ${nums[5] + dx},${nums[6] + dy}`;
    const out: number[] = [];
    for (let i = 0; i < nums.length; i += 2) out.push(nums[i] + dx, nums[i + 1] + dy);
    const pairs: string[] = [];
    for (let i = 0; i < out.length; i += 2) pairs.push(`${out[i]},${out[i + 1]}`);
    return `${cmd}${pairs.join(' ')} `;
  });
}

/** Arrow head (filled triangle) at the end of a polyline, as path data. */
export function arrowHead(points: { x: number; y: number }[], size = 9): string | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
  const a1 = angle + Math.PI - 0.42;
  const a2 = angle + Math.PI + 0.42;
  const p1 = { x: end.x + size * Math.cos(a1), y: end.y + size * Math.sin(a1) };
  const p2 = { x: end.x + size * Math.cos(a2), y: end.y + size * Math.sin(a2) };
  const r = (n: number) => Math.round(n * 100) / 100;
  return `M${r(end.x)},${r(end.y)} L${r(p1.x)},${r(p1.y)} L${r(p2.x)},${r(p2.y)} Z`;
}

/** Point in the middle of a polyline (connection labels). */
export function polylineMiddle(points: { x: number; y: number }[]): { x: number; y: number } {
  if (!points.length) return { x: 0, y: 0 };
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let half = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i]) {
      const t = lengths[i] ? half / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    half -= lengths[i];
  }
  return points[points.length - 1];
}

/** Small SVG icon of a shape kind (palette and context pad), as a data URL. */
export function kindIconUrl(
  outline: ShapeOutline,
  colours: { fill: string; stroke: string },
  symbol?: string,
): string {
  const w = outline === 'connector' ? 18 : 24;
  const h = outline === 'connector' ? 18 : outline === 'frame' ? 16 : 14;
  const d = translatePath(outlinePath(outline, w, h), (24 - w) / 2, (24 - h) / 2);
  const text = symbol
    ? `<text x="12" y="16.5" text-anchor="middle" font-size="12" font-family="Arial" fill="${colours.stroke}">${symbol}</text>`
    : '';
  const dash = outline === 'frame' ? ' stroke-dasharray="3 2"' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${d}" fill="${colours.fill}" stroke="${colours.stroke}" stroke-width="1.5"${dash}/>${text}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
