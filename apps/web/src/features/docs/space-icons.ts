import {
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  CloudOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  HeartOutlined,
  RocketOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { SpaceIcon as SpaceIconKey } from '@processhub/shared';
import type { ComponentType } from 'react';

export const SPACE_ICON_COMPONENTS: Record<SpaceIconKey, ComponentType> = {
  book: BookOutlined,
  safety: SafetyOutlined,
  team: TeamOutlined,
  setting: SettingOutlined,
  database: DatabaseOutlined,
  cloud: CloudOutlined,
  bank: BankOutlined,
  tool: ToolOutlined,
  rocket: RocketOutlined,
  heart: HeartOutlined,
  audit: AuditOutlined,
  global: GlobalOutlined,
};
