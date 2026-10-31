import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Space, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { diagramElements, localized, type DiagramType } from '@processhub/shared';
import { useDiagram, useDiagramContent, usePortalDiagram } from '@/api/diagrams';
import { useLocale } from '@/app/LocaleProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { BrandMark } from '@/layout/BrandMark';
import { DiagramView } from './DiagramView';

/**
 * Print layout of a diagram (A4 / A3 landscape): header, the diagram and its elements in both
 * languages. The browser's print dialog saves it as PDF. `portal`: the published version;
 * otherwise the working draft (workspace export).
 */
export function PrintDiagramPage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams<{ id: string }>();
  // Printed in the reader's language (labels on the canvas follow it too).
  const { locale: lang } = useLocale();
  const { i18n } = useTranslation();
  const t = useMemo(() => i18n.getFixedT(lang), [i18n, lang]);
  const workspace = useDiagram(portal ? undefined : id);
  const draft = useDiagramContent(portal ? '' : (id ?? ''));
  const published = usePortalDiagram(portal ? id : undefined);

  const data = portal
    ? published.data && {
        type: published.data.type,
        code: published.data.code,
        nameEn: published.data.nameEn,
        nameAr: published.data.nameAr,
        descriptionEn: published.data.descriptionEn,
        descriptionAr: published.data.descriptionAr,
        version: published.data.meta.versionLabel ?? `v${published.data.meta.versionNumber}`,
        content: published.data.content,
      }
    : workspace.data &&
      draft.data && {
        type: workspace.data.type,
        code: workspace.data.code,
        nameEn: workspace.data.nameEn,
        nameAr: workspace.data.nameAr,
        descriptionEn: workspace.data.descriptionEn,
        descriptionAr: workspace.data.descriptionAr,
        version: t('diagrams:draft'),
        content: draft.data.content,
      };
  const error = portal ? published.error : (workspace.error ?? draft.error);
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const elements = diagramElements(data.type as DiagramType, data.content).filter(
    (e) => e.nameEn || e.nameAr,
  );
  return (
    <div className="ph-print ph-print-diagram" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <style>{'@page { size: A4 landscape; margin: 12mm; }'}</style>
      <div className="ph-print-toolbar no-print">
        <Space>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            {t('diagrams:print')}
          </Button>
        </Space>
      </div>
      <header className="ph-print-header">
        <BrandMark />
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <span dir="ltr">{data.code}</span> {localized(data, 'name', lang)}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(`diagrams:type.${data.type}`)} · {data.version}
          </Typography.Text>
        </div>
      </header>
      {localized(data, 'description', lang) && (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {localized(data, 'description', lang)}
        </Typography.Paragraph>
      )}
      <div className="ph-print-diagram-canvas">
        <DiagramView type={data.type as DiagramType} content={data.content} height="165mm" />
      </div>
      {elements.length > 0 && (
        <section className="ph-print-elements">
          <Typography.Title level={5}>{t('diagrams:elements')}</Typography.Title>
          <table>
            <thead>
              <tr>
                <th>{t('diagrams:fields.type')}</th>
                <th>English</th>
                <th>العربية</th>
              </tr>
            </thead>
            <tbody>
              {elements.map((e) => (
                <tr key={e.id}>
                  <td>{t(`diagrams:kinds.${e.kind}`, e.kind)}</td>
                  <td dir="ltr">{e.nameEn}</td>
                  <td dir="rtl">{e.nameAr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
