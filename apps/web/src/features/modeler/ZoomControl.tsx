import { Button, Dropdown, Space, Tooltip } from 'antd';
import { DownOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { BpmnInstance, Canvas } from './bpmn-types';
import { ZOOM_PRESETS, fitPage, fitWidth, zoomBy, zoomTo } from './view';

/** Zoom out / percentage menu (fit width, fit page, presets) / zoom in. */
export function ZoomControl({ instance, zoom }: { instance: BpmnInstance | null; zoom: number }) {
  const { t } = useTranslation();
  const canvas = () => instance?.get<Canvas>('canvas');
  const percent = new Intl.NumberFormat(undefined, { style: 'percent' });
  return (
    <Space.Compact size="small">
      <Tooltip title={t('modeler:zoomOut')}>
        <Button
          icon={<ZoomOutOutlined />}
          aria-label={t('modeler:zoomOut')}
          onClick={() => canvas() && zoomBy(canvas()!, 1 / 1.2)}
        />
      </Tooltip>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'width', label: t('modeler:zoom.fitWidth') },
            { key: 'page', label: t('modeler:zoom.fitPage') },
            { type: 'divider' },
            ...ZOOM_PRESETS.map((z) => ({ key: String(z), label: percent.format(z) })),
          ],
          onClick: ({ key }) => {
            const c = canvas();
            if (!c) return;
            if (key === 'width') fitWidth(c);
            else if (key === 'page') fitPage(c);
            else zoomTo(c, Number(key));
          },
        }}
      >
        <Button aria-label={t('modeler:zoom.menu')} className="ph-zoom-value">
          <span dir="ltr">{percent.format(zoom || 1)}</span> <DownOutlined />
        </Button>
      </Dropdown>
      <Tooltip title={t('modeler:zoomIn')}>
        <Button
          icon={<ZoomInOutlined />}
          aria-label={t('modeler:zoomIn')}
          onClick={() => canvas() && zoomBy(canvas()!, 1.2)}
        />
      </Tooltip>
    </Space.Compact>
  );
}
