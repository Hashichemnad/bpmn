import {
  ApartmentOutlined,
  BranchesOutlined,
  DoubleRightOutlined,
  NodeIndexOutlined,
  PartitionOutlined,
  TableOutlined,
} from '@ant-design/icons';
import type { CSSProperties } from 'react';
import type { DiagramType } from '@processhub/shared';
import { DIAGRAM_TYPE_COLOURS } from './kit/type-colours';

/** One icon per notation, used in the repository tree, lists, portal cards and search. */
export function DiagramTypeIcon({
  type,
  style,
}: {
  type: DiagramType | null | undefined;
  style?: CSSProperties;
}) {
  const s = { color: type ? DIAGRAM_TYPE_COLOURS[type] : '#1d4ed8', ...style };
  switch (type) {
    case 'VALUE_CHAIN':
      return <DoubleRightOutlined style={s} />;
    case 'ORG_CHART':
      return <ApartmentOutlined style={s} />;
    case 'DMN':
      return <TableOutlined style={s} />;
    case 'EPC':
      return <NodeIndexOutlined style={s} />;
    case 'SIPOC':
      return <BranchesOutlined style={s} />;
    default:
      return <PartitionOutlined style={s} />;
  }
}
