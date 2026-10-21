import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Button, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { EmbeddedDiagram } from '../EmbeddedDiagram';
import { useRenderMode } from '../embed-context';
import { PortalEmbeddedDiagram } from '@/features/portal/PortalEmbeddedDiagram';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bpmnDiagram: {
      insertBpmnDiagram: (processId: string) => ReturnType;
    };
  }
}

function DiagramNodeView({ node, editor, deleteNode, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const processId = node.attrs.processId as string;
  const mode = useRenderMode();
  return (
    <NodeViewWrapper
      className={`ph-embed${selected && editor.isEditable ? ' ph-embed-selected' : ''}`}
      data-drag-handle=""
      contentEditable={false}
    >
      {editor.isEditable && (
        <Tooltip title={t('docs:editor.removeDiagram')}>
          <Button
            size="small"
            danger
            className="ph-embed-remove"
            icon={<DeleteOutlined />}
            aria-label={t('docs:editor.removeDiagram')}
            onClick={deleteNode}
          />
        </Tooltip>
      )}
      {mode === 'portal' ? (
        <PortalEmbeddedDiagram processId={processId} />
      ) : (
        <EmbeddedDiagram processId={processId} />
      )}
    </NodeViewWrapper>
  );
}

/** Read-only BPMN diagram of a repository process: `<div data-type="bpmn-diagram" data-process-id>`. */
export const BpmnDiagramSchema = Node.create({
  name: 'bpmnDiagram',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      processId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-process-id'),
        renderHTML: (attrs) => ({ 'data-process-id': attrs.processId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bpmn-diagram"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'bpmn-diagram' }, HTMLAttributes)];
  },

  addCommands() {
    return {
      // A paragraph after the atom keeps the cursor out of it, so the next insert or
      // keystroke does not replace the diagram.
      insertBpmnDiagram:
        (processId) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { processId } },
            { type: 'paragraph' },
          ]),
    };
  },
});

/** With the React node view that renders the diagram (editor and reader). */
export const BpmnDiagram = BpmnDiagramSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DiagramNodeView);
  },
});
