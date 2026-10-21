import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Flex, Spin, Typography } from 'antd';
import { ExportOutlined, PartitionOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { useProcess, useProcessModel } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import type { BpmnInstance, Canvas } from '@/features/modeler/bpmn-types';
import { applyLanguage, normaliseDiagram } from '@/features/modeler/diagram';
import { phModdleDescriptor } from '@/features/modeler/phModdle';

/** Renders BPMN XML read-only (pan/zoom), in the active language. */
export function DiagramCanvas({
  xml,
  className = 'ph-embed-canvas',
  onReady,
}: {
  xml: string;
  className?: string;
  onReady?: (viewer: BpmnInstance) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  const [error, setError] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!ref.current) return;
    const viewer = new NavigatedViewer({
      container: ref.current,
      moddleExtensions: { ph: phModdleDescriptor },
    }) as unknown as BpmnInstance;
    let alive = true;
    viewer
      .importXML(xml)
      .then(() => {
        if (!alive) return;
        normaliseDiagram(viewer);
        applyLanguage(viewer, locale);
        viewer.get<Canvas>('canvas').zoom('fit-viewport', 'auto');
        readyRef.current?.(viewer);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      viewer.destroy();
    };
  }, [xml, locale]);

  const { t } = useTranslation();
  if (error) return <Alert type="warning" showIcon message={t('docs:diagram.invalid')} />;
  return <div ref={ref} dir="ltr" className={className} />;
}

/** Diagram of a repository process embedded in a wiki page. */
export function EmbeddedDiagram({ processId }: { processId: string }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const process = useProcess(processId);
  const model = useProcessModel(processId);

  if (process.isLoading || model.isLoading) {
    return (
      <div className="ph-embed-box ph-center">
        <Spin />
      </div>
    );
  }
  if (process.isError || !process.data) {
    return (
      <div className="ph-embed-box">
        <Alert type="info" showIcon message={t('docs:diagram.unavailable')} />
      </div>
    );
  }
  const p = process.data;
  return (
    <div className="ph-embed-box">
      <Flex justify="space-between" align="center" className="ph-embed-header" gap={8}>
        <Typography.Text strong>
          <PartitionOutlined /> <span dir="ltr">{p.code}</span> {loc(p)}
        </Typography.Text>
        <Link to={`/processes/${p.id}?tab=model`}>
          <Button size="small" type="link" icon={<ExportOutlined />}>
            {t('docs:diagram.open')}
          </Button>
        </Link>
      </Flex>
      {model.data?.bpmnXml ? (
        <DiagramCanvas xml={model.data.bpmnXml} />
      ) : (
        <Typography.Text type="secondary" className="ph-embed-empty">
          {t('docs:diagram.noModel')}
        </Typography.Text>
      )}
    </div>
  );
}
