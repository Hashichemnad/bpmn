import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Collapse,
  Flex,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PROPOSAL_FIELDS,
  QUESTION_TYPES,
  QUESTIONNAIRE_STATUSES,
  SURVEY_PURPOSES,
  type Answers,
  type Question,
  type QuestionnaireDefinition,
  type QuestionType,
  type QuestionnaireStatus,
  type SurveyPurpose,
} from '@processhub/shared';
import { useQuestionnaire, useSaveQuestionnaire } from '@/api/assurance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { GrcItemSelect } from '@/features/grc/GrcItemSelect';
import { SurveyForm } from './SurveyForm';

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 7)}`;
const EFFECTIVENESS_OPTIONS = [
  { id: 'EFFECTIVE', en: 'Effective', ar: 'فعال', score: 2 },
  { id: 'PARTLY', en: 'Partly effective', ar: 'فعال جزئيًا', score: 1 },
  { id: 'NOT_EFFECTIVE', en: 'Not effective', ar: 'غير فعال', score: 0 },
];

interface Meta {
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  purpose: SurveyPurpose;
  status: QuestionnaireStatus;
}

/** One question: type, texts, required, weight, options, condition, RCSA link. */
function QuestionEditor({
  q,
  earlier,
  onChange,
}: {
  q: Question;
  earlier: Question[];
  onChange: (q: Question) => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const set = (p: Partial<Question>) => onChange({ ...q, ...p });
  const choice = q.type === 'SINGLE' || q.type === 'MULTIPLE';
  const conditionSource = earlier.find((e) => e.id === q.showIf?.questionId);
  const conditionValues = conditionSource
    ? conditionSource.type === 'YES_NO_NA'
      ? ['YES', 'NO', 'NA'].map((v) => ({ value: v, label: t(`assurance:surveys.yesNo.${v}`) }))
      : conditionSource.type === 'RATING'
        ? ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))
        : conditionSource.options.map((o) => ({
            value: o.id,
            label: loc({ nameEn: o.en, nameAr: o.ar }),
          }))
    : [];
  return (
    <Space direction="vertical" style={{ width: '100%' }} data-testid={`editor-${q.id}`}>
      <Flex gap={8} wrap="wrap">
        <Select
          style={{ width: 200 }}
          value={q.type}
          data-testid={`type-${q.id}`}
          onChange={(type: QuestionType) =>
            set({
              type,
              options:
                type === 'SINGLE' || type === 'MULTIPLE'
                  ? q.options.length
                    ? q.options
                    : [
                        { id: newId('o'), en: '', ar: '', score: 0 },
                        { id: newId('o'), en: '', ar: '', score: 0 },
                      ]
                  : [],
            })
          }
          options={QUESTION_TYPES.map((v) => ({
            value: v,
            label: t(`assurance:surveys.types.${v}`),
          }))}
        />
        <Space>
          <Switch size="small" checked={q.required} onChange={(required) => set({ required })} />
          {t('assurance:surveys.required')}
        </Space>
        <Space>
          {t('assurance:surveys.weight')}
          <InputNumber
            size="small"
            min={0}
            max={100}
            value={q.weight}
            onChange={(v) => set({ weight: v ?? 0 })}
          />
        </Space>
      </Flex>
      <Row gutter={8}>
        <Col xs={24} md={12}>
          <Input
            dir="ltr"
            data-testid={`text-en-${q.id}`}
            placeholder={t('assurance:surveys.textEn')}
            value={q.textEn}
            onChange={(e) => set({ textEn: e.target.value })}
          />
        </Col>
        <Col xs={24} md={12}>
          <Input
            dir="rtl"
            placeholder={t('assurance:surveys.textAr')}
            value={q.textAr}
            onChange={(e) => set({ textAr: e.target.value })}
          />
        </Col>
      </Row>
      {choice && (
        <Space direction="vertical" style={{ width: '100%' }}>
          {q.options.map((o, i) => (
            <Flex key={o.id} gap={8} align="center">
              <Input
                dir="ltr"
                size="small"
                placeholder={t('assurance:surveys.optionEn')}
                value={o.en}
                onChange={(e) =>
                  set({
                    options: q.options.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)),
                  })
                }
              />
              <Input
                dir="rtl"
                size="small"
                placeholder={t('assurance:surveys.optionAr')}
                value={o.ar}
                onChange={(e) =>
                  set({
                    options: q.options.map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)),
                  })
                }
              />
              <InputNumber
                size="small"
                style={{ width: 90 }}
                placeholder={t('assurance:surveys.score')}
                value={o.score}
                onChange={(v) =>
                  set({ options: q.options.map((x, j) => (j === i ? { ...x, score: v ?? 0 } : x)) })
                }
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={q.options.length <= 2}
                onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}
              />
            </Flex>
          ))}
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() =>
              set({ options: [...q.options, { id: newId('o'), en: '', ar: '', score: 0 }] })
            }
          >
            {t('assurance:surveys.addOption')}
          </Button>
        </Space>
      )}
      <Flex gap={8} wrap="wrap" align="center">
        <Typography.Text type="secondary">{t('assurance:surveys.showIf')}</Typography.Text>
        <Select
          allowClear
          size="small"
          style={{ width: 240 }}
          value={q.showIf?.questionId}
          onChange={(questionId?: string) =>
            set({ showIf: questionId ? { questionId, equals: [] } : null })
          }
          options={earlier
            .filter((e) => ['SINGLE', 'MULTIPLE', 'YES_NO_NA', 'RATING'].includes(e.type))
            .map((e) => ({
              value: e.id,
              label: loc({ nameEn: e.textEn, nameAr: e.textAr }) || e.id,
            }))}
        />
        {q.showIf && (
          <Select
            mode="multiple"
            size="small"
            style={{ minWidth: 200 }}
            value={q.showIf.equals}
            placeholder={t('assurance:surveys.equals')}
            onChange={(equals: string[]) =>
              set({ showIf: { questionId: q.showIf!.questionId, equals } })
            }
            options={conditionValues}
          />
        )}
      </Flex>
      {(q.type === 'RATING' || q.type === 'SINGLE') && (
        <Flex gap={8} wrap="wrap" align="center">
          <Typography.Text type="secondary">{t('assurance:surveys.link')}</Typography.Text>
          <Select
            allowClear
            size="small"
            style={{ width: 200 }}
            value={q.link?.field}
            onChange={(field?: (typeof PROPOSAL_FIELDS)[number]) => {
              if (!field) return set({ link: null });
              set({
                link: { objectId: q.link?.objectId ?? '', field },
                ...(field === 'EFFECTIVENESS'
                  ? { type: 'SINGLE' as const, options: EFFECTIVENESS_OPTIONS }
                  : { type: 'RATING' as const, options: [] }),
              });
            }}
            options={PROPOSAL_FIELDS.map((f) => ({
              value: f,
              label: t(`assurance:surveys.fields.${f}`),
            }))}
          />
          {q.link && (
            <div style={{ width: 280 }}>
              <GrcItemSelect
                type={q.link.field === 'EFFECTIVENESS' ? 'CONTROL' : 'RISK'}
                multiple={false}
                value={q.link.objectId || null}
                onChange={(v) =>
                  set({ link: { ...q.link!, objectId: (Array.isArray(v) ? v[0] : v) ?? '' } })
                }
              />
            </div>
          )}
        </Flex>
      )}
    </Space>
  );
}

/** Questionnaire builder: sections, questions, preview. */
export function QuestionnaireBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const q = useQuestionnaire(isNew ? undefined : id);
  const save = useSaveQuestionnaire();
  const [meta, setMeta] = useState<Meta>({
    titleEn: '',
    titleAr: '',
    descriptionEn: '',
    descriptionAr: '',
    purpose: 'GENERAL',
    status: 'DRAFT',
  });
  const [def, setDef] = useState<QuestionnaireDefinition>({
    sections: [{ id: 's1', titleEn: '', titleAr: '', questions: [] }],
  });
  const [preview, setPreview] = useState<Answers>({});

  useEffect(() => {
    if (q.data) {
      const { titleEn, titleAr, descriptionEn, descriptionAr, purpose, status, definition } =
        q.data;
      setMeta({ titleEn, titleAr, descriptionEn, descriptionAr, purpose, status });
      setDef(definition);
    }
  }, [q.data]);

  if (!isNew && q.isLoading) return <LoadingState />;
  if (!isNew && (q.isError || !q.data)) return <ErrorState error={q.error} />;

  const all = def.sections.flatMap((s) => s.questions);
  const setSection = (i: number, p: Partial<QuestionnaireDefinition['sections'][number]>) =>
    setDef({ sections: def.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = <T,>(list: T[], i: number, d: number) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    return next;
  };
  const submit = () =>
    save.mutate(
      { id: isNew ? undefined : id, body: { ...meta, definition: def } },
      {
        onSuccess: (r) => {
          message.success(t('assurance:surveys.questionnaireSaved'));
          if (isNew) navigate(`/grc/surveys/questionnaires/${r.id}`, { replace: true });
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.grcGroup') },
          { title: t('assurance:surveys.title'), to: '/grc/surveys?tab=questionnaires' },
          { title: loc(meta, 'title') || t('assurance:surveys.newQuestionnaire') },
        ]}
        title={loc(meta, 'title') || t('assurance:surveys.newQuestionnaire')}
        extra={
          <Button
            type="primary"
            data-testid="questionnaire-save"
            loading={save.isPending}
            onClick={submit}
          >
            {t('save')}
          </Button>
        }
      />
      <Tabs
        items={[
          {
            key: 'build',
            label: t('assurance:surveys.build'),
            children: (
              <>
                <Card style={{ marginBlockEnd: 16 }}>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                      <Input
                        dir="ltr"
                        data-testid="q-title-en"
                        placeholder={t('assurance:issues.titleEn')}
                        value={meta.titleEn}
                        onChange={(e) => setMeta({ ...meta, titleEn: e.target.value })}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Input
                        dir="rtl"
                        data-testid="q-title-ar"
                        placeholder={t('assurance:issues.titleAr')}
                        value={meta.titleAr}
                        onChange={(e) => setMeta({ ...meta, titleAr: e.target.value })}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Input.TextArea
                        dir="ltr"
                        autoSize
                        placeholder={t('assurance:issues.descriptionEn')}
                        value={meta.descriptionEn}
                        onChange={(e) => setMeta({ ...meta, descriptionEn: e.target.value })}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Input.TextArea
                        dir="rtl"
                        autoSize
                        placeholder={t('assurance:issues.descriptionAr')}
                        value={meta.descriptionAr}
                        onChange={(e) => setMeta({ ...meta, descriptionAr: e.target.value })}
                      />
                    </Col>
                    <Col>
                      <Space>
                        {t('assurance:surveys.purpose')}
                        <Select
                          style={{ width: 240 }}
                          value={meta.purpose}
                          onChange={(purpose) => setMeta({ ...meta, purpose })}
                          options={SURVEY_PURPOSES.map((p) => ({
                            value: p,
                            label: t(`assurance:surveys.purposes.${p}`),
                          }))}
                        />
                      </Space>
                    </Col>
                    <Col>
                      <Space>
                        {t('assurance:issues.statusLabel')}
                        <Select
                          style={{ width: 160 }}
                          value={meta.status}
                          onChange={(status) => setMeta({ ...meta, status })}
                          options={QUESTIONNAIRE_STATUSES.map((p) => ({
                            value: p,
                            label: t(`assurance:surveys.qStatus.${p}`),
                          }))}
                        />
                      </Space>
                    </Col>
                  </Row>
                </Card>
                {def.sections.map((s, si) => (
                  <Card
                    key={s.id}
                    size="small"
                    style={{ marginBlockEnd: 16 }}
                    title={
                      <Flex gap={8}>
                        <Input
                          dir="ltr"
                          size="small"
                          placeholder={t('assurance:surveys.sectionEn')}
                          value={s.titleEn}
                          onChange={(e) => setSection(si, { titleEn: e.target.value })}
                        />
                        <Input
                          dir="rtl"
                          size="small"
                          placeholder={t('assurance:surveys.sectionAr')}
                          value={s.titleAr}
                          onChange={(e) => setSection(si, { titleAr: e.target.value })}
                        />
                      </Flex>
                    }
                    extra={
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={def.sections.length <= 1}
                        onClick={() =>
                          setDef({ sections: def.sections.filter((_, j) => j !== si) })
                        }
                      />
                    }
                  >
                    <Collapse
                      size="small"
                      items={s.questions.map((qq, qi) => ({
                        key: qq.id,
                        label: `${qi + 1}. ${loc({ nameEn: qq.textEn, nameAr: qq.textAr }) || t('assurance:surveys.untitled')} · ${t(`assurance:surveys.types.${qq.type}`)}${qq.required ? ' *' : ''}`,
                        extra: (
                          <Space onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="small"
                              type="text"
                              icon={<ArrowUpOutlined />}
                              disabled={qi === 0}
                              onClick={() =>
                                setSection(si, { questions: move(s.questions, qi, -1) })
                              }
                            />
                            <Button
                              size="small"
                              type="text"
                              icon={<ArrowDownOutlined />}
                              disabled={qi === s.questions.length - 1}
                              onClick={() =>
                                setSection(si, { questions: move(s.questions, qi, 1) })
                              }
                            />
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                setSection(si, {
                                  questions: s.questions.filter((_, j) => j !== qi),
                                })
                              }
                            />
                          </Space>
                        ),
                        children: (
                          <QuestionEditor
                            q={qq}
                            earlier={all.slice(
                              0,
                              all.findIndex((x) => x.id === qq.id),
                            )}
                            onChange={(nq) =>
                              setSection(si, {
                                questions: s.questions.map((x, j) => (j === qi ? nq : x)),
                              })
                            }
                          />
                        ),
                      }))}
                    />
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      style={{ marginBlockStart: 8 }}
                      data-testid={`add-question-${si}`}
                      onClick={() =>
                        setSection(si, {
                          questions: [
                            ...s.questions,
                            {
                              id: newId('q'),
                              type: 'TEXT',
                              textEn: '',
                              textAr: '',
                              required: false,
                              weight: 0,
                              options: [],
                            },
                          ],
                        })
                      }
                    >
                      {t('assurance:surveys.addQuestion')}
                    </Button>
                  </Card>
                ))}
                <Button
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setDef({
                      sections: [
                        ...def.sections,
                        { id: newId('s'), titleEn: '', titleAr: '', questions: [] },
                      ],
                    })
                  }
                >
                  {t('assurance:surveys.addSection')}
                </Button>
              </>
            ),
          },
          {
            key: 'preview',
            label: t('assurance:surveys.preview'),
            children: <SurveyForm definition={def} answers={preview} onChange={setPreview} />,
          },
        ]}
      />
    </>
  );
}
