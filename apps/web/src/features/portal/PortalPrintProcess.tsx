import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Segmented, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DIAGRAM_THEME,
  THEME_KINDS,
  localized,
  type Locale,
  type ObjectType,
  type ThemeColour,
} from '@processhub/shared';
import { usePortalProcess } from '@/api/portal';
import { usePublicSettings } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/states';
import type { ElementRegistry } from '@/features/modeler/bpmn-types';
import { applyLanguage, normaliseDiagram } from '@/features/modeler/diagram';
import { createDiagram, importDiagram } from '@/features/modeler/create-diagram';
import { embedDiagramFonts } from '@/features/modeler/export-fonts';
import { BrandMark } from '@/layout/BrandMark';
import { stepInfo, type StepInfo } from './step-info';
import {
  PAPERS,
  cropSvg,
  diagramParts,
  pageCss,
  paperOf,
  printableArea,
  svgViewBox,
  type Paper,
} from './print-layout';

/** Legend swatch in the shape of the element kind. */
function Swatch({ kind, colour }: { kind: string; colour: ThemeColour }) {
  const style = { fill: colour.fill, stroke: colour.stroke, strokeWidth: 1.5 };
  return (
    <svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true">
      {/end|start|intermediate/i.test(kind) ? (
        <circle
          cx="15"
          cy="10"
          r="8"
          {...style}
          strokeWidth={kind === 'end' || kind === 'endRejected' ? 3 : 1.5}
        />
      ) : kind === 'gateway' ? (
        <path d="M15 1.5 23.5 10 15 18.5 6.5 10z" {...style} />
      ) : (
        <rect x="2" y="2" width="26" height="16" rx="4" {...style} />
      )}
    </svg>
  );
}

const STEP =
  /^bpmn:(Task|UserTask|ServiceTask|ManualTask|ScriptTask|BusinessRuleTask|SendTask|ReceiveTask|SubProcess|CallActivity)$/;

/** Renders the diagram off-screen and returns its SVG and the steps in reading order. */
function useDiagramSnapshot(xml: string | null | undefined, lang: Locale) {
  const [result, setResult] = useState<{ svg: string; steps: StepInfo[] } | null>(null);
  useEffect(() => {
    if (!xml) return;
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset-inline-start:-10000px;inline-size:1600px;block-size:900px';
    document.body.appendChild(host);
    const viewer = createDiagram('viewer', { container: host });
    let alive = true;
    void (async () => {
      try {
        await importDiagram(viewer, xml);
        normaliseDiagram(viewer);
        applyLanguage(viewer, lang);
        // The diagram is shown as an image, which cannot use the page's fonts.
        const svg = await embedDiagramFonts((await viewer.saveSVG()).svg);
        const steps = viewer
          .get<ElementRegistry>('elementRegistry')
          .filter((e) => STEP.test(e.type))
          .sort(
            (a, b) =>
              ((a as { x?: number }).x ?? 0) - ((b as { x?: number }).x ?? 0) ||
              ((a as { y?: number }).y ?? 0) - ((b as { y?: number }).y ?? 0),
          )
          .map(stepInfo);
        if (alive) setResult({ svg, steps });
      } catch {
        if (alive) setResult({ svg: '', steps: [] });
      } finally {
        viewer.destroy();
        host.remove();
      }
    })();
    return () => {
      alive = false;
    };
  }, [xml, lang]);
  return result;
}

/**
 * Print layout of a published process (diagram + step details) in the reader's language.
 * The browser's print dialog saves it as PDF (D-024).
 */
export function PortalPrintProcess() {
  const { processId } = useParams<{ processId: string }>();
  const [params] = useSearchParams();
  const lang: Locale = params.get('lang') === 'ar' ? 'ar' : 'en';
  const { i18n } = useTranslation();
  const t = useMemo(() => i18n.getFixedT(lang), [i18n, lang]);
  // Dates in the language of the document, not of the screen.
  const formatDate = (iso: string | null | undefined, withTime = true) =>
    iso
      ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
          dateStyle: 'medium',
          ...(withTime ? { timeStyle: 'short' } : {}),
        }).format(new Date(iso))
      : '—';
  const [paper, setPaper] = useState<Paper>(() => paperOf(params.get('paper')));
  const settings = usePublicSettings();
  const process = usePortalProcess(processId);
  const snapshot = useDiagramSnapshot(process.data?.bpmnXml, lang);
  // The diagram scaled to the page width; split into page-wide parts when it would be too small.
  const partUrls = useMemo(() => {
    if (!snapshot?.svg) return [];
    const box = svgViewBox(snapshot.svg);
    const parts = box ? diagramParts(box.width, printableArea(paper).width) : [];
    const svgs =
      box && parts.length > 1 ? parts.map((p) => cropSvg(snapshot.svg, box, p)) : [snapshot.svg];
    return svgs.map((svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
  }, [snapshot, paper]);
  useEffect(() => () => partUrls.forEach((u) => URL.revokeObjectURL(u)), [partUrls]);
  const ready = !!process.data && (!process.data.bpmnXml || !!snapshot);
  // Open the print dialog once when the page is ready (not again after changing the paper).
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current || params.get('print') === '0') return;
    printed.current = true;
    const id = setTimeout(() => window.print(), 600);
    return () => clearTimeout(id);
  }, [ready, params]);

  if (process.isLoading) return <LoadingState />;
  if (process.isError || !process.data) return <ErrorState error={process.error} />;
  const p = process.data;
  const theme = settings.data?.diagramTheme ?? DEFAULT_DIAGRAM_THEME;
  const l = (e: unknown, field = 'name') => localized(e as Record<string, unknown>, field, lang);
  const user = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? l(u) || u.email : '—';
  const objects = (stepId: string, type: ObjectType) =>
    p.links
      .filter((x) => x.bpmnElementId === stepId && x.object.type === type)
      .map((x) => l(x.object))
      .join(', ') || '—';

  return (
    <div className={`ph-print ph-print-process ph-paper-${paper}`}>
      <style>{pageCss(paper, (page, pages) => t('portal:print.page', { page, pages }))}</style>
      <div className="ph-print-toolbar">
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          {t('docs:export.printPdf')}
        </Button>
        <Segmented<Paper>
          value={paper}
          onChange={setPaper}
          options={PAPERS.map((value) => ({ value, label: t(`portal:print.paper.${value}`) }))}
          aria-label={t('portal:print.paperLabel')}
        />
        <Typography.Text type="secondary">{t('docs:export.printHint')}</Typography.Text>
      </div>
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
        <header className="ph-print-header">
          <span className="ph-print-org">
            <BrandMark settings={settings.data} size={36} />
            <span>{l({ nameEn: settings.data?.orgNameEn, nameAr: settings.data?.orgNameAr })}</span>
          </span>
          <span>
            {t('governance:official')} ·{' '}
            {p.meta.versionLabel || t('governance:versionN', { number: p.meta.versionNumber })}
          </span>
        </header>
        <h1>
          <span dir="ltr">{p.code}</span> {l(p)}
        </h1>
        <table className="ph-print-table">
          <tbody>
            <tr>
              <th>{t('portal:print.version')}</th>
              <td>
                {p.meta.versionLabel || t('governance:versionN', { number: p.meta.versionNumber })}
              </td>
              <th>{t('fields.owner')}</th>
              <td>{user(p.meta.owner)}</td>
            </tr>
            <tr>
              <th>{t('portal:meta.approved')}</th>
              <td>
                {p.meta.approvedAt ? formatDate(p.meta.approvedAt, false) : '—'}
                {p.meta.approvedBy.length ? ` (${p.meta.approvedBy.map(user).join(', ')})` : ''}
              </td>
              <th>{t('portal:meta.published')}</th>
              <td>{formatDate(p.meta.publishedAt, false)}</td>
            </tr>
            <tr>
              <th>{t('fields.category')}</th>
              <td>{t(`processes:category.${p.category}`)}</td>
              <th>{t('portal:meta.nextReview')}</th>
              <td>{p.meta.nextReviewAt ? formatDate(p.meta.nextReviewAt, false) : '—'}</td>
            </tr>
            <tr>
              <th>{t('fields.department')}</th>
              <td colSpan={3}>{p.department ? l(p.department) : '—'}</td>
            </tr>
          </tbody>
        </table>
        {l(p, 'description') && <p style={{ whiteSpace: 'pre-wrap' }}>{l(p, 'description')}</p>}
        {p.bpmnXml && (
          <section className="ph-print-legend" aria-label={t('portal:print.legend')}>
            <h2>{t('portal:print.legend')}</h2>
            <ul>
              {THEME_KINDS.filter((k) => k !== 'lane').map((kind) => (
                <li key={kind}>
                  <Swatch kind={kind} colour={theme[kind]} />
                  {t(`admin:theme.kind.${kind}`)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {partUrls.map((url, i) => (
          <figure key={url} className="ph-print-diagram">
            <img
              src={url}
              alt={partUrls.length > 1 ? `${l(p)} (${i + 1}/${partUrls.length})` : l(p)}
            />
            {partUrls.length > 1 && (
              <figcaption>
                {t('portal:print.part', { part: i + 1, parts: partUrls.length })}
              </figcaption>
            )}
          </figure>
        ))}
        {!!snapshot?.steps.length && (
          <>
            <h2>{t('portal:print.steps')}</h2>
            <table className="ph-print-table ph-print-steps">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('portal:print.step')}</th>
                  <th>{t('portal:print.description')}</th>
                  <th>{t('portal:process.linked.ROLE')}</th>
                  <th>{t('portal:process.linked.SYSTEM')}</th>
                  <th>{t('portal:process.linked.DOCUMENT')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.steps.map((s, i) => (
                  <tr key={s.id}>
                    <td>{i + 1}</td>
                    <td>{l(s) || s.id}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{l(s, 'description') || '—'}</td>
                    <td>{objects(s.id, 'ROLE')}</td>
                    <td>{objects(s.id, 'SYSTEM')}</td>
                    <td>{objects(s.id, 'DOCUMENT')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="ph-print-meta">
          {t('portal:print.footer', { date: formatDate(new Date().toISOString()) })}
        </p>
      </div>
    </div>
  );
}
