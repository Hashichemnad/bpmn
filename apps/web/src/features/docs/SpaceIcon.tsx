import { BookOutlined } from '@ant-design/icons';
import type { SpaceIcon as SpaceIconKey } from '@processhub/shared';
import { SPACE_ICON_COMPONENTS } from './space-icons';

export function SpaceIcon({ icon, size = 20 }: { icon: SpaceIconKey; size?: number }) {
  const Icon = SPACE_ICON_COMPONENTS[icon] ?? BookOutlined;
  return (
    <span className="ph-space-icon" style={{ fontSize: size }}>
      <Icon />
    </span>
  );
}
