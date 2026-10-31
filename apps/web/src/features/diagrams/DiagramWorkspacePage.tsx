import { lazy, Suspense, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isGraphDiagramType } from '@processhub/shared';
import { useDiagram } from '@/api/diagrams';
import { useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { NotationEditor } from './notations/NotationEditor';

const DmnEditor = lazy(() => import('./dmn/DmnEditor'));
const SipocEditor = lazy(() => import('./sipoc/SipocEditor'));

/**
 * /diagrams/:id/edit — full-screen workspace of a diagram (no app sidebar), the notation's editor.
 * `?view=1` opens read-only.
 */
export function DiagramWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const loc = useLocalized();
  const diagram = useDiagram(id);

  useEffect(() => {
    if (diagram.data)
      document.title = `${diagram.data.code} ${loc(diagram.data)} · ${t('modeler:workspace.title')}`;
  }, [diagram.data, loc, t]);

  if (diagram.isLoading) return <LoadingState />;
  if (diagram.isError || !diagram.data)
    return <ErrorState error={diagram.error} onRetry={() => void diagram.refetch()} />;
  const d = diagram.data;
  const props = {
    diagram: d,
    readOnly: params.get('view') === '1',
    onClose: () => navigate(`/diagrams/${d.id}`),
  };
  return (
    <Suspense fallback={<LoadingState />}>
      {isGraphDiagramType(d.type) ? (
        <NotationEditor key={d.id} {...props} />
      ) : d.type === 'DMN' ? (
        <DmnEditor key={d.id} {...props} />
      ) : (
        <SipocEditor key={d.id} {...props} />
      )}
    </Suspense>
  );
}
