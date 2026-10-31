import { lazy, Suspense, useMemo } from 'react';
import { Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  parseDiagramContent,
  type DiagramType,
  type GraphContent,
  type SipocContent,
} from '@processhub/shared';
import { LoadingState } from '@/components/states';
import { GraphCanvas, type GraphCanvasProps } from './GraphCanvas';
import { SipocTable } from './sipoc/SipocTable';

const DmnView = lazy(() => import('./dmn/DmnView'));

interface Props extends Pick<
  GraphCanvasProps,
  'markers' | 'onElementClick' | 'onReady' | 'className'
> {
  type: DiagramType;
  content: string;
  height?: number | string;
  /** DMN: the decision whose table opens first. */
  decisionId?: string;
}

/** Read-only view of any diagram type (portal, review, versions, print). */
export function DiagramView({ type, content, height = 480, decisionId, ...rest }: Props) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseDiagramContent(type, content), [type, content]);
  if (!parsed.ok) return <Alert type="error" showIcon message={t('diagrams:invalidContent')} />;
  if (type === 'DMN')
    return (
      <Suspense fallback={<LoadingState />}>
        <DmnView xml={content} height={height} decisionId={decisionId} markers={rest.markers} />
      </Suspense>
    );
  if (type === 'SIPOC')
    return <SipocTable content={parsed.content as SipocContent} markers={rest.markers} />;
  return <GraphCanvas content={parsed.content as GraphContent} height={height} {...rest} />;
}
