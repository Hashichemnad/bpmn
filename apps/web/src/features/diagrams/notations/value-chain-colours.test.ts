import { describe, expect, it } from 'vitest';
import type { ProcessFactDto } from '@processhub/shared';
import { valueChainColours } from './value-chain-colours';

const fact = (id: string, patch: Partial<ProcessFactDto>): ProcessFactDto => ({
  id,
  code: id,
  nameEn: id,
  nameAr: '',
  status: 'DRAFT',
  department: null,
  kpi: null,
  kpiCount: 0,
  risk: null,
  ...patch,
});

describe('value chain colour by (D-121)', () => {
  const nodes = [{ id: 'A', processId: 'p1' }, { id: 'B', processId: 'p2' }, { id: 'C' }];
  const facts = new Map([
    ['p1', fact('p1', { status: 'PUBLISHED', kpi: 'RED', risk: { score: 16, band: 'HIGH' } })],
    ['p2', fact('p2', { status: 'DRAFT' })],
  ]);

  it('colours linked elements by status, KPI and risk band with a legend', () => {
    const status = valueChainColours(nodes, facts, 'status');
    expect([...status.colours.keys()]).toEqual(['A', 'B']);
    expect(status.legend.map((l) => l.key)).toEqual(['PUBLISHED', 'DRAFT']);
    const kpi = valueChainColours(nodes, facts, 'kpi');
    expect(kpi.colours.get('A')?.stroke).toBe('#DC2626');
    expect(kpi.legend.map((l) => l.key)).toEqual(['RED', 'none']);
    const risk = valueChainColours(nodes, facts, 'risk', [
      {
        key: 'HIGH',
        nameEn: 'High',
        nameAr: 'مرتفع',
        colour: '#C62828',
        minScore: 12,
        alert: true,
      },
    ]);
    expect(risk.colours.get('A')).toEqual({ fill: '#F5D8D8', stroke: '#C62828' });
  });

  it('keeps own colours for "none"', () => {
    expect(valueChainColours(nodes, facts, 'none').colours.size).toBe(0);
  });
});
