import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@processhub/shared';
import { usePage } from '@/api/docs';
import { usePublicSettings } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RichTextView } from './RichTextView';
import { pageVersionFor } from './useLanguageVersion';

/**
 * Print layout of a page. The browser's print dialog saves it as PDF, which renders Arabic
 * text, RTL layout and embedded diagrams exactly as on screen (see DECISIONS D-024).
 */
export function PrintPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const settings = usePublicSettings();
  const page = usePage(pageId);
  const lang: Locale = params.get('lang') === 'ar' ? 'ar' : 'en';

  useEffect(() => {
    if (!page.data) return;
    // Give embedded diagrams time to render before opening the dialog.
    const id = setTimeout(() => window.print(), 1500);
    return () => clearTimeout(id);
  }, [page.data]);

  if (page.isLoading) return <LoadingState />;
  if (page.isError || !page.data) return <ErrorState error={page.error} />;
  const p = page.data;
  const v = pageVersionFor(p, lang);

  return (
    <div className="ph-print">
      <div className="ph-print-toolbar">
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          {t('docs:export.printPdf')}
        </Button>
        <Typography.Text type="secondary">{t('docs:export.printHint')}</Typography.Text>
      </div>
      <div dir={v.dir} lang={lang}>
        <header className="ph-print-header">
          <span>{loc({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr })}</span>
          <span>
            {loc(p.space)} · v{p.version}
          </span>
        </header>
        <h1>{v.title}</h1>
        <p className="ph-print-meta">
          {t('docs:pages.versionMeta', {
            version: p.version,
            time: formatDate(p.updatedAt),
            name: loc(p.updatedBy) || p.updatedBy?.email || '—',
          })}
        </p>
        <RichTextView html={v.html} dir={v.dir} lang={lang} />
      </div>
    </div>
  );
}
