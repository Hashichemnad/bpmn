import { Node, mergeAttributes } from '@tiptap/core';
import { CALLOUT_TYPES, type CalloutType } from '@processhub/shared';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selection in an info/note/success/warning/danger panel (or changes its type). */
      setCallout: (type: CalloutType) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

/** Coloured info panel: `<div data-type="callout" data-callout="warning">…</div>`. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => {
          const v = el.getAttribute('data-callout');
          return (CALLOUT_TYPES as readonly string[]).includes(v ?? '') ? v : 'info';
        },
        renderHTML: (attrs) => ({ 'data-callout': attrs.type as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'callout' }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCallout:
        (type) =>
        ({ commands, editor }) =>
          editor.isActive(this.name)
            ? commands.updateAttributes(this.name, { type })
            : commands.wrapIn(this.name, { type }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});
