import { useState } from 'react';
import { Alert, App, Button, Dropdown, Modal, Space, Table, Typography, Upload } from 'antd';
import { DownloadOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import type { UseMutationResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiDownload } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';

export interface ImportReport {
  rows: number;
  created: number;
  updated: number;
  errors: { row: number; column: string; code: string }[];
  imported: boolean;
}

type ImportMutation = UseMutationResult<
  ImportReport,
  unknown,
  { file: File; dryRun: boolean },
  unknown
>;

/**
 * Export, template and import of one catalogue (Phase 4.3 architecture and KPI catalogues; same
 * flow as the Risk & Compliance registers: check the file first, then import).
 */
export function ExcelMenu({
  basePath,
  kind,
  title,
  canImport,
  useImport,
  label,
}: {
  /** e.g. `/ea` → `/ea/export/<kind>`, `/ea/template/<kind>`, `/ea/import/<kind>`. */
  basePath: string;
  kind: string;
  /** Catalogue name shown in the import dialog title. */
  title: string;
  canImport: boolean;
  useImport: () => ImportMutation;
  /** Button text (default "Excel"). */
  label?: string;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [importing, setImporting] = useState(false);

  const download = async (path: string, name: string) => {
    try {
      const file = await apiDownload(path, { query: { locale } }, name);
      downloadBlob(file.blob, file.fileName);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <Dropdown
        menu={{
          items: [
            {
              key: 'export',
              icon: <DownloadOutlined />,
              label: t('grc:excel.export'),
              onClick: () => void download(`${basePath}/export/${kind}`, `${kind}.xlsx`),
            },
            ...(canImport
              ? [
                  {
                    key: 'template',
                    icon: <FileExcelOutlined />,
                    label: t('grc:excel.template'),
                    onClick: () =>
                      void download(`${basePath}/template/${kind}`, `${kind}-template.xlsx`),
                  },
                  {
                    key: 'import',
                    icon: <UploadOutlined />,
                    label: t('grc:excel.import'),
                    onClick: () => setImporting(true),
                  },
                ]
              : []),
          ],
        }}
      >
        <Button icon={<FileExcelOutlined />} data-testid={`excel-${kind}`}>
          {label ?? t('grc:excel.menu')}
        </Button>
      </Dropdown>
      {importing && (
        <ImportModal title={title} useImport={useImport} onClose={() => setImporting(false)} />
      )}
    </>
  );
}

function ImportModal({
  title,
  useImport,
  onClose,
}: {
  title: string;
  useImport: () => ImportMutation;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const run = useImport();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const go = (dryRun: boolean) => {
    if (!file) return;
    run.mutate(
      { file, dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          if (r.imported) {
            message.success(t('grc:excel.imported', { created: r.created, updated: r.updated }));
            onClose();
          }
        },
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  };
  const ready = report && !report.errors.length && !report.imported;

  return (
    <Modal
      open
      title={t('grc:excel.importTitle', { register: title })}
      onCancel={onClose}
      width={720}
      footer={
        <Space>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={!file} loading={run.isPending && !ready} onClick={() => go(true)}>
            {t('grc:excel.validate')}
          </Button>
          <Button
            type="primary"
            disabled={!ready}
            loading={run.isPending && !!ready}
            onClick={() => go(false)}
          >
            {t('grc:excel.importNow')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">{t('grc:excel.importHint')}</Typography.Paragraph>
      <Upload
        accept=".xlsx"
        maxCount={1}
        beforeUpload={(f) => {
          setFile(f);
          setReport(null);
          return false;
        }}
        onRemove={() => {
          setFile(null);
          setReport(null);
        }}
      >
        <Button icon={<UploadOutlined />}>{t('grc:excel.chooseFile')}</Button>
      </Upload>
      {report && (
        <div style={{ marginBlockStart: 16 }} data-testid="excel-import-report">
          <Typography.Paragraph strong>
            {t('grc:excel.summary', {
              rows: report.rows,
              created: report.created,
              updated: report.updated,
            })}
          </Typography.Paragraph>
          {report.errors.length ? (
            <>
              <Alert
                type="error"
                showIcon
                message={t('grc:excel.errorsTitle', { count: report.errors.length })}
                style={{ marginBlockEnd: 8 }}
              />
              <Table
                size="small"
                rowKey={(e) => `${e.row}-${e.column}-${e.code}`}
                pagination={{ pageSize: 8 }}
                dataSource={report.errors}
                columns={[
                  { title: t('grc:excel.row'), dataIndex: 'row', width: 70 },
                  { title: t('grc:excel.column'), dataIndex: 'column', width: 180 },
                  {
                    title: t('grc:excel.problem'),
                    dataIndex: 'code',
                    render: (c: string) =>
                      t(`grc:excel.issue.${c}`, {
                        defaultValue: t('grc:excel.issue.INVALID_VALUE'),
                      }),
                  },
                ]}
              />
            </>
          ) : (
            <Alert type="success" showIcon message={t('grc:excel.noErrors')} />
          )}
        </div>
      )}
    </Modal>
  );
}
