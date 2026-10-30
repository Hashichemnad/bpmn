import { useMemo } from 'react';
import {
  App,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
  Upload,
  type UploadFile,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  duePeriod,
  kpiRag,
  periodRange,
  thresholdsFor,
  type KpiDto,
  type KpiMeasurementDto,
} from '@processhub/shared';
import { useMeasure, useUploadEvidence } from '@/api/kpi';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { RagTag } from './kpi-components';
import { useFormatPeriod } from './kpi-helpers';

/** Enter (or correct) the actual value of one period, with a comment and optional evidence. */
export function MeasureModal({
  kpi,
  measurements,
  period,
  onClose,
}: {
  kpi: KpiDto;
  measurements: KpiMeasurementDto[];
  period: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatPeriod = useFormatPeriod();
  const measure = useMeasure(kpi.id);
  const upload = useUploadEvidence(kpi.id);
  const [form] = Form.useForm<{
    period: string;
    value: number;
    comment: string;
    files: UploadFile[];
  }>();
  const chosen = Form.useWatch('period', form) ?? period;
  const value = Form.useWatch('value', form) as number | undefined;
  // The last 24 periods up to the last completed one (and the one asked for).
  const periods = useMemo(() => {
    const list = periodRange(duePeriod(new Date(), kpi.frequency), kpi.frequency, 24).reverse();
    return list.includes(period) ? list : [period, ...list];
  }, [kpi.frequency, period]);
  const existing = measurements.find((m) => m.period === period);
  const preview = kpiRag(value, thresholdsFor(kpi, chosen, kpi.periodTargets));

  return (
    <Modal
      open
      title={t('kpi:measure.title', { name: loc(kpi) })}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={measure.isPending || upload.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        data-testid="measure-form"
        initialValues={{
          period,
          value: existing?.value,
          comment: existing?.comment ?? '',
          files: [],
        }}
        onFinish={(v) =>
          measure.mutate(
            { period: v.period, value: v.value, comment: v.comment ?? '' },
            {
              onSuccess: async (d) => {
                const saved = d.measurements.find((m) => m.period === v.period);
                for (const f of v.files ?? [])
                  if (saved && f.originFileObj)
                    await upload
                      .mutateAsync({ measurementId: saved.id, file: f.originFileObj })
                      .catch((err) => message.error(errorMessage(err)));
                message.success(t('saved'));
                onClose();
              },
              onError: (err) => message.error(errorMessage(err)),
            },
          )
        }
      >
        <Form.Item name="period" label={t('kpi:measure.period')} rules={[{ required: true }]}>
          <Select options={periods.map((p) => ({ value: p, label: formatPeriod(p) }))} />
        </Form.Item>
        <Form.Item
          name="value"
          label={t('kpi:measure.value', { unit: kpi.unit || '—' })}
          rules={[{ required: true }]}
        >
          <InputNumber style={{ width: '100%' }} autoFocus />
        </Form.Item>
        <Space style={{ marginBlockEnd: 16 }}>
          <Typography.Text type="secondary">{t('kpi:measure.statusPreview')}</Typography.Text>
          <RagTag rag={preview} />
        </Space>
        <Form.Item name="comment" label={t('kpi:measure.comment')}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
        <Form.Item
          name="files"
          label={t('kpi:measure.evidence')}
          valuePropName="fileList"
          getValueFromEvent={(e: { fileList: UploadFile[] }) => e.fileList}
        >
          <Upload beforeUpload={() => false} multiple>
            <Typography.Link>
              <UploadOutlined /> {t('kpi:detail.uploadEvidence')}
            </Typography.Link>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
