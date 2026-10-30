import { describe, expect, it } from 'vitest';
import { NODE_W, layoutLandscape } from './landscape-layout';

describe('layoutLandscape', () => {
  it('ranks applications along their interfaces and puts unconnected ones in a last row', () => {
    const nodes = ['crm', 'erp', 'bank', 'hr', 'lone'].map((id) => ({ id }));
    const edges = [
      { sourceId: 'crm', targetId: 'erp' },
      { sourceId: 'hr', targetId: 'erp' },
      { sourceId: 'erp', targetId: 'bank' },
    ];
    const { positions } = layoutLandscape(nodes, edges);
    const x = (id: string) => positions.get(id)!.x;
    expect(x('crm')).toBe(x('hr'));
    expect(x('erp')).toBeGreaterThanOrEqual(x('crm') + NODE_W);
    expect(x('bank')).toBeGreaterThan(x('erp'));
    // Every node placed, none overlapping.
    expect(positions.size).toBe(5);
    expect(positions.get('lone')!.y).toBeGreaterThan(
      Math.max(...['crm', 'erp', 'bank', 'hr'].map((id) => positions.get(id)!.y)),
    );
    const spots = new Set([...positions.values()].map((p) => `${p.x},${p.y}`));
    expect(spots.size).toBe(5);
  });

  it('survives cycles and edges to unknown nodes', () => {
    const { positions, width, height } = layoutLandscape(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
        { sourceId: 'c', targetId: 'a' },
        { sourceId: 'a', targetId: 'zzz' },
      ],
    );
    expect(positions.size).toBe(3);
    expect(new Set([...positions.values()].map((p) => p.x)).size).toBe(3);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});
