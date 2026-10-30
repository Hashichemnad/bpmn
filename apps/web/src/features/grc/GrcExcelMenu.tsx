import { useState } from 'react';
import { Alert, App, Button, Dropdown, Modal, Space, Table, Typography, Upload } from 'antd';
import { DownloadOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { GrcImportKind, GrcImportReportDto, GrcObjectType } from '@processhub/shared';
import { apiDownload } from '@/api/client';
import { GRC_PATH, useGrcImport } from '@/api/grc';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { useGrcAccess } from './grc-helpers';

/** Export, template and import of one register (import: check first, then import). */
export function GrcExcelMenu({ type }: { type: GrcObjectType }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const access = useGrcAccess();
  const kind = GRC_PATH[type] as GrcImportKind;
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
              onClick: () => void download(`/grc/export/${kind}`, `${kind}.xlsx`),
            },
            ...(access.canEdit
              ? [
                  {
                    key: 'template',
                    icon: <FileExcelOutlined />,
                    label: t('grc:excel.template'),
                    onClick: () => void download(`/grc/template/${kind}`, `${kind}-template.xlsx`),
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
        <Button icon={<FileExcelOutlined />}>{t('grc:excel.menu')}</Button>
      </Dropdown>
      {importing && <ImportModal type={type} kind={kind} onClose={() => setImporting(false)} />}
    </>
  );
}

function ImportModal({
  type,
  kind,
  onClose,
}: {
  type: GrcObjectType;
  kind: GrcImportKind;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const run = useGrcImport(kind);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<GrcImportReportDto | null>(null);

  const go = (dryRun: boolean) => {
    if (!file) return;
    run.mutate(
      { file, dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          if (r.imported) {
            message.success(t('grc:excel.imported', { created: r.created, updated: r.updated }));
            if (r.pending) message.info(t('grc:excel.pendingApproval', { count: r.pending }));
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
      title={t('grc:excel.importTitle', { register: t(`grc:register.${type}.title`) })}
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
        <div style={{ marginBlockStart: 16 }} data-testid="grc-import-report">
          <Typography.Paragraph strong>
            {t('grc:excel.summary', {
              rows: report.rows,
              created: report.created,
              updated: report.updated,
            })}
          </Typography.Paragraph>
          {report.pending > 0 && !report.imported && (
            <Typography.Paragraph type="warning" data-testid="grc-import-pending">
              {t('grc:excel.willNeedApproval', { count: report.pending })}
            </Typography.Paragraph>
          )}
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
