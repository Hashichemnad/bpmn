import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  APPROVAL_OUTCOMES,
  ASSIGNMENT_TYPES,
  ESCALATION_TARGETS,
  SERVICE_KINDS,
  assignmentSchema,
  feelSyntaxError,
  parseCycle,
  parseIsoDurationMinutes,
  templatePlaceholders,
  type Assignment,
  type AssignmentInput,
  type DocumentTemplate,
  type ExecConfig,
  type NotificationTemplate,
  type ProcessDto,
} from '@processhub/shared';
import { useObject } from '@/api/hooks';
import { useWorkflowConfig, useWorkflowDepartments } from '@/api/workflow';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import type {
  BpmnInstance,
  DiagramElement,
  ElementRegistry,
  EventBus,
} from '@/features/modeler/bpmn-types';
import { ObjectPicker } from '@/features/modeler/ElementPanel';
import { FormEditor } from './FormEditor';
import { UserPicker } from './WorkflowForm';
import {
  conditionOf,
  errorCodeOf,
  eventDefinition,
  execOf,
  isDefaultFlow,
  setDefaultFlow,
  sourceOf,
  timerOf,
  variableKeys,
  writeCondition,
  writeErrorCode,
  writeExec,
  writeTimer,
  type TimerKey,
} from './modeler-exec';
import { activateProps } from '@/components/a11y';

interface Props {
  instance: BpmnInstance | null;
  element: DiagramElement | null;
  process: ProcessDto;
  canEdit: boolean;
}

/** Re-renders when the element changes (undo / redo, other panels). */
function useElementVersion(instance: BpmnInstance | null, element: DiagramElement | null) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!instance) return;
    const bus = instance.get<EventBus>('eventBus');
    const h = () => setV((x) => x + 1);
    bus.on('elements.changed', h as never);
    return () => bus.off('elements.changed', h as never);
  }, [instance, element]);
  return v;
}

const isApproval = (el: DiagramElement) =>
  el.type === 'bpmn:UserTask' && el.businessObject.get('ph:stepKind') === 'approval';

/**
 * Execution tab of the modeler (Phase 5.2, D-147): the selected element's execution settings —
 * start / task forms, assignment, due time, four-eyes, escalation, approval outcomes and conditions on
 * flows, timers, notification and document templates, "set data" — stored in the BPMN XML.
 */
export function ExecutionPanel({ instance, element, process, canEdit }: Props) {
  const { t } = useTranslation();
  const config = useWorkflowConfig(process.id);
  useElementVersion(instance, element);
  if (!instance) return null;
  const el =
    element && element.type !== 'bpmn:Process' && element.type !== 'bpmn:Collaboration'
      ? element
      : null;
  if (!el)
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary">
          {t('workflow:exec.selectElement')}
        </Typography.Paragraph>
        {config.data && (
          <Alert
            type={config.data.activeDeployment ? 'success' : 'info'}
            showIcon
            message={
              config.data.activeDeployment
                ? t('workflow:exec.deployed', {
                    version: config.data.activeDeployment.versionNumber,
                  })
                : t('workflow:exec.notDeployed')
            }
            description={
              <Link to={`/processes/${process.id}?tab=execution`}>
                <SettingOutlined /> {t('workflow:exec.processSettings')}
              </Link>
            }
          />
        )}
      </Space>
    );
  const disabled = !canEdit;
  const bo = el.businessObject;
  const cfg = execOf(bo);
  const set = (patch: Partial<ExecConfig>) => writeExec(instance, el, patch);
  const sections: React.ReactNode[] = [];
  const isEvent = el.type.endsWith('Event');

  if (
    el.type === 'bpmn:StartEvent' &&
    !(bo.get('eventDefinitions') as unknown[] | undefined)?.length
  )
    sections.push(
      <Section
        key="form"
        title={t('workflow:exec.startForm')}
        hint={t('workflow:exec.startFormHint')}
      >
        <FormEditor value={cfg.form} onChange={(form) => set({ form })} disabled={disabled} />
      </Section>,
    );

  if (el.type === 'bpmn:UserTask')
    sections.push(
      <Section key="assign" title={t('workflow:exec.assignment')}>
        <AssignmentEditor
          instance={instance}
          element={el}
          value={cfg.assignment}
          onChange={(assignment) => set({ assignment })}
          disabled={disabled}
          laneDefault
        />
      </Section>,
      <Section key="due" title={t('workflow:exec.due')}>
        <DueEditor
          value={cfg.dueMinutes}
          sla={Number(bo.get('ph:slaMinutes')) || null}
          onChange={(dueMinutes) => set({ dueMinutes })}
          disabled={disabled}
        />
        <Form.Item label={t('workflow:exec.escalation')} style={{ marginBlock: 8 }}>
          <Select
            size="small"
            disabled={disabled}
            value={cfg.escalation}
            onChange={(escalation) => set({ escalation })}
            options={ESCALATION_TARGETS.map((x) => ({
              value: x,
              label: t(`workflow:escalation.${x}`),
            }))}
          />
        </Form.Item>
        <Checkbox
          checked={cfg.fourEyes}
          disabled={disabled}
          onChange={(e) => set({ fourEyes: e.target.checked })}
        >
          {t('workflow:exec.fourEyes')}
        </Checkbox>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBlockStart: 4 }}>
          {t('workflow:exec.fourEyesHint')}
        </Typography.Paragraph>
      </Section>,
      <Section
        key="form"
        title={t('workflow:exec.taskForm')}
        hint={isApproval(el) ? t('workflow:exec.approvalHint') : undefined}
      >
        <FormEditor value={cfg.form} onChange={(form) => set({ form })} disabled={disabled} />
      </Section>,
    );

  if (el.type === 'bpmn:SequenceFlow') {
    const src = sourceOf(instance, el);
    const fromGateway = !!src && /Gateway$/.test(src.type);
    const parallel = src?.type === 'bpmn:ParallelGateway';
    if (src && isApproval(src))
      sections.push(
        <Section
          key="outcome"
          title={t('workflow:exec.outcome')}
          hint={t('workflow:exec.outcomeHint')}
        >
          <Radio.Group
            size="small"
            disabled={disabled}
            value={cfg.outcome ?? ''}
            onChange={(e) => set({ outcome: e.target.value || null })}
            optionType="button"
            options={[
              { value: '', label: t('workflow:exec.anyOutcome') },
              ...APPROVAL_OUTCOMES.map((o) => ({ value: o, label: t(`workflow:decision.${o}`) })),
            ]}
          />
        </Section>,
      );
    if (!parallel)
      sections.push(
        <Section key="cond" title={t('workflow:exec.condition')}>
          {fromGateway && (
            <Checkbox
              checked={isDefaultFlow(instance, el)}
              disabled={disabled}
              onChange={(e) => setDefaultFlow(instance, el, e.target.checked)}
              style={{ marginBlockEnd: 8 }}
            >
              {t('workflow:exec.defaultFlow')}
            </Checkbox>
          )}
          {!isDefaultFlow(instance, el) && (
            <ExpressionInput
              instance={instance}
              value={conditionOf(bo)}
              placeholder='estimatedBudget >= 100000 and programType = "digital"'
              onCommit={(v) => writeCondition(instance, el, v)}
              disabled={disabled}
            />
          )}
        </Section>,
      );
  }

  if (el.type === 'bpmn:ServiceTask')
    sections.push(
      <Section key="kind" title={t('workflow:exec.serviceKind')}>
        <Select
          size="small"
          style={{ width: '100%' }}
          disabled={disabled}
          value={cfg.kind ?? undefined}
          placeholder={t('workflow:exec.chooseKind')}
          onChange={(kind) => set({ kind })}
          options={SERVICE_KINDS.map((k) => ({ value: k, label: t(`workflow:serviceKind.${k}`) }))}
        />
        {cfg.kind === 'SET_DATA' && (
          <SetDataEditor
            instance={instance}
            value={cfg.set}
            onChange={(s) => set({ set: s })}
            disabled={disabled}
          />
        )}
        {cfg.kind === 'GENERATE_DOCUMENT' && (
          <DocumentEditor
            value={cfg.document}
            onChange={(document) => set({ document })}
            disabled={disabled}
          />
        )}
      </Section>,
    );

  if (el.type === 'bpmn:SendTask')
    sections.push(
      <Section key="notify" title={t('workflow:exec.notification')}>
        <NotificationEditor
          instance={instance}
          element={el}
          value={cfg.notify}
          onChange={(notify) => set({ notify })}
          disabled={disabled}
        />
      </Section>,
    );

  if (el.type === 'bpmn:BusinessRuleTask')
    sections.push(
      <Alert key="dmn" type="info" showIcon message={t('workflow:exec.businessRuleHint')} />,
    );
  if (el.type === 'bpmn:CallActivity')
    sections.push(
      <Alert key="call" type="info" showIcon message={t('workflow:exec.callActivityHint')} />,
    );

  const timer = isEvent ? timerOf(bo) : null;
  if (timer)
    sections.push(
      <Section key="timer" title={t('workflow:exec.timer')}>
        <TimerEditor
          value={timer}
          disabled={disabled}
          onChange={(k, v) => writeTimer(instance, el, k, v)}
        />
        <Checkbox
          checked={cfg.workingTime}
          disabled={disabled || timer.key === 'timeDate'}
          onChange={(e) => set({ workingTime: e.target.checked })}
        >
          {t('workflow:exec.workingTime')}
        </Checkbox>
        {el.type === 'bpmn:BoundaryEvent' && (
          <div style={{ marginBlockStart: 8 }}>
            <Checkbox
              checked={bo.get('cancelActivity') !== false}
              disabled={disabled}
              onChange={(e) =>
                instance
                  .get<{ updateModdleProperties: (a: unknown, b: unknown, c: unknown) => void }>(
                    'modeling',
                  )
                  .updateModdleProperties(el, bo, { cancelActivity: e.target.checked })
              }
            >
              {t('workflow:exec.interrupting')}
            </Checkbox>
          </div>
        )}
      </Section>,
    );
  if (isEvent && eventDefinition(bo, 'bpmn:ErrorEventDefinition'))
    sections.push(
      <Section
        key="error"
        title={t('workflow:exec.errorCode')}
        hint={
          el.type === 'bpmn:BoundaryEvent'
            ? t('workflow:exec.errorBoundaryHint')
            : t('workflow:exec.errorEndHint')
        }
      >
        <CommitInput
          value={errorCodeOf(bo)}
          disabled={disabled}
          onCommit={(v) => writeErrorCode(instance, el, v)}
          placeholder="BUDGET_REJECTED"
        />
      </Section>,
    );
  if (isEvent && eventDefinition(bo, 'bpmn:TerminateEventDefinition'))
    sections.push(
      <Alert key="term" type="info" showIcon message={t('workflow:exec.terminateHint')} />,
    );

  if (!sections.length)
    return (
      <Typography.Paragraph type="secondary">{t('workflow:exec.nothing')}</Typography.Paragraph>
    );
  return (
    <Form layout="vertical" component="div" className="ph-exec-panel">
      {sections}
    </Form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBlockEnd: 16 }}>
      <Divider orientation="left" orientationMargin={0} style={{ marginBlock: '4px 8px' }}>
        {title}
      </Divider>
      {hint && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Paragraph>
      )}
      {children}
    </section>
  );
}

/** Text input that commits on blur / Enter (one undo step per edit). */
function CommitInput({
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Input
      size="small"
      dir="ltr"
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onPressEnter={() => v !== value && onCommit(v)}
    />
  );
}

/** S-FEEL expression with a syntax check and the available variables. */
function ExpressionInput({
  instance,
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  instance: BpmnInstance;
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const error = v.trim() ? feelSyntaxError(v) : null;
  const keys = variableKeys(instance);
  return (
    <>
      <Input.TextArea
        dir="ltr"
        rows={2}
        value={v}
        disabled={disabled}
        placeholder={placeholder}
        status={error ? 'error' : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        style={{ fontFamily: 'monospace' }}
        data-testid="exec-condition"
      />
      {error && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          {t('workflow:exec.syntax', { error })}
        </Typography.Text>
      )}
      <Flex wrap gap={4} style={{ marginBlockStart: 6 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('workflow:exec.variables')}
        </Typography.Text>
        {['decision', ...keys.map((k) => k.key)].map((k) => (
          <Tag
            key={k}
            style={{ cursor: disabled ? undefined : 'pointer' }}
            {...activateProps(
              () => setV((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${k}`),
              disabled,
            )}
          >
            <span dir="ltr">{k}</span>
          </Tag>
        ))}
      </Flex>
    </>
  );
}

function DueEditor({
  value,
  sla,
  onChange,
  disabled,
}: {
  value: number | null;
  sla: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const hours = value !== null ? Math.round((value / 60) * 100) / 100 : null;
  return (
    <Form.Item
      label={t('workflow:exec.dueHours')}
      extra={
        sla
          ? t('workflow:exec.dueFromSla', { hours: Math.round((sla / 60) * 100) / 100 })
          : t('workflow:exec.dueNone')
      }
      style={{ marginBlockEnd: 8 }}
    >
      <InputNumber
        size="small"
        min={0.25}
        max={8760}
        step={0.5}
        disabled={disabled}
        value={hours ?? undefined}
        placeholder={sla ? String(Math.round((sla / 60) * 100) / 100) : undefined}
        onChange={(h) => onChange(h ? Math.round(Number(h) * 60) : null)}
        style={{ width: '100%' }}
        data-testid="exec-due"
      />
    </Form.Item>
  );
}

function RoleName({ id }: { id: string | null }) {
  const role = useObject(id ?? undefined);
  const loc = useLocalized();
  return id ? <Tag color="blue">{role.data ? loc(role.data) : '…'}</Tag> : null;
}

/** Assignment rule editor (step 2): lane role, role (+ department), user, owner, initiator, manager, previous performer, form field. */
export function AssignmentEditor({
  instance,
  element,
  value,
  onChange,
  disabled,
  laneDefault,
  types = ASSIGNMENT_TYPES,
}: {
  instance: BpmnInstance;
  element: DiagramElement | null;
  value: Assignment | null;
  onChange: (a: Assignment | null) => void;
  disabled?: boolean;
  laneDefault?: boolean;
  types?: readonly Assignment['type'][];
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const departments = useWorkflowDepartments();
  const a = value ?? (laneDefault ? assignmentSchema.parse({ type: 'LANE_ROLE' }) : null);
  const laneRole = useMemo(() => {
    if (!element) return null;
    const lanes = instance
      .get<ElementRegistry>('elementRegistry')
      .filter((x) => x.type === 'bpmn:Lane');
    const lane = lanes.find((l) =>
      ((l.businessObject.get('flowNodeRef') as { id: string }[] | undefined) ?? []).some(
        (n) => n.id === element.id,
      ),
    );
    return (lane?.businessObject.get('ph:roleId') as string | undefined) || null;
  }, [instance, element]);
  const userTasks = useMemo(
    () =>
      instance
        .get<ElementRegistry>('elementRegistry')
        .filter((x) => x.type === 'bpmn:UserTask' && x.id !== element?.id)
        .map((x) => ({
          value: x.id,
          label: (x.businessObject.name as string | undefined) || x.id,
        })),
    [instance, element],
  );
  const userFields = variableKeys(instance).filter((k) => k.type === 'user');
  const update = (patch: Partial<AssignmentInput>) =>
    onChange(assignmentSchema.parse({ ...(a ?? {}), ...patch }));
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={6}>
      <Select
        size="small"
        style={{ width: '100%' }}
        disabled={disabled}
        value={a?.type}
        placeholder={t('workflow:exec.chooseAssignment')}
        onChange={(type) => onChange(assignmentSchema.parse({ type }))}
        options={types.map((x) => ({ value: x, label: t(`workflow:assignment.${x}`) }))}
        data-testid="exec-assignment"
      />
      {a?.type === 'LANE_ROLE' &&
        (laneRole ? (
          <RoleName id={laneRole} />
        ) : (
          element && <Alert type="warning" showIcon message={t('workflow:exec.noLaneRole')} />
        ))}
      {a?.type === 'ROLE' && (
        <>
          <RoleName id={a.roleId} />
          {!disabled && (
            <ObjectPicker
              type="ROLE"
              exclude={new Set(a.roleId ? [a.roleId] : [])}
              onPick={(o) => update({ roleId: o.id })}
            />
          )}
        </>
      )}
      {(a?.type === 'ROLE' || a?.type === 'LANE_ROLE') && (
        <Select
          size="small"
          disabled={disabled}
          value={a.department}
          onChange={(department) => update({ department, departmentId: null })}
          options={(['ANY', 'INITIATOR', 'SPECIFIC'] as const).map((d) => ({
            value: d,
            label: t(`workflow:assignmentDepartment.${d}`),
          }))}
        />
      )}
      {(a?.type === 'ROLE' || a?.type === 'LANE_ROLE') && a.department === 'SPECIFIC' && (
        <Select
          size="small"
          showSearch
          optionFilterProp="label"
          disabled={disabled}
          value={a.departmentId ?? undefined}
          onChange={(departmentId) => update({ departmentId })}
          options={(departments.data ?? []).map((d) => ({
            value: d.id,
            label: (locale === 'ar' ? d.nameAr || d.nameEn : d.nameEn || d.nameAr) || d.id,
          }))}
        />
      )}
      {a?.type === 'USER' && (
        <UserPicker
          value={a.userId ?? undefined}
          onChange={(userId) => update({ userId })}
          disabled={disabled}
        />
      )}
      {a?.type === 'PREVIOUS_PERFORMER' && (
        <Select
          size="small"
          disabled={disabled}
          value={a.elementId ?? undefined}
          onChange={(elementId) => update({ elementId })}
          options={userTasks}
        />
      )}
      {a?.type === 'FORM_FIELD' && (
        <Select
          size="small"
          disabled={disabled}
          value={a.fieldKey ?? undefined}
          onChange={(fieldKey) => update({ fieldKey })}
          options={userFields.map((f) => ({ value: f.key, label: f.key }))}
          notFoundContent={t('workflow:exec.noUserFields')}
        />
      )}
      {a && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t(`workflow:assignmentHint.${a.type}`)}
        </Typography.Text>
      )}
    </Space>
  );
}

function TimerEditor({
  value,
  onChange,
  disabled,
}: {
  value: { key: TimerKey; value: string };
  onChange: (k: TimerKey, v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<TimerKey>(value.key);
  const [text, setText] = useState(value.value);
  useEffect(() => {
    setKind(value.key);
    setText(value.value);
  }, [value.key, value.value]);
  const valid =
    kind === 'timeDuration'
      ? parseIsoDurationMinutes(text) !== null
      : kind === 'timeDate'
        ? !Number.isNaN(Date.parse(text))
        : !!parseCycle(text);
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={6}>
      <Radio.Group
        size="small"
        optionType="button"
        disabled={disabled}
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        options={(['timeDuration', 'timeDate', 'timeCycle'] as const).map((k) => ({
          value: k,
          label: t(`workflow:timer.${k}`),
        }))}
      />
      <Input
        size="small"
        dir="ltr"
        value={text}
        disabled={disabled}
        status={text && !valid ? 'error' : undefined}
        placeholder={
          kind === 'timeDuration'
            ? 'P2D, PT4H'
            : kind === 'timeDate'
              ? '2026-12-31T09:00:00+04:00'
              : 'R3/PT1H'
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text !== value.value || kind !== value.key) && onChange(kind, text)}
        data-testid="exec-timer"
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t(`workflow:timer.${kind}Hint`)}
      </Typography.Text>
    </Space>
  );
}

function SetDataEditor({
  instance,
  value,
  onChange,
  disabled,
}: {
  instance: BpmnInstance;
  value: ExecConfig['set'];
  onChange: (v: ExecConfig['set']) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Space direction="vertical" style={{ width: '100%', marginBlockStart: 8 }}>
      {value.map((row, i) => (
        <Flex key={i} gap={4} align="flex-start">
          <Input
            size="small"
            dir="ltr"
            style={{ width: 120 }}
            value={row.key}
            disabled={disabled}
            placeholder={t('workflow:exec.variable')}
            onChange={(e) =>
              onChange(value.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
            }
          />
          <div style={{ flex: 1 }}>
            <ExpressionInput
              instance={instance}
              value={row.expression}
              disabled={disabled}
              onCommit={(expression) =>
                onChange(value.map((r, j) => (j === i ? { ...r, expression } : r)))
              }
            />
          </div>
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            disabled={disabled}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={t('delete')}
          />
        </Flex>
      ))}
      <Button
        size="small"
        icon={<PlusOutlined />}
        disabled={disabled}
        onClick={() => onChange([...value, { key: `value${value.length + 1}`, expression: '' }])}
      >
        {t('workflow:exec.addAssignment')}
      </Button>
    </Space>
  );
}

function PlaceholderHint({ text }: { text: string }) {
  const { t } = useTranslation();
  const used = templatePlaceholders(text);
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {t('workflow:exec.placeholders')}
      {used.length > 0 && (
        <>
          {' '}
          ·{' '}
          {used.map((u) => (
            <Tag key={u}>
              <span dir="ltr">{u}</span>
            </Tag>
          ))}
        </>
      )}
    </Typography.Text>
  );
}

function DocumentEditor({
  value,
  onChange,
  disabled,
}: {
  value: DocumentTemplate | null;
  onChange: (v: DocumentTemplate) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const d: DocumentTemplate = value ?? {
    fileNameEn: 'document',
    fileNameAr: '',
    language: 'INITIATOR',
    titleEn: '',
    titleAr: '',
    bodyEn: '',
    bodyAr: '',
    includeData: true,
  };
  const field = (k: keyof DocumentTemplate, rows = 0, dir: 'ltr' | 'rtl' = 'ltr') => (
    <Form.Item label={t(`workflow:document.${k}`)} style={{ marginBlockEnd: 8 }}>
      {rows ? (
        <Input.TextArea
          rows={rows}
          dir={dir}
          disabled={disabled}
          defaultValue={d[k] as string}
          onBlur={(e) => onChange({ ...d, [k]: e.target.value })}
        />
      ) : (
        <Input
          size="small"
          dir={dir}
          disabled={disabled}
          defaultValue={d[k] as string}
          onBlur={(e) => onChange({ ...d, [k]: e.target.value })}
        />
      )}
    </Form.Item>
  );
  return (
    <Form layout="vertical" style={{ marginBlockStart: 8 }}>
      {field('fileNameEn')}
      {field('fileNameAr', 0, 'rtl')}
      <Form.Item label={t('workflow:document.language')} style={{ marginBlockEnd: 8 }}>
        <Select
          size="small"
          disabled={disabled}
          value={d.language}
          onChange={(language) => onChange({ ...d, language })}
          options={(['INITIATOR', 'en', 'ar'] as const).map((x) => ({
            value: x,
            label: t(`workflow:document.lang.${x}`),
          }))}
        />
      </Form.Item>
      {field('titleEn')}
      {field('titleAr', 0, 'rtl')}
      {field('bodyEn', 4)}
      {field('bodyAr', 4, 'rtl')}
      <Checkbox
        checked={d.includeData}
        disabled={disabled}
        onChange={(e) => onChange({ ...d, includeData: e.target.checked })}
      >
        {t('workflow:document.includeData')}
      </Checkbox>
      <div>
        <PlaceholderHint text={`${d.titleEn} ${d.bodyEn} ${d.titleAr} ${d.bodyAr}`} />
      </div>
    </Form>
  );
}

function NotificationEditor({
  instance,
  element,
  value,
  onChange,
  disabled,
}: {
  instance: BpmnInstance;
  element: DiagramElement;
  value: NotificationTemplate | null;
  onChange: (v: NotificationTemplate) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const n: NotificationTemplate = value ?? {
    recipients: [],
    subjectEn: '',
    subjectAr: '',
    bodyEn: '',
    bodyAr: '',
    email: true,
  };
  const text = (k: 'subjectEn' | 'subjectAr' | 'bodyEn' | 'bodyAr') => (
    <Form.Item label={t(`workflow:notify.${k}`)} style={{ marginBlockEnd: 8 }}>
      {k.startsWith('body') ? (
        <Input.TextArea
          rows={3}
          dir={k.endsWith('Ar') ? 'rtl' : 'ltr'}
          disabled={disabled}
          defaultValue={n[k]}
          onBlur={(e) => onChange({ ...n, [k]: e.target.value })}
        />
      ) : (
        <Input
          size="small"
          dir={k.endsWith('Ar') ? 'rtl' : 'ltr'}
          disabled={disabled}
          defaultValue={n[k]}
          onBlur={(e) => onChange({ ...n, [k]: e.target.value })}
        />
      )}
    </Form.Item>
  );
  return (
    <Form layout="vertical">
      <Typography.Text strong>{t('workflow:notify.recipients')}</Typography.Text>
      {n.recipients.map((r, i) => (
        <Flex key={i} gap={4} style={{ marginBlock: 4 }}>
          <div style={{ flex: 1 }}>
            <AssignmentEditor
              instance={instance}
              element={element}
              value={r}
              disabled={disabled}
              onChange={(a) =>
                onChange({ ...n, recipients: n.recipients.map((x, j) => (j === i ? (a ?? x) : x)) })
              }
            />
          </div>
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            disabled={disabled}
            onClick={() => onChange({ ...n, recipients: n.recipients.filter((_, j) => j !== i) })}
            aria-label={t('delete')}
          />
        </Flex>
      ))}
      <Button
        size="small"
        icon={<PlusOutlined />}
        disabled={disabled}
        style={{ marginBlockEnd: 8 }}
        onClick={() =>
          onChange({
            ...n,
            recipients: [...n.recipients, assignmentSchema.parse({ type: 'INITIATOR' })],
          })
        }
      >
        {t('workflow:notify.addRecipient')}
      </Button>
      {text('subjectEn')}
      {text('subjectAr')}
      {text('bodyEn')}
      {text('bodyAr')}
      <Checkbox
        checked={n.email}
        disabled={disabled}
        onChange={(e) => onChange({ ...n, email: e.target.checked })}
      >
        {t('workflow:notify.email')}
      </Checkbox>
      <div>
        <PlaceholderHint text={`${n.subjectEn} ${n.bodyEn} ${n.subjectAr} ${n.bodyAr}`} />
      </div>
    </Form>
  );
}
