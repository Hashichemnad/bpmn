import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DiagramDto } from '@processhub/shared';
import { GraphEditor } from '../GraphEditor';
import type { GraphInstance } from '../kit/graph-diagram';
import { ColourLegend, ValueChainProperties, ValueChainTools } from './ValueChain';
import { decorateValueChain, useColourBy, useValueChain } from './value-chain-view';

interface Props {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
}

/** Graph notation editors: the shared GraphEditor plus each notation's own fields and tools. */
export function NotationEditor(props: Props) {
  if (props.diagram.type === 'VALUE_CHAIN') return <ValueChainEditor {...props} />;
  return <GraphEditor {...props} />;
}

function useEditorState() {
  const [state, setState] = useState<{
    instance: GraphInstance | null;
    tick: number;
    loaded: boolean;
  }>({
    instance: null,
    tick: 0,
    loaded: false,
  });
  const onState = useCallback(
    (instance: GraphInstance | null, tick: number, loaded: boolean) =>
      setState({ instance, tick, loaded }),
    [],
  );
  return [state, onState] as const;
}

function ValueChainEditor(props: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [{ instance, tick, loaded }, onState] = useEditorState();
  const vc = useValueChain(loaded ? instance : null, tick);
  const legend = useColourBy(loaded ? instance : null, vc, tick);
  const canEdit = props.diagram.canEditContent && !props.readOnly;

  useEffect(() => {
    if (!instance || !loaded) return;
    decorateValueChain(instance, vc.facts, t, (n) =>
      navigate(n.diagramId ? `/diagrams/${n.diagramId}` : `/processes/${n.processId}`),
    );
  }, [instance, loaded, tick, vc.facts, t, navigate]);

  return (
    <GraphEditor
      {...props}
      onState={onState}
      renderProperties={(ctx) => <ValueChainProperties {...ctx} />}
      overlay={vc.mode !== 'none' && <ColourLegend items={legend} />}
      tools={(_, reload) => (
        <ValueChainTools
          mode={vc.mode}
          setMode={vc.setMode}
          canEdit={canEdit}
          onGenerate={reload}
        />
      )}
    />
  );
}
