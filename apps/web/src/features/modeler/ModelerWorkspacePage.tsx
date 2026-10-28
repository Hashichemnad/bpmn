import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProcess } from '@/api/hooks';
import { useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { BpmnEditor } from './BpmnEditor';

/**
 * /processes/:id/model — the modeler as a full-screen workspace without the app sidebar, process
 * tree or page header. `?element=` selects an element, `?view=1` opens read-only.
 */
export function ModelerWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const loc = useLocalized();
  const process = useProcess(id);

  useEffect(() => {
    if (process.data)
      document.title = `${process.data.code} ${loc(process.data)} · ${t('modeler:workspace.title')}`;
  }, [process.data, loc, t]);

  if (process.isLoading) return <LoadingState />;
  if (process.isError || !process.data)
    return <ErrorState error={process.error} onRetry={() => void process.refetch()} />;
  const element = params.get('element') ?? undefined;
  return (
    <BpmnEditor
      key={`${process.data.id}-${params.get('view') ?? ''}`}
      process={process.data}
      focusElementId={element}
      readOnly={params.get('view') === '1'}
      onClose={() =>
        navigate(
          `/processes/${process.data!.id}?tab=model${element ? `&element=${encodeURIComponent(element)}` : ''}`,
        )
      }
    />
  );
}
