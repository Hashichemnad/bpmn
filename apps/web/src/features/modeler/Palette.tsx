import { useMemo, useState } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/app/LocaleProvider';
import type { BpmnInstance, DiagramElement } from './bpmn-types';
import {
  PALETTE_ENTRIES,
  PALETTE_GROUPS,
  filterEntries,
  startEntry,
  type PaletteEntry,
  type ReadyStep,
} from './palette-entries';

interface Props {
  instance: BpmnInstance | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Called with the element a ready-made step is about to create (e.g. to pick a process). */
  onReadyStep?: (step: ReadyStep, element: DiagramElement) => void;
}

/**
 * ProcessHub palette on the inline-start side of the canvas (right in Arabic): grouped entries
 * with icons and labels, searchable, collapsible to icons only. Click an entry and click the
 * canvas, or drag it onto the canvas.
 */
export function Palette({ instance, collapsed, onCollapsedChange, onReadyStep }: Props) {
  const { t, i18n } = useTranslation();
  const { locale } = useLocale();
  const [query, setQuery] = useState('');
  const en = useMemo(() => i18n.getFixedT('en'), [i18n]);
  const ar = useMemo(() => i18n.getFixedT('ar'), [i18n]);

  const label = (e: PaletteEntry) => t(`modeler:${e.labelKey}`);
  const entries = filterEntries(PALETTE_ENTRIES, collapsed ? '' : query, label, (e) =>
    en(`modeler:${e.labelKey}`),
  );
  const readyNames = (step: ReadyStep) => ({
    en: en(`modeler:palette.ready.${step.key}.name`),
    ar: ar(`modeler:palette.ready.${step.key}.name`),
  });

  const start = (entry: PaletteEntry, event: Event) => {
    if (!instance) return;
    const el = startEntry(instance, entry, event, readyNames, locale);
    if (el && entry.ready) onReadyStep?.(entry.ready, el);
  };

  return (
    <nav
      className={`ph-palette${collapsed ? ' is-collapsed' : ''}`}
      aria-label={t('modeler:palette.title')}
    >
      <div className="ph-palette-head">
        {!collapsed && (
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t('modeler:palette.search')}
            aria-label={t('modeler:palette.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
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
        {PALETTE_GROUPS.map((group) => {
          const items = entries.filter((e) => e.group === group);
          if (!items.length) return null;
          return (
            <section key={group} className="ph-palette-group">
              {!collapsed && <h3>{t(`modeler:palette.groups.${group}`)}</h3>}
              <ul>
                {items.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className={`ph-palette-entry${entry.ready ? ' is-ready' : ''}`}
                      draggable={
                        !entry.special ||
                        entry.special === 'subprocess' ||
                        entry.special === 'participant'
                      }
                      title={collapsed ? label(entry) : undefined}
                      aria-label={label(entry)}
                      onClick={(e) => start(entry, e.nativeEvent)}
                      onDragStart={(e) => start(entry, e.nativeEvent)}
                    >
                      <span className={`ph-palette-icon ${entry.icon}`} aria-hidden="true" />
                      {!collapsed && <span className="ph-palette-label">{label(entry)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!entries.length && <p className="ph-palette-empty">{t('modeler:palette.noMatch')}</p>}
      </div>
    </nav>
  );
}
