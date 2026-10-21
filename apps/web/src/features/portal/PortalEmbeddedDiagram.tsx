import { Link } from 'react-router-dom';
import { Alert, Button, Flex, Spin, Typography } from 'antd';
import { ExportOutlined, PartitionOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { usePortalProcess } from '@/api/portal';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';

/** Published diagram embedded in a published page (portal). */
export function PortalEmbeddedDiagram({ processId }: { processId: string }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const process = usePortalProcess(processId);
  if (process.isLoading) {
    return (
      <div className="ph-embed-box ph-center">
        <Spin />
      </div>
    );
  }
  if (process.isError || !process.data) {
    return (
      <div className="ph-embed-box">
        <Alert type="info" showIcon message={t('portal:diagramNotPublished')} />
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
        <Link to={`/portal/processes/${p.id}`}>
          <Button size="small" type="link" icon={<ExportOutlined />}>
            {t('portal:openProcess')}
          </Button>
        </Link>
      </Flex>
      {p.bpmnXml && <DiagramCanvas xml={p.bpmnXml} />}
    </div>
  );
}
