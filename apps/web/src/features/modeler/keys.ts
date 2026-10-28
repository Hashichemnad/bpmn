/** True when a key press belongs to a field the user is typing in (never a modeler shortcut). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
    return true;
  // Dialogs and dropdowns (Ant Design portals) keep their own keys.
  return !!target.closest('.ant-modal-root, .ant-drawer, .ant-select-dropdown, .ant-dropdown');
}

/** Workspace shortcut of a key press outside fields: focus mode, shortcuts help, leave focus. */
export function workspaceShortcut(e: KeyboardEvent): 'focus' | 'help' | 'escape' | null {
  if (isTypingTarget(e.target)) return null;
  if (e.key === 'Escape') return 'escape';
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'f' || e.key === 'F') return 'focus';
  if (e.key === '?') return 'help';
  return null;
}
