import { useEffect, useState } from 'react';
import { Collapse, Form, Input, InputNumber, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  STEP_NUMBER_MAX,
  STEP_TEXT_MAX,
  readStepAttributes,
  splitMinutes,
  type StepNumberAttribute,
  type StepTextAttribute,
} from '@processhub/shared';
import type { BpmnInstance, DiagramElement, Modeling } from './bpmn-types';

type Unit = 'minutes' | 'hours' | 'days';
const FACTOR: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Raw `ph:` step attribute values of an element (keys without the prefix). */
function rawAttributes(el: DiagramElement): Record<string, string | undefined> {
  const bo = el.businessObject;
  const keys = [
    'durationMinutes',
    'waitingMinutes',
    'slaMinutes',
    'frequencyPerMonth',
    'costPerExecution',
    'inputsEn',
    'inputsAr',
    'outputsEn',
    'outputsAr',
  ];
  return Object.fromEntries(keys.map((k) => [k, bo.get(`ph:${k}`) as string | undefined]));
}

/** A time in minutes, entered as a number and a unit (minutes, hours, days of 24 h). */
function DurationInput({
  minutes,
  disabled,
  label,
  onChange,
}: {
  minutes: number | undefined;
  disabled: boolean;
  label: string;
  onChange: (minutes: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<Unit>(() =>
    minutes === undefined ? 'hours' : splitMinutes(minutes).unit,
  );
  useEffect(() => {
    if (minutes !== undefined) setUnit(splitMinutes(minutes).unit);
  }, [minutes]);
  const value = minutes === undefined ? null : minutes / FACTOR[unit];
  return (
    <Space.Compact style={{ width: '100%' }}>
      <InputNumber
        size="small"
        min={0}
        max={STEP_NUMBER_MAX.durationMinutes / FACTOR[unit]}
        style={{ width: '100%' }}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(v) =>
          onChange(v === null || v === undefined ? undefined : Math.round(Number(v) * FACTOR[unit]))
        }
      />
      <Select
        size="small"
        style={{ width: 110 }}
        aria-label={`${label} — ${t('modeler:attributes.unit')}`}
        value={unit}
        disabled={disabled}
        onChange={(u: Unit) => setUnit(u)}
        options={(['minutes', 'hours', 'days'] as const).map((u) => ({
          value: u,
          label: t(`modeler:attributes.units.${u}`),
        }))}
      />
    </Space.Compact>
  );
}

/**
 * Step attributes in the side panel (D-086): planned processing time, waiting time, frequency,
 * cost per execution, SLA and bilingual inputs / outputs, stored as `ph:` attributes.
 */
export function StepAttributes({
  instance,
  element,
  canEdit,
  version,
}: {
  instance: BpmnInstance | null;
  element: DiagramElement;
  canEdit: boolean;
  /** Changes when the element changes on the canvas (undo, …): re-read the values. */
  version: number;
}) {
  const { t } = useTranslation();
  const [texts, setTexts] = useState<Record<StepTextAttribute, string>>({
    inputsEn: '',
    inputsAr: '',
    outputsEn: '',
    outputsAr: '',
  });
  const raw = rawAttributes(element);
  const { values } = readStepAttributes(raw);
  useEffect(() => {
    const r = rawAttributes(element);
    setTexts({
      inputsEn: r.inputsEn ?? '',
      inputsAr: r.inputsAr ?? '',
      outputsEn: r.outputsEn ?? '',
      outputsAr: r.outputsAr ?? '',
    });
  }, [element, version]);
  const modeling = canEdit && instance ? instance.get<Modeling>('modeling') : null;
  const set = (attr: StepNumberAttribute | StepTextAttribute, value: string | undefined) => {
    if (!modeling) return;
    const current = (element.businessObject.get(`ph:${attr}`) as string | undefined) ?? undefined;
    if ((current ?? '') === (value ?? '')) return;
    modeling.updateModdleProperties(element, element.businessObject, {
      [`ph:${attr}`]: value === '' ? undefined : value,
    });
  };
  const setNumber = (attr: StepNumberAttribute, n: number | undefined) =>
    set(attr, n === undefined ? undefined : String(n));
  const filled = Object.keys(values).length;

  const text = (attr: StepTextAttribute) => (
    <Input.TextArea
      dir={attr.endsWith('Ar') ? 'rtl' : 'ltr'}
      lang={attr.endsWith('Ar') ? 'ar' : 'en'}
      aria-label={t(`modeler:attributes.${attr}`)}
      autoSize={{ minRows: 1, maxRows: 4 }}
      maxLength={STEP_TEXT_MAX}
      value={texts[attr]}
      readOnly={!canEdit}
      onChange={(e) => setTexts((x) => ({ ...x, [attr]: e.target.value }))}
      onBlur={() => set(attr, texts[attr].trim() || undefined)}
    />
  );

  return (
    <Collapse
      size="small"
      className="ph-step-attributes"
      defaultActiveKey={filled ? ['attributes'] : []}
      items={[
        {
          key: 'attributes',
          label: (
            <Space size={6}>
              {t('modeler:attributes.title')}
              {filled > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ({filled})
                </Typography.Text>
              )}
            </Space>
          ),
          children: (
            <Form layout="vertical" size="small" className="ph-step-attributes-form">
              <Form.Item label={t('modeler:attributes.durationMinutes')}>
                <DurationInput
                  label={t('modeler:attributes.durationMinutes')}
                  minutes={values.durationMinutes}
                  disabled={!canEdit}
                  onChange={(m) => setNumber('durationMinutes', m)}
                />
              </Form.Item>
              <Form.Item label={t('modeler:attributes.waitingMinutes')}>
                <DurationInput
                  label={t('modeler:attributes.waitingMinutes')}
                  minutes={values.waitingMinutes}
                  disabled={!canEdit}
                  onChange={(m) => setNumber('waitingMinutes', m)}
                />
              </Form.Item>
              <Form.Item
                label={t('modeler:attributes.slaMinutes')}
                extra={t('modeler:attributes.slaHint')}
              >
                <DurationInput
                  label={t('modeler:attributes.slaMinutes')}
                  minutes={values.slaMinutes}
                  disabled={!canEdit}
                  onChange={(m) => setNumber('slaMinutes', m)}
                />
              </Form.Item>
              <Space.Compact block>
                <Form.Item
                  label={t('modeler:attributes.frequencyPerMonth')}
                  style={{ flex: 1, marginInlineEnd: 8 }}
                >
                  <InputNumber
                    min={0}
                    max={STEP_NUMBER_MAX.frequencyPerMonth}
                    style={{ width: '100%' }}
                    aria-label={t('modeler:attributes.frequencyPerMonth')}
                    value={values.frequencyPerMonth ?? null}
                    disabled={!canEdit}
                    onChange={(v) =>
                      setNumber('frequencyPerMonth', v === null ? undefined : Number(v))
                    }
                  />
                </Form.Item>
                <Form.Item label={t('modeler:attributes.costPerExecution')} style={{ flex: 1 }}>
                  <InputNumber
                    min={0}
                    max={STEP_NUMBER_MAX.costPerExecution}
                    style={{ width: '100%' }}
                    aria-label={t('modeler:attributes.costPerExecution')}
                    value={values.costPerExecution ?? null}
                    disabled={!canEdit}
                    onChange={(v) =>
                      setNumber('costPerExecution', v === null ? undefined : Number(v))
                    }
                  />
                </Form.Item>
              </Space.Compact>
              <Form.Item label={t('modeler:attributes.inputsEn')}>{text('inputsEn')}</Form.Item>
              <Form.Item label={t('modeler:attributes.inputsAr')}>{text('inputsAr')}</Form.Item>
              <Form.Item label={t('modeler:attributes.outputsEn')}>{text('outputsEn')}</Form.Item>
              <Form.Item label={t('modeler:attributes.outputsAr')}>{text('outputsAr')}</Form.Item>
              {raw.durationMinutes !== undefined && values.durationMinutes === undefined && (
                <Typography.Text type="danger">{t('modeler:attributes.invalid')}</Typography.Text>
              )}
            </Form>
          ),
        },
      ]}
    />
  );
}
