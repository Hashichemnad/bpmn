import { describe, expect, it } from 'vitest';
import { stringifyDiagramContent, type GraphContent } from '@processhub/shared';
import { arrowHead, outlinePath, polylineMiddle, translatePath } from './shapes';
import { diffDiagram } from './diagram-diff';
import { NOTATIONS } from './notations';

describe('diagram kit', () => {
  it('draws closed outlines and moves them to absolute coordinates', () => {
    expect(outlinePath('chevron', 100, 40)).toBe('M0,0 L80,0 L100,20 L80,40 L0,40 L20,20 Z');
    expect(translatePath('M0,0 L10,0 H20 V5 Z', 100, 50)).toBe('M100,50 L110,50 H120V55Z');
    expect(
      arrowHead([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toMatch(/^M10,0 L/);
    expect(
      polylineMiddle([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual({ x: 10, y: 0 });
  });

  it('applies the notation connection rules', () => {
    const epc = NOTATIONS.EPC;
    expect(epc.connect({ kind: 'event' }, { kind: 'function' })).toBe('flow');
    expect(epc.connect({ kind: 'orgUnit' }, { kind: 'function' })).toBe('assignment');
    expect(epc.connect({ kind: 'orgUnit' }, { kind: 'event' })).toBeNull();
    expect(NOTATIONS.VALUE_CHAIN.connect({ kind: 'frame' }, { kind: 'chevron' })).toBeNull();
    expect(NOTATIONS.ORG_CHART.connect({ kind: 'unit' }, { kind: 'position' }, 'staff')).toBe(
      'staff',
    );
  });

  it('lists added, removed and changed elements between versions', () => {
    const base: GraphContent = {
      schema: 1,
      type: 'VALUE_CHAIN',
      nodes: [
        { id: 'A', kind: 'chevron', x: 0, y: 0, width: 10, height: 10, nameEn: 'A', nameAr: '' },
        { id: 'B', kind: 'chevron', x: 20, y: 0, width: 10, height: 10, nameEn: 'B', nameAr: '' },
      ],
      edges: [],
    };
    const next: GraphContent = {
      ...base,
      nodes: [
        { ...base.nodes[0], nameEn: 'A2', x: 5 },
        { id: 'C', kind: 'block', x: 0, y: 30, width: 10, height: 10, nameEn: 'C', nameAr: '' },
      ],
    };
    const d = diffDiagram(
      'VALUE_CHAIN',
      stringifyDiagramContent(base),
      stringifyDiagramContent(next),
    );
    expect(d.added.map((c) => c.id)).toEqual(['C']);
    expect(d.removed.map((c) => c.id)).toEqual(['B']);
    expect(d.changed.map((c) => c.id)).toEqual(['A']);
    expect(d.changed[0].aspects.sort()).toEqual(['label', 'layout']);
  });
});
