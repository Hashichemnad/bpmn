import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { isAllowedHref } from '@processhub/shared';
import { Callout } from './Callout';
import { BpmnDiagram } from './BpmnDiagramNode';
import { BlockDirection } from './BlockDirection';

/** The wiki's TipTap schema, shared by the editor and the read-only renderer. */
export function wikiExtensions({ placeholder }: { placeholder?: string } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isAllowedHref(url),
      },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    BpmnDiagram,
    BlockDirection,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}
