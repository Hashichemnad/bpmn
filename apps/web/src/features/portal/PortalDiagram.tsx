import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { PortalProcessDto } from '@processhub/shared';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import type {
  BpmnInstance,
  Canvas,
  DiagramElement,
  ElementRegistry,
  EventBus,
  Overlays,
} from '@/features/modeler/bpmn-types';
import { linkedProcessOf } from '@/features/modeler/diagram';
import { stepInfo, type StepInfo } from './step-info';

const SELECTABLE =
  /^bpmn:(Task|UserTask|ServiceTask|ManualTask|ScriptTask|BusinessRuleTask|SendTask|ReceiveTask|SubProcess|CallActivity|StartEvent|EndEvent|IntermediateCatchEvent|IntermediateThrowEvent|ExclusiveGateway|ParallelGateway|InclusiveGateway|EventBasedGateway)$/;

/**
 * Read-only published diagram: click a step to see its details; call activities linked to a
 * published process show a drill-down button. Steps with linked roles/systems get a marker.
 */
export function PortalDiagram({
  process,
  selectedId,
  onSelect,
}: {
  process: PortalProcessDto;
  selectedId: string | null;
  onSelect: (step: StepInfo | null) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const viewer = useRef<BpmnInstance | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const published = new Set(process.drillTargets.map((d) => d.id));
  const linked = new Set(process.links.map((l) => l.bpmnElementId));

  const mark = useCallback((id: string | null) => {
    const v = viewer.current;
    if (!v) return;
    const canvas = v.get<Canvas>('canvas');
    const registry = v.get<ElementRegistry>('elementRegistry');
    for (const el of registry.filter(() => true)) canvas.removeMarker(el.id, 'ph-step-selected');
    if (id && registry.get(id)) {
      canvas.addMarker(id, 'ph-step-selected');
    }
  }, []);

  const ready = (v: BpmnInstance) => {
    viewer.current = v;
    const registry = v.get<ElementRegistry>('elementRegistry');
    const overlays = v.get<Overlays>('overlays');
    const canvas = v.get<Canvas>('canvas');
    for (const el of registry.filter((e) => SELECTABLE.test(e.type))) {
      canvas.addMarker(el.id, 'ph-step-clickable');
      if (linked.has(el.id)) canvas.addMarker(el.id, 'ph-step-linked');
      const target = linkedProcessOf(el.businessObject);
      if (target && published.has(target)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ph-overlay-drill';
        button.textContent = '↗';
        button.title = t('portal:process.drillDown');
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          navigate(`/portal/processes/${target}`);
        });
        overlays.add(el.id, 'ph-drill', { position: { bottom: 10, left: 6 }, html: button });
      }
    }
    v.get<EventBus>('eventBus').on('element.click', (e: { element: DiagramElement }) => {
      const el = e.element.type === 'label' ? e.element.labelTarget : e.element;
      selectRef.current(el && SELECTABLE.test(el.type) ? stepInfo(el) : null);
    });
    if (selectedId) {
      const el = registry.get(selectedId);
      if (el) {
        selectRef.current(stepInfo(el));
        canvas.scrollToElement(el);
      }
    }
    mark(selectedId);
  };

  useEffect(() => mark(selectedId), [selectedId, mark]);

  if (!process.bpmnXml) return null;
  return <DiagramCanvas xml={process.bpmnXml} className="ph-portal-canvas" onReady={ready} />;
}
