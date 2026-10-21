import { useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Card, Col, List, Row, Segmented, Space, Typography } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@processhub/shared';
import { usePortalPage } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { RichTextView } from '@/features/docs/RichTextView';
import { useLanguageVersion } from '@/features/docs/useLanguageVersion';
import { FeedbackButton } from './FeedbackButton';
import { PortalMeta } from './PortalMeta';
import { PortalPageTree } from './PortalPageTree';
import { portalItemLink } from './portal-links';

interface Heading {
  level: number;
  text: string;
}

function headingsOf(html: string): Heading[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('h1, h2, h3')]
    .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' }))
    .filter((h) => h.text);
}

/** A published page: official version, table of contents, related processes. */
export function PortalPagePage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const page = usePortalPage(pageId);
  const { lang, setLang, fallback } = useLanguageVersion(page.data);
  const contentRef = useRef<HTMLDivElement>(null);
  const html = page.data ? (lang === 'ar' ? page.data.contentAr : page.data.contentEn) : '';
  const toc = useMemo(() => headingsOf(html), [html]);

  if (page.isLoading) return <LoadingState />;
  if (page.isError || !page.data)
    return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const p = page.data;
  const title = lang === 'ar' ? p.titleAr || p.titleEn : p.titleEn || p.titleAr;
  const dir = lang === 'ar' ? p.dirAr : p.dirEn;
  const scrollTo = (index: number) => {
    const el = contentRef.current?.querySelectorAll('h1, h2, h3')[index];
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('portal:nav.home'), to: '/portal' },
          { title: t('portal:nav.docs'), to: '/portal/docs' },
          { title: loc(p.space), to: `/portal/docs/${p.space.id}` },
          ...p.ancestors.map((a) => ({ title: loc(a, 'title'), to: `/portal/pages/${a.id}` })),
          { title: title || t('docs:untitled') },
        ]}
        title={<span dir={dir}>{title || t('docs:untitled')}</span>}
        extra={
          <>
            <Segmented
              value={lang}
              onChange={(l) => setLang(l as Locale)}
              options={[
                { value: 'en', label: 'EN', disabled: !p.hasEn },
                { value: 'ar', label: 'عربي', disabled: !p.hasAr },
              ]}
              aria-label={t('docs:pages.languageVersion')}
            />
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={() =>
                window.open(`/portal/print/pages/${p.id}?lang=${lang}`, '_blank', 'noopener')
              }
            >
              {t('portal:downloadPdf')}
            </Button>
            <FeedbackButton type="PAGE" id={p.id} />
          </>
        }
      />
      <PortalMeta meta={p.meta} />
      {fallback && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('docs:pages.fallbackNotice', {
            language: lang === 'ar' ? 'العربية' : 'English',
          })}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={{ span: 24, order: 2 }} lg={{ span: 6, order: 1 }}>
          <PortalPageTree spaceId={p.space.id} selectedId={p.id} />
        </Col>
        <Col xs={{ span: 24, order: 1 }} lg={{ span: 13, order: 2 }}>
          <Card className="ph-page-card">
            <div ref={contentRef} className="ph-portal-reading">
              <RichTextView key={`${p.id}-${lang}`} html={html} dir={dir} lang={lang} portal />
            </div>
          </Card>
          {p.children.length > 0 && (
            <Card size="small" title={t('docs:pages.subPages')} style={{ marginBlockStart: 16 }}>
              <List
                size="small"
                dataSource={p.children}
                renderItem={(c) => (
                  <List.Item>
                    <Link to={`/portal/pages/${c.id}`}>
                      {loc(c, 'title') || t('docs:untitled')}
                    </Link>
                  </List.Item>
                )}
              />
            </Card>
          )}
        </Col>
        <Col xs={{ span: 24, order: 3 }} lg={{ span: 5, order: 3 }}>
          <Space direction="vertical" size={16} style={{ inlineSize: '100%' }} className="ph-toc">
            {toc.length > 1 && (
              <Card size="small" title={t('portal:docs.toc')}>
                <nav aria-label={t('portal:docs.toc')} dir={dir}>
                  {toc.map((h, i) => (
                    <a
                      key={i}
                      href={`#h-${i}`}
                      className={h.level > 2 ? 'ph-toc-h3' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollTo(i);
                      }}
                    >
                      {h.text}
                    </a>
                  ))}
                </nav>
              </Card>
            )}
            <Card size="small" title={t('portal:docs.relatedProcesses')}>
              {p.relatedProcesses.length ? (
                <List
                  size="small"
                  dataSource={p.relatedProcesses}
                  renderItem={(r) => (
                    <List.Item>
                      <Link to={portalItemLink(r)}>
                        <span dir="ltr" className="ph-title-code" style={{ marginInlineEnd: 6 }}>
                          {r.code}
                        </span>
                        {loc(r, 'title')}
                      </Link>
                    </List.Item>
                  )}
                />
              ) : (
                <Typography.Text type="secondary">{t('portal:docs.noRelated')}</Typography.Text>
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </>
  );
}
