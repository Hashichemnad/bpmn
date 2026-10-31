import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import alignIcons from 'bpmn-js/lib/features/align-elements/AlignElementsIcons';
import distributeIcons from 'bpmn-js/lib/features/distribute-elements/DistributeElementsIcons';
import type { DiagramElement, DiagramServices } from './bpmn-types';

const ALIGN = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
const DISTRIBUTE = ['horizontal', 'vertical'] as const;

/** Shapes the align / distribute tools work on (no connections, labels, lanes or pools). */
const layoutTargets = (selection: DiagramElement[]) =>
  selection.filter(
    (e) =>
      !('waypoints' in e) &&
      !['label', 'bpmn:Lane', 'bpmn:Participant'].includes(e.type) &&
      !!e.businessObject,
  );

/** Floating toolbar shown while several shapes are selected: align and distribute (bpmn-js). */
export function LayoutToolbar({
  instance,
  selection,
}: {
  instance: DiagramServices;
  selection: DiagramElement[];
}) {
  const { t } = useTranslation();
  const targets = layoutTargets(selection);
  if (targets.length < 2) return null;
  const icon = (svg: string) => (
    // Static icons shipped with bpmn-js.
    <span className="ph-layout-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  );
  return (
    <div className="ph-layout-toolbar" role="toolbar" aria-label={t('modeler:layout.toolbar')}>
      {ALIGN.map((a) => (
        <Tooltip key={a} title={t(`modeler:layout.align.${a}`)}>
          <Button
            size="small"
            type="text"
            icon={icon(alignIcons[a])}
            aria-label={t(`modeler:layout.align.${a}`)}
            onClick={() =>
              instance
                .get<{ trigger(e: DiagramElement[], t: string): void }>('alignElements')
                .trigger(targets, a)
            }
          />
        </Tooltip>
      ))}
      <span className="ph-layout-sep" />
      {DISTRIBUTE.map((d) => (
        <Tooltip key={d} title={t(`modeler:layout.distribute.${d}`)}>
          <Button
            size="small"
            type="text"
            disabled={targets.length < 3}
            icon={icon(distributeIcons[d])}
            aria-label={t(`modeler:layout.distribute.${d}`)}
            onClick={() =>
              instance
                .get<{ trigger(e: DiagramElement[], t: string): void }>('distributeElements')
                .trigger(targets, d)
            }
          />
        </Tooltip>
      ))}
    </div>
  );
}
