import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Modal, Space } from 'antd';
import { TableOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { usePortalDiagram } from '@/api/diagrams';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramView } from '../DiagramView';

/**
 * The decision table of a business rule step in the portal (read-only), when the table is
 * published (D-123). Unpublished tables are not shown (the portal answers 404).
 */
export function PortalDecision({
  diagramId,
  decisionId,
}: {
  diagramId: string;
  decisionId: string | null;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const diagram = usePortalDiagram(diagramId);
  const [open, setOpen] = useState(false);
  if (!diagram.data) return null;
  const d = diagram.data;
  return (
    <div style={{ marginBlockStart: 12 }} data-testid="portal-decision">
      <Space wrap>
        <Button size="small" icon={<TableOutlined />} onClick={() => setOpen(true)}>
          {t('diagrams:dmn.stepTitle')}: {loc(d)}
        </Button>
        <Link to={`/portal/diagrams/${d.id}`}>{t('diagrams:dmn.openTable')}</Link>
      </Space>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(1100px, 95vw)"
        title={`${d.code} ${loc(d)}`}
        destroyOnHidden
      >
        <DiagramView
          type="DMN"
          content={d.content}
          decisionId={decisionId ?? undefined}
          height={460}
        />
      </Modal>
    </div>
  );
}
