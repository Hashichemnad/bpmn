import { Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const CTRL = isMac ? '⌘' : 'Ctrl';

/** Keyboard shortcuts of the modeler (keys stay Latin in both languages). */
const SHORTCUTS: { keys: string[]; action: string; edit?: boolean }[] = [
  { keys: [`${CTRL}+Z`], action: 'undo', edit: true },
  { keys: [`${CTRL}+Y`, `${CTRL}+Shift+Z`], action: 'redo', edit: true },
  { keys: [`${CTRL}+C`], action: 'copy', edit: true },
  { keys: [`${CTRL}+V`], action: 'paste', edit: true },
  { keys: ['Delete', 'Backspace'], action: 'delete', edit: true },
  { keys: [`${CTRL}+A`], action: 'selectAll', edit: true },
  { keys: ['← ↑ → ↓', 'Shift+←'], action: 'move', edit: true },
  { keys: [`${CTRL}+F`], action: 'search', edit: true },
  { keys: ['E'], action: 'editLabel', edit: true },
  { keys: ['H'], action: 'hand', edit: true },
  { keys: ['L'], action: 'lasso', edit: true },
  { keys: ['S'], action: 'space', edit: true },
  { keys: ['C'], action: 'connect', edit: true },
  { keys: [`${CTRL}+S`], action: 'saveVersion', edit: true },
  { keys: [`${CTRL}+wheel`, `${CTRL}++`, `${CTRL}+−`], action: 'zoom' },
  { keys: ['Space+drag', 'wheel'], action: 'pan' },
  { keys: ['F'], action: 'focus' },
  { keys: ['Esc'], action: 'escape' },
  { keys: ['?'], action: 'help' },
];

export function ShortcutsDialog({
  open,
  canEdit,
  onClose,
}: {
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t('modeler:shortcuts.title')}>
      <Typography.Paragraph type="secondary">{t('modeler:shortcuts.hint')}</Typography.Paragraph>
      <table className="ph-shortcuts">
        <tbody>
          {SHORTCUTS.filter((s) => canEdit || !s.edit).map((s) => (
            <tr key={s.action}>
              <th scope="row">{t(`modeler:shortcuts.actions.${s.action}`)}</th>
              <td dir="ltr">
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
