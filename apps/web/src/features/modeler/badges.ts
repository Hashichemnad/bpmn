import type { BpmnInstance, ElementRegistry, Overlays } from './bpmn-types';

/**
 * Information badges on diagram shapes: how many roles, IT systems, documents, risks, controls and
 * open comments belong to a step. One row of small chips per element; hovering a chip lists the
 * names, clicking it calls `onClick`. Used by the modeler workspace, the read-only preview and the
 * Knowledge Portal (published links only).
 */
export type BadgeKind = 'ROLE' | 'SYSTEM' | 'DOCUMENT' | 'RISK' | 'CONTROL' | 'COMMENT';

export const BADGE_KINDS: BadgeKind[] = [
  'ROLE',
  'SYSTEM',
  'DOCUMENT',
  'RISK',
  'CONTROL',
  'COMMENT',
];

export interface BadgeItem {
  elementId: string;
  kind: BadgeKind;
  name: string;
}

/** Static icons (16 × 16, stroked in the chip colour). */
const ICONS: Record<BadgeKind, string> = {
  ROLE: '<circle cx="8" cy="5" r="2.8"/><path d="M2.5 14c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/>',
  SYSTEM: '<rect x="2" y="2.5" width="12" height="8.5" rx="1.2"/><path d="M5.5 14h5M8 11v3"/>',
  DOCUMENT: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3M6 8.5h4M6 11h4"/>',
  RISK: '<path d="M8 2 14.8 13.8H1.2z"/><path d="M8 6.5v3.2M8 11.8v.1"/>',
  CONTROL:
    '<path d="M8 1.5 13.5 3.5v4c0 3.2-2.3 5.6-5.5 7-3.2-1.4-5.5-3.8-5.5-7v-4z"/><path d="m5.5 8 1.8 1.8 3.4-3.5"/>',
  COMMENT: '<path d="M2 2.5h12v8.5H6.5L3 14v-3H2z"/>',
};

export const OVERLAY_TYPE = 'ph-badges';

export function groupBadges(items: BadgeItem[]): Map<string, Map<BadgeKind, string[]>> {
  const byElement = new Map<string, Map<BadgeKind, string[]>>();
  for (const item of items) {
    const kinds = byElement.get(item.elementId) ?? new Map<BadgeKind, string[]>();
    kinds.set(item.kind, [...(kinds.get(item.kind) ?? []), item.name]);
    byElement.set(item.elementId, kinds);
  }
  return byElement;
}

export function renderBadges(
  instance: BpmnInstance,
  items: BadgeItem[],
  options: {
    /** Tooltip / accessible name of a chip, e.g. "Roles: Requester, Analyst". */
    title: (kind: BadgeKind, names: string[]) => string;
    onClick?: (elementId: string, kind: BadgeKind) => void;
  },
): void {
  const overlays = instance.get<Overlays>('overlays');
  const registry = instance.get<ElementRegistry>('elementRegistry');
  overlays.remove({ type: OVERLAY_TYPE });
  for (const [elementId, kinds] of groupBadges(items)) {
    if (!registry.get(elementId)) continue;
    const row = document.createElement('div');
    row.className = 'ph-badges';
    for (const kind of BADGE_KINDS) {
      const names = kinds.get(kind);
      if (!names?.length) continue;
      const chip = document.createElement(options.onClick ? 'button' : 'span');
      if (chip instanceof HTMLButtonElement) chip.type = 'button';
      chip.className = `ph-badge ph-badge-${kind.toLowerCase()}`;
      const title = options.title(kind, names);
      chip.title = title;
      chip.setAttribute('aria-label', title);
      // Static icon markup (constants above); the names only go into attributes.
      chip.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[kind]}</svg>`;
      const count = document.createElement('span');
      count.textContent = String(names.length);
      chip.append(count);
      if (options.onClick) {
        const onClick = options.onClick;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick(elementId, kind);
        });
      }
      row.append(chip);
    }
    overlays.add(elementId, OVERLAY_TYPE, { position: { top: -10, left: 4 }, html: row });
  }
}
