import type { DiagramNode, DiagramTheme, GraphDiagramType, ThemeColour } from '@processhub/shared';

/** Outline drawn for a shape kind (see GraphRenderer). */
export type ShapeOutline =
  | 'chevron'
  | 'block'
  | 'frame'
  | 'unit'
  | 'position'
  | 'person'
  | 'event'
  | 'function'
  | 'connector'
  | 'processPath'
  | 'orgUnit'
  | 'system'
  | 'information'
  | 'document';

/** Colour of a kind: a key of Settings → Branding → diagram theme, or a fixed notation colour. */
export type KindColour = keyof DiagramTheme | ThemeColour;

export interface NodeKindDef {
  kind: string;
  outline: ShapeOutline;
  width: number;
  height: number;
  colour: KindColour;
  /** Text drawn inside a connector (EPC: ∧ ∨ ×) instead of a label. */
  symbol?: string;
  /** Resizable with the mouse. */
  resizable: boolean;
  /** Other shapes can be placed inside (value chain frames). */
  container?: boolean;
  /** Label placed at the top of the shape (frames) instead of the centre. */
  labelTop?: boolean;
}

export interface EdgeKindDef {
  kind: string;
  dashed?: boolean;
  dotted?: boolean;
  arrow: boolean;
  /** Org chart lines are drawn with right angles. */
  orthogonal?: boolean;
}

export interface Notation {
  type: GraphDiagramType;
  nodes: NodeKindDef[];
  edges: EdgeKindDef[];
  /** Palette groups: [group key, kinds]. */
  palette: [string, string[]][];
  /** Connection kind between two shapes, or null when they may not be connected. */
  connect(
    source: Pick<DiagramNode, 'kind'>,
    target: Pick<DiagramNode, 'kind'>,
    preferred?: string,
  ): string | null;
  /** Kinds offered by "append" in the context pad of a shape of `kind`. */
  append(kind: string): string[];
  /** Where an appended shape goes relative to its source. */
  appendDirection: 'right' | 'down';
}

const ARIS_EVENT: ThemeColour = { fill: '#F9DDF2', stroke: '#A3247F' };
const NEUTRAL: ThemeColour = { fill: '#FFFFFF', stroke: '#475569' };

const VALUE_CHAIN: Notation = {
  type: 'VALUE_CHAIN',
  nodes: [
    {
      kind: 'chevron',
      outline: 'chevron',
      width: 170,
      height: 70,
      colour: 'humanTask',
      resizable: true,
    },
    {
      kind: 'block',
      outline: 'block',
      width: 170,
      height: 60,
      colour: 'systemTask',
      resizable: true,
    },
    {
      kind: 'frame',
      outline: 'frame',
      width: 560,
      height: 160,
      colour: 'lane',
      resizable: true,
      container: true,
      labelTop: true,
    },
  ],
  edges: [{ kind: 'arrow', arrow: true }],
  palette: [['shapes', ['chevron', 'block', 'frame']]],
  connect: (s, t) => (s.kind === 'frame' || t.kind === 'frame' ? null : 'arrow'),
  append: (kind) => (kind === 'frame' ? [] : ['chevron', 'block']),
  appendDirection: 'right',
};

const ORG_CHART: Notation = {
  type: 'ORG_CHART',
  nodes: [
    {
      kind: 'unit',
      outline: 'unit',
      width: 180,
      height: 64,
      colour: 'systemTask',
      resizable: true,
    },
    {
      kind: 'position',
      outline: 'position',
      width: 170,
      height: 56,
      colour: 'humanTask',
      resizable: true,
    },
    { kind: 'person', outline: 'person', width: 160, height: 48, colour: 'start', resizable: true },
  ],
  edges: [
    { kind: 'reports', arrow: false, orthogonal: true },
    { kind: 'staff', arrow: false, dashed: true, orthogonal: true },
  ],
  palette: [['shapes', ['unit', 'position', 'person']]],
  connect: (s, t, preferred) => {
    if (s.kind === 'person' && t.kind === 'person') return null;
    return preferred === 'staff' ? 'staff' : 'reports';
  },
  append: (kind) =>
    kind === 'person' ? [] : kind === 'unit' ? ['unit', 'position'] : ['position', 'person'],
  appendDirection: 'down',
};

/** Shapes of an EPC that are attached to functions rather than part of the control flow. */
export const EPC_RESOURCE_KINDS = ['orgUnit', 'system', 'information', 'document'];
const EPC_FLOW_KINDS = ['event', 'function', 'and', 'or', 'xor', 'processPath'];

const EPC: Notation = {
  type: 'EPC',
  nodes: [
    {
      kind: 'event',
      outline: 'event',
      width: 150,
      height: 60,
      colour: ARIS_EVENT,
      resizable: true,
    },
    {
      kind: 'function',
      outline: 'function',
      width: 150,
      height: 66,
      colour: 'start',
      resizable: true,
    },
    {
      kind: 'and',
      outline: 'connector',
      width: 40,
      height: 40,
      colour: 'gateway',
      resizable: false,
      symbol: '∧',
    },
    {
      kind: 'or',
      outline: 'connector',
      width: 40,
      height: 40,
      colour: 'gateway',
      resizable: false,
      symbol: '∨',
    },
    {
      kind: 'xor',
      outline: 'connector',
      width: 40,
      height: 40,
      colour: 'gateway',
      resizable: false,
      symbol: '×',
    },
    {
      kind: 'processPath',
      outline: 'processPath',
      width: 150,
      height: 66,
      colour: 'humanTask',
      resizable: true,
    },
    {
      kind: 'orgUnit',
      outline: 'orgUnit',
      width: 140,
      height: 60,
      colour: 'approvalTask',
      resizable: true,
    },
    {
      kind: 'system',
      outline: 'system',
      width: 140,
      height: 56,
      colour: 'systemTask',
      resizable: true,
    },
    {
      kind: 'information',
      outline: 'information',
      width: 140,
      height: 56,
      colour: 'intermediateEvent',
      resizable: true,
    },
    {
      kind: 'document',
      outline: 'document',
      width: 130,
      height: 64,
      colour: NEUTRAL,
      resizable: true,
    },
  ],
  edges: [
    { kind: 'flow', arrow: true },
    { kind: 'assignment', arrow: false, dotted: true },
  ],
  palette: [
    ['flow', ['event', 'function', 'processPath']],
    ['connectors', ['xor', 'and', 'or']],
    ['resources', ['orgUnit', 'system', 'information', 'document']],
  ],
  connect: (s, t) => {
    const sRes = EPC_RESOURCE_KINDS.includes(s.kind);
    const tRes = EPC_RESOURCE_KINDS.includes(t.kind);
    if (sRes || tRes) {
      // Resources attach to functions (either direction), never to each other or events.
      const other = sRes ? t.kind : s.kind;
      return sRes !== tRes && other === 'function' ? 'assignment' : null;
    }
    return EPC_FLOW_KINDS.includes(s.kind) && EPC_FLOW_KINDS.includes(t.kind) ? 'flow' : null;
  },
  append: (kind) =>
    kind === 'event'
      ? ['function', 'xor', 'and']
      : kind === 'function'
        ? ['event', 'xor', 'orgUnit']
        : EPC_RESOURCE_KINDS.includes(kind)
          ? []
          : ['event', 'function'],
  appendDirection: 'down',
};

export const NOTATIONS: Record<GraphDiagramType, Notation> = { VALUE_CHAIN, ORG_CHART, EPC };

export function nodeDef(notation: Notation, kind: string): NodeKindDef {
  return notation.nodes.find((n) => n.kind === kind) ?? notation.nodes[0];
}

export function edgeDef(notation: Notation, kind: string): EdgeKindDef {
  return notation.edges.find((e) => e.kind === kind) ?? notation.edges[0];
}

/** Default fill / stroke of a kind with the current theme. */
export function kindColours(colour: KindColour, theme: DiagramTheme): ThemeColour {
  return typeof colour === 'string' ? theme[colour] : colour;
}

/** Value chain blocks: management above the chain, support below (the theme decides the colour). */
export function blockColour(node: Pick<DiagramNode, 'kind' | 'category'>, theme: DiagramTheme) {
  if (node.kind !== 'block') return null;
  return node.category === 'MANAGEMENT' ? theme.approvalTask : theme.systemTask;
}
