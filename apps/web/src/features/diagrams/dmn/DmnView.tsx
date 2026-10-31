import { useEffect, useRef, useState } from 'react';
import { Alert, Segmented } from 'antd';
import { useTranslation } from 'react-i18next';
import DmnViewer from 'dmn-js/lib/NavigatedViewer';
import { useLocale } from '@/app/LocaleProvider';
import './dmn-assets';
import { dmnName, type DmnInstance, type DmnView as View } from './dmn-types';
import { dmnForLocale } from './dmn-model';

/** Read-only DMN model: the decision requirements diagram and each decision table. */
export default function DmnView({
  xml,
  height = 480,
  decisionId,
}: {
  xml: string;
  height?: number | string;
  decisionId?: string;
  markers?: Record<string, string[]>;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DmnInstance | null>(null);
  const [views, setViews] = useState<View[]>([]);
  const [active, setActive] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const viewer = new DmnViewer({ container: ref.current }) as unknown as DmnInstance;
    viewerRef.current = viewer;
    let cancelled = false;
    viewer
      .importXML(dmnForLocale(xml, locale))
      .then(async () => {
        if (cancelled) return;
        const all = viewer.getViews();
        setViews(all);
        const first =
          all.find((v) => v.element.id === decisionId && v.type !== 'drd') ??
          (decisionId ? undefined : all.find((v) => v.type === 'decisionTable')) ??
          all[0];
        if (first) {
          await viewer.open(first);
          setActive(`${first.type}:${first.element.id}`);
        }
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      viewer.destroy();
    };
  }, [xml, decisionId, locale]);

  if (error)
    return (
      <Alert type="error" showIcon message={t('diagrams:invalidContent')} description={error} />
    );
  return (
    <div className="ph-dmn-view">
      {views.length > 1 && (
        <Segmented
          size="small"
          value={active}
          onChange={(v) => {
            const view = views.find((x) => `${x.type}:${x.element.id}` === v);
            if (view && viewerRef.current) {
              void viewerRef.current.open(view);
              setActive(String(v));
            }
          }}
          options={views.map((v) => ({
            value: `${v.type}:${v.element.id}`,
            label: v.type === 'drd' ? t('diagrams:dmn.drd') : dmnName(v.element, locale),
          }))}
        />
      )}
      <div ref={ref} dir="ltr" className="ph-dmn-container" style={{ height }} />
    </div>
  );
}
