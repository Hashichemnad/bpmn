import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { localized, type Locale } from '@processhub/shared';
import { usePortalPage } from '@/api/portal';
import { usePublicSettings } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/states';
import { RichTextView } from '@/features/docs/RichTextView';

/** Print layout of a published page in the requested language (browser "Save as PDF"). */
export function PortalPrintPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const [params] = useSearchParams();
  const { i18n } = useTranslation();
  const settings = usePublicSettings();
  const page = usePortalPage(pageId);
  const requested: Locale = params.get('lang') === 'ar' ? 'ar' : 'en';
  const lang: Locale =
    page.data && !(requested === 'ar' ? page.data.hasAr : page.data.hasEn)
      ? requested === 'ar'
        ? 'en'
        : 'ar'
      : requested;
  const t = useMemo(() => i18n.getFixedT(lang), [i18n, lang]);
  // Dates in the language of the document, not of the screen.
  const formatDate = (iso: string | null | undefined, withTime = true) =>
    iso
      ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
          dateStyle: 'medium',
          ...(withTime ? { timeStyle: 'short' } : {}),
        }).format(new Date(iso))
      : '—';

  useEffect(() => {
    if (!page.data) return;
    // Give embedded diagrams time to render before opening the dialog.
    const id = setTimeout(() => window.print(), 1500);
    return () => clearTimeout(id);
  }, [page.data]);

  if (page.isLoading) return <LoadingState />;
  if (page.isError || !page.data) return <ErrorState error={page.error} />;
  const p = page.data;
  const l = (e: unknown, field = 'name') => localized(e as Record<string, unknown>, field, lang);
  return (
    <div className="ph-print">
      <div className="ph-print-toolbar">
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          {t('docs:export.printPdf')}
        </Button>
        <Typography.Text type="secondary">{t('docs:export.printHint')}</Typography.Text>
      </div>
      <div dir={lang === 'ar' ? p.dirAr : p.dirEn} lang={lang}>
        <header className="ph-print-header">
          <span>{l({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr })}</span>
          <span>
            {l(p.space)} · {t('governance:official')} ·{' '}
            {p.meta.versionLabel || t('governance:versionN', { number: p.meta.versionNumber })}
          </span>
        </header>
        <h1>{l(p, 'title')}</h1>
        <p className="ph-print-meta">
          {t('portal:print.pageMeta', {
            approved: p.meta.approvedAt ? formatDate(p.meta.approvedAt, false) : '—',
            owner: p.meta.owner ? l(p.meta.owner) || p.meta.owner.email : '—',
            next: p.meta.nextReviewAt ? formatDate(p.meta.nextReviewAt, false) : '—',
          })}
        </p>
        <RichTextView
          html={lang === 'ar' ? p.contentAr : p.contentEn}
          dir={lang === 'ar' ? p.dirAr : p.dirEn}
          lang={lang}
          portal
        />
        <p className="ph-print-meta">
          {t('portal:print.footer', { date: formatDate(new Date().toISOString()) })}
        </p>
      </div>
    </div>
  );
}
