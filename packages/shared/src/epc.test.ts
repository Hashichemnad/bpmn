import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramNode, GraphContent } from './diagrams';
import { epcIssues, epcToBpmn } from './epc';

const n = (
  id: string,
  kind: string,
  nameEn = id,
  extra: Partial<DiagramNode> = {},
): DiagramNode => ({
  id,
  kind,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  nameEn,
  nameAr: `${nameEn} ع`,
  ...extra,
});
const flow = (sourceId: string, targetId: string, kind = 'flow'): DiagramEdge => ({
  id: `F_${sourceId}_${targetId}`,
  kind,
  sourceId,
  targetId,
  waypoints: [],
  nameEn: '',
  nameAr: '',
});
const ROLE = '11111111-1111-4111-8111-111111111111';
const SYSTEM = '22222222-2222-4222-8222-222222222222';

/** Request received → Check request (Buyer, ERP) → XOR → Approved → Order → Ordered | Rejected. */
const epc: GraphContent = {
  schema: 1,
  type: 'EPC',
  nodes: [
    n('E1', 'event', 'Request received'),
    n('F1', 'function', 'Check request'),
    n('U1', 'orgUnit', 'Buyer', { objectId: ROLE }),
    n('S1', 'system', 'ERP', { objectId: SYSTEM }),
    n('X1', 'xor'),
    n('E2', 'event', 'Approved'),
    n('F2', 'function', 'Order goods'),
    n('E3', 'event', 'Goods ordered'),
    n('E4', 'event', 'Rejected'),
  ],
  edges: [
    flow('E1', 'F1'),
    flow('U1', 'F1', 'assignment'),
    flow('F1', 'S1', 'assignment'),
    flow('F1', 'X1'),
    flow('X1', 'E2'),
    flow('E2', 'F2'),
    flow('F2', 'E3'),
    flow('X1', 'E4'),
  ],
};

describe('EPC (D-124)', () => {
  it('accepts a valid chain', () => {
    expect(epcIssues(epc)).toEqual([]);
  });

  it('reports the classic syntax errors', () => {
    const codes = (c: GraphContent) =>
      epcIssues(c)
        .map((i) => i.code)
        .sort();
    // Function directly after a function, a decision after an event, a dangling resource.
    const bad: GraphContent = {
      ...epc,
      nodes: [...epc.nodes, n('F3', 'function'), n('X2', 'or'), n('D1', 'document')],
      edges: [
        ...epc.edges.filter((e) => e.id !== 'F_E2_F2'),
        flow('E2', 'X2'),
        flow('X2', 'F2'),
        flow('X2', 'F3'),
        flow('F3', 'F2'),
      ],
    };
    expect(codes(bad)).toEqual(
      [
        'BRANCH_WITHOUT_CONNECTOR',
        'DECISION_AFTER_EVENT',
        'FUNCTION_FUNCTION',
        'RESOURCE_UNASSIGNED',
      ].sort(),
    );
    expect(codes({ ...epc, nodes: [n('F9', 'function')], edges: [] })).toEqual(
      ['NO_END_EVENT', 'NO_START_EVENT', 'UNCONNECTED'].sort(),
    );
  });

  it('converts to a BPMN structure with lanes, gateways and a mapping report', () => {
    const r = epcToBpmn(epc, { nameEn: 'Purchasing', nameAr: 'الشراء' });
    const type = (id: string) => r.structure.nodes.find((x) => x.id === id)?.type;
    expect(type('E1')).toBe('startEvent');
    expect(type('F1')).toBe('userTask');
    expect(type('X1')).toBe('exclusiveGateway');
    expect(type('E3')).toBe('endEvent');
    expect(type('E2')).toBeUndefined();
    expect(r.structure.flows).toContainEqual({
      from: 'X1',
      to: 'F2',
      nameEn: 'Approved',
      nameAr: 'Approved ع',
    });
    expect(r.structure.flows).toContainEqual({
      from: 'X1',
      to: 'E4',
      nameEn: 'Rejected',
      nameAr: 'Rejected ع',
    });
    expect(r.structure.lanes).toEqual([{ id: 'Lane_U1', nameEn: 'Buyer', nameAr: 'Buyer ع' }]);
    expect(r.structure.nodes.every((x) => x.lane === 'Lane_U1')).toBe(true);
    expect(r.laneRoles.get('Lane_U1')).toBe(ROLE);
    expect(r.objectLinks).toEqual([{ elementId: 'F1', objectId: SYSTEM, kind: 'SYSTEM' }]);
    expect(r.report.find((x) => x.epcId === 'E2')?.result).toBe('FLOW_LABEL');
    expect(r.report.find((x) => x.epcId === 'S1')?.result).toBe('SYSTEM_LINK');
  });
});
