import { useState } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import type { HandbookPlanDto, Locale, ReportSource } from '@processhub/shared';
import { api, apiDownload } from '@/api/client';
import { useErrorMessage } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { diagramWidthFor, renderDiagramPng } from './render-diagram';

export interface HandbookOptions {
  processId: string;
  includeChildren: boolean;
  /** "Risks and controls" section (only what the user may see). */
  includeRisks?: boolean;
  /** "Systems and data" section (Phase 4.3; users with `ea.read`). */
  includeSystems?: boolean;
  /** Diagram sections (D-126): value chain path, SIPOC, linked decision tables, org chart excerpt. */
  includeValueChain?: boolean;
  includeSipoc?: boolean;
  includeDecisions?: boolean;
  includeOrgChart?: boolean;
  /** Process mining summary and the last simulation (Phase 5.1; users with `mining.read`). */
  includePerformance?: boolean;
  source?: ReportSource;
  locale: Locale;
}

/**
 * Downloads of the reports (Modeler design B2, D-087). The handbook is built in two steps: the
 * API names the processes and the diagram XML it will use, the browser renders the diagrams as
 * PNG, then the API builds the Word file with them.
 */
export function useReports() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);

  const run = async (work: (progress: (text: string) => void) => Promise<void>) => {
    const key = `report-${Date.now()}`;
    setBusy(true);
    const progress = (text: string) => message.loading({ content: text, key, duration: 0 });
    progress(t('processes:reports.preparing'));
    try {
      await work(progress);
      message.success({ content: t('processes:reports.done'), key });
      return true;
    } catch (err) {
      message.error({ content: errorMessage(err), key });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handbook = (o: HandbookOptions) =>
    run(async (progress) => {
      const plan = await api<HandbookPlanDto>('/reports/handbook/plan', {
        method: 'POST',
        body: { processId: o.processId, includeChildren: o.includeChildren, source: o.source },
      });
      const width = diagramWidthFor(plan.processes.length);
      const images: { processId: string; png: string }[] = [];
      let n = 0;
      for (const p of plan.processes) {
        n++;
        progress(t('processes:reports.rendering', { n, total: plan.processes.length }));
        if (!p.bpmnXml) continue;
        try {
          images.push({ processId: p.id, png: await renderDiagramPng(p.bpmnXml, o.locale, width) });
        } catch {
          /* a diagram that cannot be drawn is left out of the handbook */
        }
      }
      progress(t('processes:reports.building'));
      const file = await apiDownload(
        '/reports/handbook',
        {
          method: 'POST',
          body: {
            processId: o.processId,
            includeChildren: o.includeChildren,
            includeRisks: !!o.includeRisks,
            includeSystems: !!o.includeSystems,
            includeValueChain: !!o.includeValueChain,
            includeSipoc: !!o.includeSipoc,
            includeDecisions: !!o.includeDecisions,
            includeOrgChart: !!o.includeOrgChart,
            includePerformance: !!o.includePerformance,
            source: plan.source,
            locale: o.locale,
            images,
          },
        },
        'handbook.docx',
      );
      downloadBlob(file.blob, file.fileName);
    });

  const raci = (processId: string, locale: Locale, source?: ReportSource) =>
    run(async () => {
      const file = await apiDownload(
        `/reports/raci/${processId}`,
        { query: { locale, source } },
        'raci.xlsx',
      );
      downloadBlob(file.blob, file.fileName);
    });

  const objectReport = (objectId: string, locale: Locale) =>
    run(async () => {
      const file = await apiDownload(
        `/reports/objects/${objectId}`,
        { query: { locale } },
        'report.xlsx',
      );
      downloadBlob(file.blob, file.fileName);
    });

  return { busy, handbook, raci, objectReport };
}
