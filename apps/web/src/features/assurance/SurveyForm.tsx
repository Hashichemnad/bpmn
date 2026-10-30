import {
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Rate,
  Space,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  isQuestionVisible,
  type Answer,
  type Answers,
  type AssuranceFileDto,
  type Question,
  type QuestionnaireDefinition,
} from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { EvidenceList } from './EvidenceList';

/** One question with its input for its type. */
function QuestionInput({
  q,
  value,
  onChange,
  disabled,
  files,
  onUpload,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  disabled: boolean;
  files: AssuranceFileDto[];
  onUpload?: (file: File) => Promise<AssuranceFileDto>;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const text = (o: { en: string; ar: string }) => (locale === 'ar' ? o.ar || o.en : o.en || o.ar);
  switch (q.type) {
    case 'SINGLE':
      return (
        <Radio.Group
          disabled={disabled}
          value={value ?? undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <Space direction="vertical">
            {q.options.map((o) => (
              <Radio key={o.id} value={o.id}>
                {text(o)}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      );
    case 'MULTIPLE':
      return (
        <Checkbox.Group
          disabled={disabled}
          value={(value as string[]) ?? []}
          onChange={(v) => onChange(v as string[])}
          options={q.options.map((o) => ({ value: o.id, label: text(o) }))}
        />
      );
    case 'RATING':
      return (
        <Rate
          disabled={disabled}
          value={typeof value === 'number' ? value : 0}
          onChange={(v) => onChange(v || null)}
        />
      );
    case 'YES_NO_NA':
      return (
        <Radio.Group
          disabled={disabled}
          optionType="button"
          value={value ?? undefined}
          onChange={(e) => onChange(e.target.value)}
          options={['YES', 'NO', 'NA'].map((v) => ({
            value: v,
            label: t(`assurance:surveys.yesNo.${v}`),
          }))}
        />
      );
    case 'TEXT':
      return (
        <Input.TextArea
          disabled={disabled}
          autoSize={{ minRows: 2 }}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={10000}
        />
      );
    case 'NUMBER':
      return (
        <InputNumber
          disabled={disabled}
          value={typeof value === 'number' ? value : null}
          onChange={(v) => onChange(v ?? null)}
        />
      );
    case 'DATE':
      return (
        <DatePicker
          disabled={disabled}
          value={value ? dayjs(String(value)) : null}
          onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : null)}
        />
      );
    case 'FILE': {
      const ids = (value as string[]) ?? [];
      return (
        <EvidenceList
          files={files.filter((f) => ids.includes(f.id))}
          canAdd={!disabled && !!onUpload}
          onUpload={async (file) => {
            const f = await onUpload!(file);
            onChange([...ids, f.id]);
            return f;
          }}
          testId={`answer-${q.id}`}
        />
      );
    }
  }
}

/** A questionnaire as a form: sections, conditional questions, required marks. */
export function SurveyForm({
  definition,
  answers,
  onChange,
  disabled = false,
  files = [],
  onUpload,
  problems = [],
}: {
  definition: QuestionnaireDefinition;
  answers: Answers;
  onChange: (answers: Answers) => void;
  disabled?: boolean;
  files?: AssuranceFileDto[];
  onUpload?: (file: File) => Promise<AssuranceFileDto>;
  problems?: { questionId: string; code: string }[];
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const pick = (en: string, ar: string) => (locale === 'ar' ? ar || en : en || ar);
  return (
    <Form layout="vertical" data-testid="survey-form">
      {definition.sections.map((s) => (
        <Card
          key={s.id}
          title={pick(s.titleEn, s.titleAr)}
          size="small"
          style={{ marginBlockEnd: 16 }}
        >
          {s.questions
            .filter((q) => isQuestionVisible(q, answers))
            .map((q) => {
              const problem = problems.find((p) => p.questionId === q.id);
              return (
                <Form.Item
                  key={q.id}
                  data-testid={`question-${q.id}`}
                  required={q.required}
                  label={pick(q.textEn, q.textAr)}
                  extra={pick(q.helpEn ?? '', q.helpAr ?? '') || undefined}
                  validateStatus={problem ? 'error' : undefined}
                  help={problem ? t(`assurance:surveys.problem.${problem.code}`) : undefined}
                >
                  <QuestionInput
                    q={q}
                    value={answers[q.id]}
                    disabled={disabled}
                    files={files}
                    onUpload={onUpload}
                    onChange={(v) => onChange({ ...answers, [q.id]: v })}
                  />
                </Form.Item>
              );
            })}
        </Card>
      ))}
      {!definition.sections.some((s) => s.questions.length) && (
        <Typography.Text type="secondary">{t('assurance:surveys.noQuestions')}</Typography.Text>
      )}
    </Form>
  );
}
