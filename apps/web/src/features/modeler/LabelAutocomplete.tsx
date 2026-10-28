import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { LabelSourceType, LabelSuggestionDto } from '@processhub/shared';
import { fetchLabelSuggestions } from '@/api/dictionary';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import type { BpmnInstance, DiagramElement, EventBus } from './bpmn-types';
import { sourceTypesFor } from './label-source';

const TYPE_COLOUR: Record<LabelSourceType, string> = {
  TERM: 'geekblue',
  ROLE: 'purple',
  SYSTEM: 'cyan',
};

/** One row of the suggestion list (shared by the canvas and the side panel). */
export function SuggestionItem({ s }: { s: LabelSuggestionDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const other = locale === 'ar' ? s.nameEn : s.nameAr;
  return (
    <span className="ph-suggestion">
      <span className="ph-suggestion-main">
        <Tag color={TYPE_COLOUR[s.type]} className="ph-suggestion-type">
          {t(`objects:types.${s.type}`)}
        </Tag>
        <Typography.Text strong ellipsis>
          {loc(s)}
        </Typography.Text>
      </span>
      <span className="ph-suggestion-sub">
        {other && other !== loc(s) && <span dir={locale === 'ar' ? 'ltr' : 'rtl'}>{other}</span>}
        {s.synonym && <span>≈ {s.synonym}</span>}
      </span>
    </span>
  );
}

interface TextBoxInternals {
  _textbox?: { content: HTMLElement };
  isActive(): boolean;
  cancel(): void;
}

/**
 * Autocomplete while a label is typed on the canvas (bpmn-js direct editing): matching dictionary
 * terms, roles and IT systems below the text box; arrow keys / Enter / Esc or the mouse choose.
 */
export function LabelAutocomplete({
  instance,
  onPick,
}: {
  instance: BpmnInstance | null;
  onPick: (element: DiagramElement, suggestion: LabelSuggestionDto) => void;
}) {
  const { t } = useTranslation();
  const { dir } = useLocale();
  const [target, setTarget] = useState<{ element: DiagramElement; box: HTMLElement } | null>(null);
  const [text, setText] = useState('');
  const [items, setItems] = useState<LabelSuggestionDto[]>([]);
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const state = useRef({ items, active, closed, target });
  state.current = { items, active, closed, target };
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // Follow bpmn-js direct editing.
  useEffect(() => {
    if (!instance) return;
    const eventBus = instance.get<EventBus>('eventBus');
    const directEditing = instance.get<TextBoxInternals>('directEditing');
    const onActivate = (e: { active: { element: DiagramElement } }) => {
      const box = directEditing._textbox?.content;
      if (!box) return;
      setTarget({ element: e.active.element, box });
      setText(box.innerText);
      setItems([]);
      setActive(-1);
      setClosed(true); // open once the user types
    };
    const onEnd = () => setTarget(null);
    eventBus.on('directEditing.activate', onActivate as never);
    eventBus.on(['directEditing.complete', 'directEditing.cancel'], onEnd);
    return () => {
      eventBus.off('directEditing.activate', onActivate as never);
      eventBus.off(['directEditing.complete', 'directEditing.cancel'], onEnd);
    };
  }, [instance]);

  // Keys and typing inside the text box. Capture phase: runs before the text box's own keys.
  useEffect(() => {
    if (!target) return;
    const { box, element } = target;
    const onInput = () => {
      setText(box.innerText);
      setClosed(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      if (s.closed || !s.items.length) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowDown') {
        stop();
        setActive((a) => (a + 1) % s.items.length);
      } else if (e.key === 'ArrowUp') {
        stop();
        setActive((a) => (a <= 0 ? s.items.length - 1 : a - 1));
      } else if (e.key === 'Enter' && !e.shiftKey && s.active >= 0) {
        stop();
        pick(element, s.items[s.active]);
      } else if (e.key === 'Escape') {
        stop();
        setClosed(true);
      }
    };
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKey, true);
    return () => {
      box.removeEventListener('input', onInput);
      box.removeEventListener('keydown', onKey, true);
    };
    // pick only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Debounced suggestions for the typed text.
  useEffect(() => {
    if (!target || closed || text.trim().length < 2) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchLabelSuggestions(text, sourceTypesFor(target.element))
        .then((res) => {
          if (cancelled) return;
          setItems(res);
          setActive(res.length ? 0 : -1);
        })
        .catch(() => !cancelled && setItems([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, text, closed]);

  const pick = (element: DiagramElement, s: LabelSuggestionDto) => {
    // Leave direct editing without applying the typed text, then set both labels and the link.
    instance?.get<TextBoxInternals>('directEditing').cancel();
    setTarget(null);
    pickRef.current(element, s);
  };

  if (!target || closed || !items.length) return null;
  const rect = target.box.getBoundingClientRect();
  const width = Math.max(rect.width, 300);
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 4,
    width,
    ...(dir === 'rtl'
      ? { right: Math.max(8, window.innerWidth - rect.right) }
      : { left: Math.min(rect.left, window.innerWidth - width - 8) }),
  };
  return createPortal(
    <div
      className="ph-label-suggest"
      style={style}
      dir={dir}
      role="listbox"
      aria-label={t('modeler:dictionary.suggestions')}
    >
      <div className="ph-label-suggest-head">{t('modeler:dictionary.suggestions')}</div>
      {items.map((s, i) => (
        <div
          key={s.id}
          role="option"
          aria-selected={i === active}
          className={`ph-label-suggest-item${i === active ? ' is-active' : ''}`}
          onMouseEnter={() => setActive(i)}
          // Keep the focus in the text box until the choice is applied.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(target.element, s);
          }}
        >
          <SuggestionItem s={s} />
        </div>
      ))}
      <div className="ph-label-suggest-foot">{t('modeler:dictionary.keysHint')}</div>
    </div>,
    document.body,
  );
}
