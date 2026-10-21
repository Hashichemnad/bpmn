import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockDirection: {
      /** Sets the text direction of the selected blocks; null follows the page direction. */
      setBlockDirection: (dir: 'ltr' | 'rtl' | null) => ReturnType;
    };
  }
}

export const DIRECTIONAL_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'taskItem',
  'callout',
  'tableCell',
  'tableHeader',
  'codeBlock',
];

/**
 * Per-paragraph LTR/RTL. Only explicit choices are stored (`dir` attribute); everything
 * else inherits the direction of the page's language version.
 */
export const BlockDirection = Extension.create({
  name: 'blockDirection',

  addGlobalAttributes() {
    return [
      {
        types: DIRECTIONAL_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => {
              const d = el.getAttribute('dir');
              return d === 'ltr' || d === 'rtl' ? d : null;
            },
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir as string } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockDirection:
        (dir) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!DIRECTIONAL_TYPES.includes(node.type.name)) return;
            changed = true;
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, dir });
          });
          return changed;
        },
    };
  },
});
