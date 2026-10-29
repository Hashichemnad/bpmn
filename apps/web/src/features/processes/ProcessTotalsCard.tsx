import { useMemo } from 'react';
import { Card, Col, Row, Statistic, Tooltip, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { parseBpmnGraph, processTotals } from '@processhub/shared';
import { useLinks, useProcessModel } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { formatMinutes } from '@/features/modeler/format-duration';

/**
 * Simple totals of the working model (Modeler design B2, D-086): steps, approval steps, decisions,
 * IT systems, roles and the planned time of the main (longest) path.
 */
export function ProcessTotalsCard({ processId }: { processId: string }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const model = useProcessModel(processId);
  const links = useLinks(processId);
  const totals = useMemo(() => {
    const xml = model.data?.bpmnXml;
    if (!xml) return null;
    return processTotals(
      parseBpmnGraph(xml),
      (links.data ?? []).map((l) => ({
        bpmnElementId: l.bpmnElementId,
        type: l.repoObject.type,
        objectId: l.repoObject.id,
      })),
    );
  }, [model.data?.bpmnXml, links.data]);
  if (!totals) return null;
  const items = [
    { key: 'steps', value: totals.steps },
    { key: 'approvals', value: totals.approvalSteps },
    { key: 'decisions', value: totals.decisions },
    { key: 'systems', value: totals.systems },
    { key: 'roles', value: totals.roles },
  ];
  return (
    <Card
      title={t('processes:totals.title')}
      style={{ marginBlockStart: 24 }}
      data-testid="process-totals"
    >
      <Row gutter={[16, 16]}>
        {items.map((i) => (
          <Col key={i.key} xs={12} sm={8} lg={4}>
            <Statistic title={t(`processes:totals.${i.key}`)} value={i.value} />
          </Col>
        ))}
        <Col xs={24} sm={16} lg={8}>
          <Statistic
            title={
              <span>
                {t('processes:totals.mainPath')}{' '}
                <Tooltip
                  title={t('processes:totals.mainPathHint', { count: totals.mainPath.length })}
                >
                  <InfoCircleOutlined />
                </Tooltip>
              </span>
            }
            value={
              totals.mainPathMinutes === null
                ? t('processes:totals.noTimes')
                : formatMinutes(totals.mainPathMinutes, t, locale)
            }
          />
        </Col>
      </Row>
      {totals.steps > 0 && totals.stepsWithoutDuration > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('processes:totals.withoutTime', { count: totals.stepsWithoutDuration })}
        </Typography.Text>
      )}
    </Card>
  );
}
