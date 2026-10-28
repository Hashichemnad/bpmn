import { describe, expect, it } from 'vitest';
import type { BpmnInstance } from './bpmn-types';
import { groupBadges, renderBadges, type BadgeItem } from './badges';

const items: BadgeItem[] = [
  { elementId: 'T1', kind: 'ROLE', name: 'Requester' },
  { elementId: 'T1', kind: 'ROLE', name: 'Analyst' },
  { elementId: 'T1', kind: 'COMMENT', name: 'Budget?' },
  { elementId: 'T2', kind: 'SYSTEM', name: '<img src=x onerror=alert(1)>' },
  { elementId: 'Gone', kind: 'RISK', name: 'Fraud' },
];

function fakeInstance() {
  const added: { id: string; html: HTMLElement }[] = [];
  const instance = {
    get: (name: string) =>
      name === 'overlays'
        ? {
            remove: () => added.splice(0),
            add: (id: string, _t: string, o: { html: HTMLElement }) =>
              added.push({ id, html: o.html }),
          }
        : { get: (id: string) => (id === 'Gone' ? undefined : { id }) },
  } as unknown as BpmnInstance;
  return { instance, added };
}

describe('shape badges', () => {
  it('groups names per element and kind', () => {
    const g = groupBadges(items);
    expect(g.get('T1')!.get('ROLE')).toEqual(['Requester', 'Analyst']);
    expect(g.get('T1')!.get('COMMENT')).toEqual(['Budget?']);
  });

  it('renders one chip per kind with count and names in the tooltip, never as markup', () => {
    const { instance, added } = fakeInstance();
    const clicks: string[] = [];
    renderBadges(instance, items, {
      title: (kind, names) => `${kind}: ${names.join(', ')}`,
      onClick: (id, kind) => clicks.push(`${id}/${kind}`),
    });
    expect(added.map((a) => a.id)).toEqual(['T1', 'T2']);
    const chips = added[0].html.querySelectorAll('button');
    expect([...chips].map((c) => c.textContent)).toEqual(['2', '1']);
    expect(chips[0].title).toBe('ROLE: Requester, Analyst');
    chips[1].click();
    expect(clicks).toEqual(['T1/COMMENT']);
    expect(added[1].html.querySelector('img')).toBeNull();
    expect(added[1].html.querySelector('button')!.title).toContain('<img');
  });
});
