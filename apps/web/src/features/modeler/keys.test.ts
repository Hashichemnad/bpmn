import { describe, expect, it } from 'vitest';
import { isTypingTarget, workspaceShortcut } from './keys';

const key = (target: EventTarget, init: KeyboardEventInit) => {
  let seen: KeyboardEvent | null = null;
  target.addEventListener('keydown', (e) => (seen = e as KeyboardEvent), { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  return seen!;
};

describe('workspace shortcuts', () => {
  it('ignore keys typed in fields, editors and dialogs', () => {
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea><div contenteditable="true" id="c"></div>
      <div class="ant-modal-root"><button id="m">ok</button></div><div id="canvas" tabindex="0"></div>`;
    for (const id of ['i', 't', 'c', 'm']) {
      const el = document.getElementById(id)!;
      expect(isTypingTarget(el)).toBe(true);
      expect(workspaceShortcut(key(el, { key: 'f' }))).toBeNull();
    }
    const canvas = document.getElementById('canvas')!;
    expect(workspaceShortcut(key(canvas, { key: 'f' }))).toBe('focus');
    expect(workspaceShortcut(key(canvas, { key: '?', shiftKey: true }))).toBe('help');
    expect(workspaceShortcut(key(canvas, { key: 'Escape' }))).toBe('escape');
    expect(workspaceShortcut(key(canvas, { key: 'f', ctrlKey: true }))).toBeNull();
  });
});
