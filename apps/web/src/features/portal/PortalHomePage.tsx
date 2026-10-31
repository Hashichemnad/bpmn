import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Col, Input, Row, Space, Statistic, Typography } from 'antd';
import {
  ApartmentOutlined,
  LinkOutlined,
  PartitionOutlined,
  ReadOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { AiButton, AiSuggestionChips } from '@/features/ai/AiParts';
import { usePortalAssistant } from '@/features/ai/portal-assistant-context';
import { usePortalHome, usePortalProcesses } from '@/api/portal';
import { usePortalDiagram } from '@/api/diagrams';
import { PortalStartValueChain } from '@/features/diagrams/PortalDiagramCanvas';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { PortalItemCard } from './PortalItemCard';
import { ProcessHouse } from './ProcessHouse';

/** Portal home: search, process house, featured and recently updated content, quick links. */
export function PortalHomePage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const home = usePortalHome();
  const tree = usePortalProcesses();
  if (home.isLoading) return <LoadingState />;
  if (home.isError || !home.data)
    return <ErrorState error={home.error} onRetry={() => void home.refetch()} />;
  const h = home.data;
  const external = (url: string) => /^https?:/i.test(url);

  return (
    <>
      <section className="ph-portal-hero">
        <h1>{loc(h) || t('portal:name')}</h1>
        <p>{loc(h, 'tagline') || t('portal:tagline')}</p>
        <div>
          <Input.Search
            size="large"
            enterButton={t('portal:nav.search')}
            placeholder={t('portal:searchHero')}
            onSearch={(v) =>
              v.trim() && navigate(`/portal/search?q=${encodeURIComponent(v.trim())}`)
            }
          />
        </div>
        <PortalAskHero />
        <Space size={24} style={{ marginBlockStart: 20 }} wrap>
          <Statistic
            title={<span style={{ color: '#dbeafe' }}>{t('portal:counts.processes')}</span>}
            value={h.counts.processes}
            valueStyle={{ color: '#fff' }}
            prefix={<PartitionOutlined />}
          />
          <Statistic
            title={<span style={{ color: '#dbeafe' }}>{t('portal:counts.pages')}</span>}
            value={h.counts.pages}
            valueStyle={{ color: '#fff' }}
            prefix={<ReadOutlined />}
          />
          {h.counts.diagrams > 0 && (
            <Statistic
              title={<span style={{ color: '#dbeafe' }}>{t('diagrams:portal.title')}</span>}
              value={h.counts.diagrams}
              valueStyle={{ color: '#fff' }}
              prefix={<ApartmentOutlined />}
            />
          )}
        </Space>
      </section>

      {h.quickLinks.length > 0 && (
        <Space wrap size={8} style={{ marginBlockEnd: 8 }}>
          {h.quickLinks.map((l, i) => (
            <Button
              key={i}
              icon={<LinkOutlined />}
              href={external(l.url) ? l.url : undefined}
              target={external(l.url) ? '_blank' : undefined}
              rel={external(l.url) ? 'noopener noreferrer' : undefined}
              onClick={external(l.url) ? undefined : () => navigate(l.url)}
            >
              {loc(l, 'title')}
            </Button>
          ))}
        </Space>
      )}

      {h.startDiagram && <StartValueChain id={h.startDiagram.id} />}

      <Typography.Title level={4} className="ph-portal-section-title">
        {t('portal:house')}
      </Typography.Title>
      {tree.isLoading ? <LoadingState /> : <ProcessHouse nodes={tree.data ?? []} />}

      {h.featured.length > 0 && (
        <>
          <Typography.Title level={4} className="ph-portal-section-title">
            <StarOutlined /> {t('portal:featured')}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {h.featured.map((f) => (
              <Col xs={24} md={12} lg={8} key={f.id}>
                <PortalItemCard item={f} />
              </Col>
            ))}
          </Row>
        </>
      )}

      <Typography.Title level={4} className="ph-portal-section-title">
        {t('portal:recent')}
      </Typography.Title>
      {h.recent.length ? (
        <Row gutter={[16, 16]}>
          {h.recent.map((f) => (
            <Col xs={24} md={12} lg={6} key={f.id}>
              <PortalItemCard item={f} />
            </Col>
          ))}
        </Row>
      ) : (
        <Card>
          <Typography.Text type="secondary">{t('portal:nothingPublished')}</Typography.Text>
        </Card>
      )}
    </>
  );
}

/** Ask the assistant from the portal home page (sample questions as chips). */
function PortalAskHero() {
  const { t } = useTranslation();
  const assistant = usePortalAssistant();
  if (!assistant) return null;
  return (
    <div className="ph-portal-ask">
      <AiButton onClick={() => assistant.ask()}>{t('ai:portal.askHero')}</AiButton>
      <AiSuggestionChips feature="PORTAL_QA" onPick={(q) => assistant.ask(q)} />
    </div>
  );
}

/** The value chain chosen as the portal's start page, with drill-down (D-126). */
function StartValueChain({ id }: { id: string }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const diagram = usePortalDiagram(id);
  if (!diagram.data) return null;
  return (
    <section className="ph-portal-start" data-testid="portal-start-value-chain">
      <Typography.Title level={4} className="ph-portal-section-title">
        <Link to={`/portal/diagrams/${id}`}>
          {loc(diagram.data) || t('diagrams:type.VALUE_CHAIN')}
        </Link>
      </Typography.Title>
      <Card size="small">
        <PortalStartValueChain diagram={diagram.data} />
      </Card>
    </section>
  );
}
