import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Typography,
  Upload,
} from 'antd';
import { InboxOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  CSV_DELIMITERS,
  DEFAULT_MINING_TIME_ZONE,
  MINING_UPLOAD_MAX_MB,
  TIMESTAMP_FORMATS,
  type ImportReportDto,
  type MiningMappingInput,
} from '@processhub/shared';
import {
  useEventLog,
  useLogPreview,
  useMiningJob,
  useMiningTemplates,
  useSaveMapping,
  useSaveTemplate,
  useStartLogJob,
  useUploadLog,
} from '@/api/mining';
import { useProcessTree } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import {
  useErrorMessage,
  useFormatDate,
  useFormatNumber,
  useLocalized,
} from '@/components/i18n-helpers';
import { JobProgress } from './mining-helpers';
import { logPath } from './mining-utils';

const TIME_ZONES = [
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Africa/Cairo',
  'Asia/Amman',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'UTC',
];

const ROLE_FIELDS = [
  'caseColumn',
  'activityColumn',
  'startColumn',
  'endColumn',
  'resourceColumn',
  'departmentColumn',
] as const;

/** Step 1 of the import: upload a file into a new draft log. */
export function UploadLogPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const upload = useUploadLog();
  const processes = useProcessTree();
  const [file, setFile] = useState<File | null>(null);
  const [form] = Form.useForm<{ nameEn?: string; nameAr?: string; processId?: string }>();
  const processOptions = useMemo(
    () =>
      (processes.data ?? [])
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((p) => ({ value: p.id, label: `${p.code} ${loc(p)}` })),
    [processes.data, loc],
  );
  return (
    <>
      <PageHeader
        title={t('mining:import.title')}
        crumbs={[
          { title: t('mining:logs.title'), to: '/mining/logs' },
          { title: t('mining:import.title') },
        ]}
      />
      <Card>
        <Steps
          current={0}
          style={{ marginBlockEnd: 24 }}
          items={[
            { title: t('mining:import.steps.upload') },
            { title: t('mining:import.steps.mapping') },
            { title: t('mining:import.steps.validate') },
            { title: t('mining:import.steps.import') },
          ]}
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => {
            if (!file) return void message.error(t('mining:import.fileRequired'));
            if (!v.nameEn && !v.nameAr) v.nameEn = file.name.replace(/\.[^.]+$/, '');
            upload
              .mutateAsync({
                file,
                fields: {
                  nameEn: v.nameEn ?? '',
                  nameAr: v.nameAr ?? '',
                  processId: v.processId ?? '',
                },
              })
              .then((log) => navigate(`${logPath(log.id)}/import`))
              .catch((e: unknown) => void message.error(errorMessage(e)));
          }}
        >
          <Form.Item label={t('mining:import.file')} required>
            <Upload.Dragger
              accept=".csv,.txt,.tsv,.xlsx,.xes"
              maxCount={1}
              beforeUpload={(f) => {
                if (f.size > MINING_UPLOAD_MAX_MB * 1024 * 1024) {
                  void message.error(t('errors:FILE_TOO_LARGE'));
                  return Upload.LIST_IGNORE;
                }
                setFile(f);
                return false;
              }}
              onRemove={() => setFile(null)}
              data-testid="mining-upload"
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('mining:import.drop')}</p>
              <p className="ant-upload-hint">
                {t('mining:import.hint', { mb: MINING_UPLOAD_MAX_MB })}
              </p>
            </Upload.Dragger>
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="nameEn" label={t('mining:fields.nameEn')}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="nameAr" label={t('mining:fields.nameAr')}>
                <Input dir="rtl" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="processId"
            label={t('mining:fields.process')}
            extra={t('mining:import.processHint')}
          >
            <Select allowClear showSearch optionFilterProp="label" options={processOptions} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={upload.isPending} disabled={!file}>
            {t('mining:import.uploadNext')}
          </Button>
        </Form>
      </Card>
    </>
  );
}

/** Steps 2–4: mapping with preview, validation report, import with progress. */
export function ImportMappingPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const log = useEventLog(id);
  const [source, setSource] = useState<{ delimiter?: string; sheet?: string }>({});
  const preview = useLogPreview(id, source, log.data?.status !== 'DELETING');
  const templates = useMiningTemplates();
  const saveTemplate = useSaveTemplate();
  const saveMapping = useSaveMapping(id);
  const validate = useStartLogJob(id, 'validate');
  const runImport = useStartLogJob(id, 'import');
  const [mapping, setMapping] = useState<MiningMappingInput | null>(null);
  const [step, setStep] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useMiningJob(jobId);
  const [templateName, setTemplateName] = useState<string | null>(null);

  useEffect(() => {
    if (!preview.data || mapping) return;
    setMapping({
      timeZone: DEFAULT_MINING_TIME_ZONE,
      pseudonymise: false,
      dropDuplicates: true,
      ...(log.data?.mapping ?? preview.data.suggestion),
    });
  }, [preview.data, log.data, mapping]);

  // Finished jobs move the wizard on.
  useEffect(() => {
    const j = job.data;
    if (!j || j.status !== 'DONE') return;
    if (j.kind === 'VALIDATE') setStep(2);
    if (j.kind === 'IMPORT') {
      void message.success(t('mining:import.done'));
      navigate(logPath(id));
    }
  }, [job.data, id, navigate, message, t]);

  if (log.isLoading || preview.isLoading) return <LoadingState />;
  if (log.isError) return <ErrorState error={log.error} />;
  if (preview.isError)
    return <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />;
  const data = preview.data!;
  const columns = data.columns.map((c) => ({ value: c.name, label: c.name }));
  const set = (patch: Partial<MiningMappingInput>) =>
    setMapping((m) => ({ ...(m as MiningMappingInput), ...patch }));
  const used = new Set(ROLE_FIELDS.map((f) => mapping?.[f]).filter(Boolean) as string[]);

  const start = (kind: 'validate' | 'import') =>
    saveMapping
      .mutateAsync(mapping!)
      .then(() => (kind === 'validate' ? validate : runImport).mutateAsync())
      .then((j) => {
        setJobId(j.id);
        if (kind === 'import') setStep(3);
      })
      .catch((e: unknown) => void message.error(errorMessage(e)));

  const report = (
    job.data?.kind === 'VALIDATE' && job.data.status === 'DONE'
      ? (job.data.result as ImportReportDto)
      : log.data?.importReport
  ) as ImportReportDto | null;

  return (
    <>
      <PageHeader
        title={t('mining:import.title')}
        subtitle={`${log.data?.code} · ${loc(log.data)} · ${log.data?.fileName ?? ''}`}
        crumbs={[
          { title: t('mining:logs.title'), to: '/mining/logs' },
          { title: log.data?.code, to: logPath(id) },
          { title: t('mining:import.title') },
        ]}
      />
      <Card>
        <Steps
          current={step}
          style={{ marginBlockEnd: 24 }}
          items={[
            { title: t('mining:import.steps.upload') },
            { title: t('mining:import.steps.mapping') },
            { title: t('mining:import.steps.validate') },
            { title: t('mining:import.steps.import') },
          ]}
        />
        {mapping && step === 1 && (
          <>
            <Flex gap={8} wrap="wrap" align="center" style={{ marginBlockEnd: 16 }}>
              {(templates.data?.length ?? 0) > 0 && (
                <Select
                  placeholder={t('mining:import.loadTemplate')}
                  style={{ width: 240 }}
                  options={templates
                    .data!.filter((tp) => tp.format === data.format)
                    .map((tp) => ({ value: tp.id, label: tp.name }))}
                  onChange={(v) => {
                    const tp = templates.data!.find((x) => x.id === v);
                    if (tp) setMapping({ ...tp.mapping });
                  }}
                />
              )}
              <Button icon={<SaveOutlined />} onClick={() => setTemplateName('')}>
                {t('mining:import.saveTemplate')}
              </Button>
              {data.format === 'CSV' && (
                <Space>
                  <Typography.Text>{t('mining:import.delimiter')}</Typography.Text>
                  <Select
                    style={{ width: 130 }}
                    value={source.delimiter ?? data.delimiter ?? ','}
                    onChange={(v) => {
                      setSource((s) => ({ ...s, delimiter: v }));
                      setMapping(null);
                    }}
                    options={CSV_DELIMITERS.map((d) => ({
                      value: d,
                      label: t(
                        `mining:import.delimiters.${d === '\t' ? 'tab' : d === ',' ? 'comma' : d === ';' ? 'semicolon' : 'pipe'}`,
                      ),
                    }))}
                  />
                </Space>
              )}
              {data.format === 'XLSX' && data.sheets.length > 0 && (
                <Space>
                  <Typography.Text>{t('mining:import.sheet')}</Typography.Text>
                  <Select
                    style={{ width: 160 }}
                    value={source.sheet ?? data.sheets[0]}
                    onChange={(v) => {
                      setSource((s) => ({ ...s, sheet: v }));
                      setMapping(null);
                    }}
                    options={data.sheets.map((s) => ({ value: s, label: s }))}
                  />
                </Space>
              )}
            </Flex>
            <Form layout="vertical" component="div">
              <Row gutter={[16, 8]} data-testid="mining-mapping">
                {ROLE_FIELDS.map((f) => (
                  <Col xs={24} md={8} key={f}>
                    <Form.Item
                      label={t(`mining:mapping.${f}`)}
                      required={f === 'caseColumn' || f === 'activityColumn'}
                      style={{ marginBottom: 8 }}
                    >
                      <Select
                        allowClear={f !== 'caseColumn' && f !== 'activityColumn'}
                        data-testid={`map-${f}`}
                        value={mapping[f] ?? undefined}
                        onChange={(v) => set({ [f]: v ?? null })}
                        options={columns}
                        placeholder={t('mining:mapping.none')}
                      />
                    </Form.Item>
                  </Col>
                ))}
                <Col xs={24} md={16}>
                  <Form.Item label={t('mining:mapping.attributes')} style={{ marginBottom: 8 }}>
                    <Select
                      mode="multiple"
                      value={mapping.attributeColumns ?? []}
                      onChange={(v) => set({ attributeColumns: v })}
                      options={columns.filter((c) => !used.has(c.value))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    label={t('mining:mapping.timestampFormat')}
                    style={{ marginBottom: 8 }}
                  >
                    <Select
                      value={mapping.timestampFormat ?? 'auto'}
                      onChange={(v) =>
                        set({
                          timestampFormat:
                            v === 'auto' ? null : (v as MiningMappingInput['timestampFormat']),
                        })
                      }
                      options={[
                        { value: 'auto', label: t('mining:mapping.formats.auto') },
                        ...TIMESTAMP_FORMATS.map((f) => ({
                          value: f,
                          label: t(`mining:mapping.formats.${f}`),
                        })),
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label={t('mining:mapping.timeZone')} style={{ marginBottom: 8 }}>
                    <Select
                      showSearch
                      value={mapping.timeZone ?? DEFAULT_MINING_TIME_ZONE}
                      onChange={(v) => set({ timeZone: v })}
                      options={TIME_ZONES.map((z) => ({ value: z, label: z }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    label={t('mining:mapping.pseudonymise')}
                    extra={t('mining:mapping.pseudonymiseHint')}
                    style={{ marginBottom: 8 }}
                  >
                    <Switch
                      checked={!!mapping.pseudonymise}
                      onChange={(v) => set({ pseudonymise: v })}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label={t('mining:mapping.dropDuplicates')} style={{ marginBottom: 8 }}>
                    <Switch
                      checked={mapping.dropDuplicates !== false}
                      onChange={(v) => set({ dropDuplicates: v })}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
            <Typography.Title level={5}>{t('mining:import.preview')}</Typography.Title>
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              scroll={{ x: true }}
              dataSource={data.rows}
              columns={data.columns.map((c) => ({
                title: (
                  <Flex vertical>
                    <span>{c.name}</span>
                    {c.timestampFormat && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {t(`mining:mapping.formats.${c.timestampFormat}`)}
                        {c.ambiguous ? ` · ${t('mining:mapping.ambiguous')}` : ''}
                      </Typography.Text>
                    )}
                  </Flex>
                ),
                dataIndex: c.name,
                ellipsis: true,
                width: 160,
              }))}
            />
            <Flex gap={8} style={{ marginBlockStart: 16 }}>
              <Button
                type="primary"
                data-testid="mining-validate"
                loading={saveMapping.isPending || validate.isPending}
                disabled={
                  !mapping.caseColumn ||
                  !mapping.activityColumn ||
                  (!mapping.endColumn && !mapping.startColumn)
                }
                onClick={() => void start('validate')}
              >
                {t('mining:import.validate')}
              </Button>
            </Flex>
            {job.data && job.data.kind === 'VALIDATE' && job.data.status !== 'DONE' && (
              <div style={{ marginBlockStart: 16 }}>
                <JobProgress job={job.data} />
              </div>
            )}
          </>
        )}
        {step === 2 && report && (
          <>
            <ImportReport report={report} />
            <Flex gap={8} style={{ marginBlockStart: 16 }}>
              <Button onClick={() => setStep(1)}>{t('mining:import.back')}</Button>
              <Button
                type="primary"
                data-testid="mining-import"
                disabled={!report.events}
                loading={runImport.isPending}
                onClick={() => void start('import')}
              >
                {t('mining:import.run', { count: report.events })}
              </Button>
            </Flex>
          </>
        )}
        {step === 3 && job.data && <JobProgress job={job.data} />}
      </Card>
      <Modal
        open={templateName !== null}
        title={t('mining:import.saveTemplate')}
        onCancel={() => setTemplateName(null)}
        okButtonProps={{ disabled: !templateName?.trim() }}
        onOk={() =>
          void saveTemplate
            .mutateAsync({
              name: templateName!.trim(),
              format: data.format,
              mapping: mapping as never,
            })
            .then(() => {
              setTemplateName(null);
              void message.success(t('mining:import.templateSaved'));
            })
            .catch((e: unknown) => void message.error(errorMessage(e)))
        }
      >
        <Input
          value={templateName ?? ''}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder={t('mining:import.templateName')}
        />
      </Modal>
    </>
  );
}

/** Validation / import report: counts and examples of skipped rows. */
export function ImportReport({ report }: { report: ImportReportDto }) {
  const { t } = useTranslation();
  const formatNumber = useFormatNumber();
  const formatDate = useFormatDate();
  const issues = (
    [
      'missingCase',
      'missingActivity',
      'missingTimestamp',
      'unparsableTimestamp',
      'startAfterEnd',
      'duplicates',
    ] as const
  ).filter((k) => report[k] > 0);
  return (
    <Flex vertical gap={12} data-testid="mining-report">
      <Descriptions
        size="small"
        bordered
        column={{ xs: 1, md: 3 }}
        items={[
          { key: 'rows', label: t('mining:report.rows'), children: formatNumber(report.rows) },
          {
            key: 'events',
            label: t('mining:report.events'),
            children: formatNumber(report.events),
          },
          { key: 'cases', label: t('mining:report.cases'), children: formatNumber(report.cases) },
          {
            key: 'activities',
            label: t('mining:report.activities'),
            children: formatNumber(report.activities),
          },
          {
            key: 'skipped',
            label: t('mining:report.skipped'),
            children: formatNumber(report.skipped),
          },
          {
            key: 'format',
            label: t('mining:report.format'),
            children: report.timestampFormat
              ? t(`mining:mapping.formats.${report.timestampFormat}`)
              : '—',
          },
          {
            key: 'period',
            label: t('mining:fields.period'),
            children: report.periodStart
              ? `${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`
              : '—',
          },
        ]}
      />
      {report.ambiguousFormat && (
        <Alert type="warning" showIcon message={t('mining:report.ambiguous')} />
      )}
      {issues.length === 0 ? (
        <Alert type="success" showIcon message={t('mining:report.clean')} />
      ) : (
        <Alert
          type="warning"
          showIcon
          message={t('mining:report.issues')}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {issues.map((k) => (
                <li key={k}>{t(`mining:report.${k}`, { count: report[k] })}</li>
              ))}
            </ul>
          }
        />
      )}
      {report.samples.length > 0 && (
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={{ pageSize: 10 }}
          dataSource={report.samples}
          columns={[
            { title: t('mining:report.row'), dataIndex: 'row', width: 90 },
            { title: t('mining:report.column'), dataIndex: 'column' },
            { title: t('mining:report.value'), dataIndex: 'value' },
          ]}
        />
      )}
    </Flex>
  );
}
