import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommentDto, ObjectType, StepGrcSummary } from '@processhub/shared';
import type { BpmnInstance, ElementRegistry, EventBus, Overlays } from './bpmn-types';
import { BADGE_KINDS, renderBadges, type BadgeItem, type BadgeKind } from './badges';
import { canDrillDown, linkedProcessOf } from './diagram';

/** Badge items of object links (working model or published links). */
export function linkBadgeItems(
  links: { bpmnElementId: string; object: { type: ObjectType; nameEn: string; nameAr: string } }[],
  name: (o: { nameEn: string; nameAr: string }) => string,
): BadgeItem[] {
  return links
    .filter((l) => (BADGE_KINDS as string[]).includes(l.object.type))
    .map((l) => ({
      elementId: l.bpmnElementId,
      kind: l.object.type as BadgeKind,
      name: name(l.object),
    }));
}

/** Badge items of open comments on diagram elements (first words of each comment). */
export function commentBadgeItems(comments: CommentDto[]): BadgeItem[] {
  return comments
    .filter((c) => c.bpmnElementId && !c.resolvedAt)
    .map((c) => {
      const text = c.body
        .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        elementId: c.bpmnElementId!,
        kind: 'COMMENT' as const,
        name: text.length > 60 ? `${text.slice(0, 57)}…` : text,
      };
    });
}

/** Warning badges: high / critical residual risk without an effective control at the step. */
export function grcAlertBadgeItems(steps: Map<string, StepGrcSummary>, name: string): BadgeItem[] {
  return [...steps]
    .filter(([, s]) => s.alert)
    .map(([elementId]) => ({ elementId, kind: 'ALERT' as const, name }));
}

/**
 * Keeps the badges and drill-down buttons of a diagram in sync with its links and comments:
 * redrawn after each import (`version`), when the data changes, and after edits.
 */
export function useDiagramOverlays({
  instance,
  version,
  items,
  onBadge,
  drill,
}: {
  instance: BpmnInstance | null;
  /** Changes after every import of the diagram. */
  version: number;
  items: BadgeItem[];
  onBadge?: (elementId: string, kind: BadgeKind) => void;
  /** Drill-down button on call activities / sub-processes linked to a process. */
  drill?: { allowed?: (processId: string) => boolean; open: (processId: string) => void };
}) {
  const { t } = useTranslation();
  const latest = useRef({ items, onBadge, drill, t });
  latest.current = { items, onBadge, drill, t };

  useEffect(() => {
    if (!instance || !version) return;
    const draw = () => {
      const { items: current, onBadge: click, drill: d, t: tr } = latest.current;
      renderBadges(instance, current, {
        title: (kind, names) =>
          `${tr(`modeler:badges.${kind}`, { count: names.length })}: ${names.join(', ')}`,
        onClick: click,
      });
      const overlays = instance.get<Overlays>('overlays');
      overlays.remove({ type: 'ph-drill' });
      if (!d) return;
      const registry = instance.get<ElementRegistry>('elementRegistry');
      for (const el of registry.filter((e) => canDrillDown(e))) {
        const target = linkedProcessOf(el.businessObject);
        if (!target || (d.allowed && !d.allowed(target))) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ph-overlay-drill';
        button.textContent = '↗';
        button.title = tr('modeler:openLinkedProcess');
        button.setAttribute('aria-label', tr('modeler:openLinkedProcess'));
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          d.open(target);
        });
        overlays.add(el.id, 'ph-drill', { position: { bottom: 10, left: 6 }, html: button });
      }
    };
    draw();
    // Edits can add or remove elements and process links: redraw shortly after.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 300);
    };
    const eventBus = instance.get<EventBus>('eventBus');
    eventBus.on('commandStack.changed', later);
    return () => {
      clearTimeout(timer);
      eventBus.off('commandStack.changed', later);
    };
  }, [instance, version, items]);
}
