import { Button, Tooltip } from 'antd';
import {
  DragOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SelectOutlined,
  SwapRightOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DiagramTheme } from '@processhub/shared';
import type { GraphInstance } from './kit/graph-diagram';
import type { GraphShape } from './kit/graph-modules';
import { kindColours, nodeDef, type Notation } from './kit/notations';
import { kindIconUrl } from './kit/shapes';

/**
 * Palette of a graph notation on the inline-start side of the canvas (same look as the BPMN
 * palette): grouped shape kinds plus the hand, lasso and connect tools. Click an entry and click
 * the canvas, or drag it onto the canvas.
 */
export function GraphPalette({
  instance,
  notation,
  theme,
  collapsed,
  onCollapsedChange,
}: {
  instance: GraphInstance | null;
  notation: Notation;
  theme: DiagramTheme;
  collapsed: boolean;
  onCollapsedChange: (c: boolean) => void;
}) {
  const { t } = useTranslation();
  const start = (kind: string, event: Event) => {
    if (!instance) return;
    const shape = instance
      .get<{ createShape(a: Record<string, unknown>): GraphShape }>('elementFactory')
      .createShape({ businessObject: { kind } });
    instance.get<{ start(e: Event, s: GraphShape): void }>('create').start(event, shape);
  };
  const tool = (name: string, event: Event) => {
    if (!instance) return;
    if (name === 'hand')
      instance.get<{ activateHand(e: Event): void }>('handTool').activateHand(event);
    if (name === 'lasso')
      instance.get<{ activateSelection(e: Event): void }>('lassoTool').activateSelection(event);
    if (name === 'connect') instance.get<{ start(e: Event): void }>('globalConnect').start(event);
  };
  const tools = [
    { key: 'hand', icon: <DragOutlined /> },
    { key: 'lasso', icon: <SelectOutlined /> },
    { key: 'connect', icon: <SwapRightOutlined /> },
  ];
  return (
    <nav
      className={`ph-palette${collapsed ? ' is-collapsed' : ''}`}
      aria-label={t('modeler:palette.title')}
    >
      <div className="ph-palette-head">
        <Tooltip title={collapsed ? t('modeler:palette.expand') : t('modeler:palette.collapse')}>
          <Button
            size="small"
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? t('modeler:palette.expand') : t('modeler:palette.collapse')}
            onClick={() => onCollapsedChange(!collapsed)}
          />
        </Tooltip>
      </div>
      <div className="ph-palette-body">
        {notation.palette.map(([group, kinds]) => (
          <section key={group} className="ph-palette-group">
            {!collapsed && <h3>{t(`diagrams:palette.${group}`)}</h3>}
            <ul>
              {kinds.map((kind) => {
                const def = nodeDef(notation, kind);
                const label = t(`diagrams:kinds.${kind}`);
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      className="ph-palette-entry"
                      draggable
                      title={collapsed ? label : undefined}
                      aria-label={label}
                      data-kind={kind}
                      onClick={(e) => start(kind, e.nativeEvent)}
                      onDragStart={(e) => start(kind, e.nativeEvent)}
                    >
                      <img
                        className="ph-palette-icon"
                        alt=""
                        src={kindIconUrl(def.outline, kindColours(def.colour, theme), def.symbol)}
                      />
                      {!collapsed && <span className="ph-palette-label">{label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section className="ph-palette-group">
          {!collapsed && <h3>{t('modeler:palette.groups.tools')}</h3>}
          <ul>
            {tools.map((x) => (
              <li key={x.key}>
                <button
                  type="button"
                  className="ph-palette-entry"
                  aria-label={t(`diagrams:tools.${x.key}`)}
                  title={collapsed ? t(`diagrams:tools.${x.key}`) : undefined}
                  onClick={(e) => tool(x.key, e.nativeEvent)}
                >
                  <span className="ph-palette-icon">{x.icon}</span>
                  {!collapsed && (
                    <span className="ph-palette-label">{t(`diagrams:tools.${x.key}`)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </nav>
  );
}
