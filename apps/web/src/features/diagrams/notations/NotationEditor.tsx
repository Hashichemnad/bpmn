import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DiagramDto } from '@processhub/shared';
import { GraphEditor } from '../GraphEditor';
import type { GraphInstance } from '../kit/graph-diagram';
import { ColourLegend, ValueChainProperties, ValueChainTools } from './ValueChain';
import { decorateValueChain, useColourBy, useValueChain } from './value-chain-view';
import { OrgChartProperties, OrgChartTools } from './OrgChart';
import { EpcConvert, EpcProperties, EpcValidation } from './Epc';
import { useEpcIssues } from './epc-view';
import type { Canvas } from '@/features/modeler/bpmn-types';

interface Props {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
}

/** Graph notation editors: the shared GraphEditor plus each notation's own fields and tools. */
export function NotationEditor(props: Props) {
  if (props.diagram.type === 'VALUE_CHAIN') return <ValueChainEditor {...props} />;
  if (props.diagram.type === 'ORG_CHART') return <OrgChartEditor {...props} />;
  if (props.diagram.type === 'EPC') return <EpcEditor {...props} />;
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

function OrgChartEditor(props: Props) {
  const canEdit = props.diagram.canEditContent && !props.readOnly;
  return (
    <GraphEditor
      {...props}
      renderProperties={(ctx) => <OrgChartProperties {...ctx} />}
      tools={(instance, reload) => (
        <OrgChartTools instance={instance} canEdit={canEdit} onApply={reload} />
      )}
    />
  );
}

function EpcEditor(props: Props) {
  const { t } = useTranslation();
  const [{ instance, tick, loaded }, onState] = useEditorState();
  const issues = useEpcIssues(loaded ? instance : null, tick);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  // Elements with a syntax warning get a marker on the canvas.
  useEffect(() => {
    if (!instance || !loaded) return;
    const canvas = instance.get<Canvas>('canvas');
    const ids = [...new Set(issues.flatMap((i) => (i.elementId ? [i.elementId] : [])))];
    for (const id of ids) canvas.addMarker(id, 'ph-epc-issue');
    return () => {
      for (const id of ids) {
        try {
          canvas.removeMarker(id, 'ph-epc-issue');
        } catch {
          /* element removed */
        }
      }
    };
  }, [instance, loaded, issues]);
  return (
    <GraphEditor
      {...props}
      onState={onState}
      saveRef={saveRef}
      renderProperties={(ctx) => <EpcProperties {...ctx} />}
      tools={() => (
        <EpcConvert
          diagram={props.diagram}
          issues={issues}
          beforeConvert={() => saveRef.current?.() ?? Promise.resolve(true)}
        />
      )}
      panels={() => [
        {
          key: 'validation',
          label: `${t('diagrams:dmn.validation')}${issues.length ? ` (${issues.length})` : ''}`,
          children: <EpcValidation issues={issues} instance={instance} />,
        },
      ]}
    />
  );
}
