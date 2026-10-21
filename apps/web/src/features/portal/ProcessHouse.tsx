import { Link } from 'react-router-dom';
import { Col, Empty, Row, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { PROCESS_CATEGORIES, type PortalProcessNodeDto } from '@processhub/shared';
import { CATEGORY_COLORS } from '@/components/colors';
import { useLocalized } from '@/components/i18n-helpers';

/** Management / Core / Support bands with the top-level published processes. */
export function ProcessHouse({ nodes }: { nodes: PortalProcessNodeDto[] }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const children = (id: string) => nodes.filter((n) => n.parentId === id).length;
  if (!nodes.length) return <Empty description={t('portal:noProcesses')} />;
  return (
    <>
      {PROCESS_CATEGORIES.map((c) => {
        const top = nodes.filter((n) => n.category === c && !n.parentId);
        if (!top.length) return null;
        return (
          <div
            key={c}
            className="ph-portal-band"
            style={{ ['--ph-band' as string]: CATEGORY_COLORS[c] }}
          >
            <Typography.Text
              strong
              style={{ color: CATEGORY_COLORS[c], display: 'block', marginBlockEnd: 10 }}
            >
              {t(`processes:category.${c}`)}
            </Typography.Text>
            <Row gutter={[10, 10]}>
              {top.map((n) => (
                <Col xs={24} sm={12} md={8} lg={6} key={n.id}>
                  <Link to={`/portal/processes/${n.id}`} className="ph-portal-tile">
                    <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
                      {n.code}
                    </Typography.Text>
                    <div style={{ fontWeight: 600 }}>{loc(n)}</div>
                    {children(n.id) > 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('portal:subProcessCount', { count: children(n.id) })}
                      </Typography.Text>
                    )}
                  </Link>
                </Col>
              ))}
            </Row>
          </div>
        );
      })}
    </>
  );
}
