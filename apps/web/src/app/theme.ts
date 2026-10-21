import type { ThemeConfig } from 'antd';
import type { Locale } from '@processhub/shared';

export const FONT_EN = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const FONT_AR = "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif";

export function buildTheme(locale: Locale): ThemeConfig {
  return {
    token: {
      colorPrimary: '#1d4ed8',
      colorInfo: '#1d4ed8',
      colorSuccess: '#15803d',
      colorWarning: '#b45309',
      colorError: '#b91c1c',
      colorBgLayout: '#f4f6fb',
      colorTextBase: '#0f172a',
      borderRadius: 8,
      fontFamily: locale === 'ar' ? FONT_AR : FONT_EN,
      fontSize: 14,
      controlHeight: 34,
    },
    components: {
      Layout: { headerBg: '#ffffff', siderBg: '#0f1b3d', headerHeight: 56, headerPadding: '0 20px' },
      Menu: {
        darkItemBg: '#0f1b3d',
        darkSubMenuItemBg: '#0b1530',
        darkItemSelectedBg: '#1d4ed8',
        itemBorderRadius: 6,
      },
      Card: { headerFontSize: 15 },
      Table: { headerBg: '#f8fafc' },
    },
  };
}
