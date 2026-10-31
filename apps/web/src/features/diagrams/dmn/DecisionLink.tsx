import { useMemo, useState } from 'react';
import { Button, Modal, Select, Space, Typography } from 'antd';
import { ExportOutlined, TableOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAllDiagrams, useDiagramContent } from '@/api/diagrams';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramView } from '../DiagramView';
import { readDecisions } from './dmn-model';

/**
 * Business rule task → DMN decision (`ph:decisionRef` = DMN diagram, `ph:decisionId` = decision,
 * D-123): choose the table in the modeler side panel and look at it without leaving the model.
 */
export function DecisionLink({
  decisionRef,
  decisionId,
  canEdit,
  onChange,
}: {
  decisionRef: string | null;
  decisionId: string | null;
  canEdit: boolean;
  onChange: (decisionRef: string | null, decisionId: string | null) => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const diagrams = useAllDiagrams();
  const [viewing, setViewing] = useState(false);
  const dmn = (diagrams.data ?? []).filter((d) => d.type === 'DMN');
  const content = useDiagramContent(decisionRef ?? '');
  const decisions = useMemo(() => {
    try {
      return decisionRef && content.data ? readDecisions(content.data.content) : [];
    } catch {
      return [];
    }
  }, [decisionRef, content.data]);
  const linked = dmn.find((d) => d.id === decisionRef);
  return (
    <div className="ph-panel-section" data-testid="decision-link">
      <Typography.Text strong>
        <TableOutlined /> {t('diagrams:dmn.linkTitle')}
      </Typography.Text>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>
        {t('diagrams:dmn.linkHint')}
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select
          allowClear
          showSearch
          size="small"
          style={{ width: '100%' }}
          optionFilterProp="label"
          disabled={!canEdit}
          value={decisionRef}
          placeholder={t('diagrams:dmn.chooseTable')}
          data-testid="decision-diagram"
          options={dmn.map((d) => ({ value: d.id, label: `${d.code} ${loc(d)}` }))}
          onChange={(id: string | null) => onChange(id ?? null, null)}
        />
        {decisionRef && decisions.length > 1 && (
          <Select
            size="small"
            style={{ width: '100%' }}
            disabled={!canEdit}
            value={decisionId ?? decisions[0]?.id}
            options={decisions.map((d) => ({ value: d.id, label: loc(d) || d.id }))}
            onChange={(id: string) => onChange(decisionRef, id)}
          />
        )}
        {linked && (
          <Space wrap>
            <Button
              size="small"
              icon={<TableOutlined />}
              onClick={() => setViewing(true)}
              data-testid="decision-view"
            >
              {t('diagrams:dmn.viewTable')}
            </Button>
            <Button
              size="small"
              type="link"
              icon={<ExportOutlined />}
              onClick={() => navigate(`/diagrams/${linked.id}`)}
            >
              {t('diagrams:dmn.openTable')}
            </Button>
          </Space>
        )}
      </Space>
      <Modal
        open={viewing}
        onCancel={() => setViewing(false)}
        footer={null}
        width="min(1100px, 95vw)"
        title={linked ? `${linked.code} ${loc(linked)}` : ''}
        destroyOnHidden
      >
        {content.data && (
          <DiagramView
            type="DMN"
            content={content.data.content}
            decisionId={decisionId ?? decisions[0]?.id}
            height={460}
          />
        )}
      </Modal>
    </div>
  );
}
