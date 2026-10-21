import { Link } from 'react-router-dom';
import { Button, Card, Empty, Flex, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { localized, type ObjectType, type PortalProcessDto } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import type { StepInfo } from './step-info';

const GROUPS: { type: ObjectType; color: string }[] = [
  { type: 'ROLE', color: 'purple' },
  { type: 'SYSTEM', color: 'cyan' },
  { type: 'DOCUMENT', color: 'gold' },
  { type: 'RISK', color: 'red' },
  { type: 'CONTROL', color: 'green' },
  { type: 'KPI', color: 'blue' },
];

/** Role, IT systems, documents and description of the selected step. */
export function StepDetails({
  step,
  process,
  onClose,
}: {
  step: StepInfo | null;
  process: PortalProcessDto;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  if (!step) {
    return (
      <Card size="small">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('portal:process.clickStep')} />
      </Card>
    );
  }
  const links = process.links.filter((l) => l.bpmnElementId === step.id);
  const description = localized({ ...step }, 'description', locale);
  const typeKey = `modeler:types.${step.type.replace('bpmn:', '')}`;
  const drill = step.linkedProcessId
    ? process.drillTargets.find((d) => d.id === step.linkedProcessId)
    : undefined;
  return (
    <Card
      size="small"
      title={localized({ ...step }, 'name', locale) || step.id}
      extra={
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          aria-label={t('close')}
        />
      }
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {i18n.exists(typeKey) ? t(typeKey) : step.type}
      </Typography.Text>
      <Typography.Paragraph style={{ marginBlock: 8, whiteSpace: 'pre-wrap' }}>
        {description || (
          <Typography.Text type="secondary">
            {t('portal:process.noStepDescription')}
          </Typography.Text>
        )}
      </Typography.Paragraph>
      {GROUPS.map(({ type, color }) => {
        const items = links.filter((l) => l.object.type === type);
        if (!items.length) return null;
        return (
          <div key={type} style={{ marginBlockEnd: 10 }}>
            <Typography.Text strong style={{ display: 'block', marginBlockEnd: 4 }}>
              {t(`portal:process.linked.${type}`)}
            </Typography.Text>
            <Space direction="vertical" size={4} style={{ inlineSize: '100%' }}>
              {items.map((l) => (
                <div key={`${l.object.id}-${l.relation}`}>
                  <Flex gap={6} align="center" wrap="wrap">
                    <Tag color={color}>{loc(l.object)}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t(`objects:relations.${l.relation}`)}
                    </Typography.Text>
                  </Flex>
                  {loc(l.object, 'description') && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {loc(l.object, 'description')}
                    </Typography.Text>
                  )}
                </div>
              ))}
            </Space>
          </div>
        );
      })}
      {!links.length && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {t('portal:process.noLinks')}
        </Typography.Text>
      )}
      {drill && (
        <Link to={`/portal/processes/${drill.id}`}>
          <Button
            type="primary"
            size="small"
            icon={<ArrowRightOutlined />}
            style={{ marginBlockStart: 8 }}
          >
            {t('portal:process.openSub', { name: `${drill.code} ${loc(drill)}` })}
          </Button>
        </Link>
      )}
    </Card>
  );
}
