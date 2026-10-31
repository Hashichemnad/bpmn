import type { KeyboardEvent } from 'react';

/**
 * Props that make a non-button element (tag, card, list item) work like a button for keyboard and
 * screen-reader users: focusable, announced as a button, activated with Enter or Space
 * (final session, part A).
 */
export function activateProps(onActivate: () => void, disabled = false) {
  return {
    role: 'button' as const,
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined,
    onClick: disabled ? undefined : onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      onActivate();
    },
  };
}
