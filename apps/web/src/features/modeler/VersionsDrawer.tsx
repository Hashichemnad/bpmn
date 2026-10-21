import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Drawer, List, Modal, Tag, Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import type { ProcessVersionDto } from '@processhub/shared';
import { fetchVersion, useVersions } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { EmptyState, ErrorState } from '@/components/states';
import type { BpmnInstance, Canvas } from './bpmn-types';
import { applyLanguage, normaliseDiagram } from './diagram';
import { phModdleDescriptor } from './phModdle';

function VersionViewer({ xml }: { xml: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  useEffect(() => {
    if (!ref.current) return;
    const viewer = new NavigatedViewer({
      container: ref.current,
      moddleExtensions: { ph: phModdleDescriptor },
    }) as unknown as BpmnInstance;
    void viewer.importXML(xml).then(() => {
      normaliseDiagram(viewer);
      applyLanguage(viewer, locale);
      viewer.get<Canvas>('canvas').zoom('fit-viewport', 'auto');
    });
    return () => viewer.destroy();
  }, [xml, locale]);
  return <div ref={ref} dir="ltr" className="ph-version-canvas" />;
}

export function VersionsDrawer({ processId, open, onClose }: { processId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const versions = useVersions(processId);
  const [viewing, setViewing] = useState<(ProcessVersionDto & { bpmnXml: string }) | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const view = async (v: ProcessVersionDto) => {
    setLoadingId(v.id);
    try {
      setViewing(await fetchVersion(processId, v.id));
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <>
      <Drawer title={t('modeler:versionHistory')} open={open} onClose={onClose} width={440}>
        <Alert type="info" showIcon message={t('modeler:versionsPhase2')} style={{ marginBottom: 16 }} />
        {versions.isError ? (
          <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
        ) : (
          <List
            loading={versions.isLoading}
            dataSource={versions.data ?? []}
            locale={{ emptyText: <EmptyState description={t('modeler:noVersions')} /> }}
            renderItem={(v) => (
              <List.Item
                actions={[
                  <Button key="view" size="small" icon={<EyeOutlined />} loading={loadingId === v.id} onClick={() => void view(v)}>
                    {t('view')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      <Tag color="blue">v{v.versionNumber}</Tag>
                      {v.changeNote}
                    </span>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(v.createdAt)} · {loc(v.createdBy) || v.createdBy?.email || '—'}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
      <Modal
        title={viewing ? t('modeler:viewingVersion', { number: viewing.versionNumber }) : ''}
        open={!!viewing}
        onCancel={() => setViewing(null)}
        footer={null}
        width="min(1100px, 95vw)"
        destroyOnHidden
      >
        {viewing && (
          <>
            <Typography.Paragraph type="secondary">{viewing.changeNote}</Typography.Paragraph>
            <VersionViewer xml={viewing.bpmnXml} />
          </>
        )}
      </Modal>
    </>
  );
}
