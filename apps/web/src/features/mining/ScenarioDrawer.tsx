import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Col,
  DatePicker,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  TimePicker,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  DISTRIBUTION_TYPES,
  UAE_HOLIDAYS,
  WORK_WEEKS,
  type Distribution,
  type ScenarioDto,
  type ScenarioParams,
  type SimulationDto,
} from '@processhub/shared';
import { useSaveScenario } from '@/api/simulation';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage } from '@/components/i18n-helpers';
import { pickLabel } from '@/features/modeler/labels';

type Step = SimulationDto['model']['steps'][number];

/** Parameter editor of one scenario: general, steps, resources, branch probabilities. */
export function ScenarioDrawer({
  sim,
  scenario,
  onClose,
}: {
  sim: SimulationDto;
  scenario: ScenarioDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const save = useSaveScenario(sim.id);
  const [p, setP] = useState<ScenarioParams>(scenario.params);
  const [name, setName] = useState({ nameEn: scenario.nameEn, nameAr: scenario.nameAr });
  const [version, setVersion] = useState<number | null>(scenario.processVersion);
  const [kind, setKind] = useState(scenario.kind);
  useEffect(() => setP(scenario.params), [scenario.params]);
  const label = (x: { nameEn: string; nameAr: string; id?: string }) =>
    pickLabel(x, locale) || x.id || '';
  const set = (patch: Partial<ScenarioParams>) => setP((cur) => ({ ...cur, ...patch }));
  const setStep = (id: string, patch: { duration?: Distribution; cost?: number }) =>
    set({ steps: { ...p.steps, [id]: { ...p.steps[id], ...patch } } });
  const stepDist = (s: Step): Distribution =>
    p.steps[s.id]?.duration ?? { type: 'fixed', mean: s.durationMinutes ?? 0 };
  const num = (v: number | null | undefined) => (typeof v === 'number' ? v : undefined);

  const general = (
    <Form layout="vertical">
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item label={t('mining:fields.nameEn')}>
            <Input
              value={name.nameEn}
              onChange={(e) => setName({ ...name, nameEn: e.target.value })}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label={t('mining:fields.nameAr')}>
            <Input
              dir="rtl"
              value={name.nameAr}
              onChange={(e) => setName({ ...name, nameAr: e.target.value })}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label={t('mining:sim.kind')}>
            <Radio.Group
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              options={[
                { value: 'AS_IS', label: t('mining:sim.kinds.AS_IS') },
                { value: 'TO_BE', label: t('mining:sim.kinds.TO_BE') },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label={t('mining:sim.processVersion')}>
            <Select
              value={version ?? 0}
              onChange={(v) => setVersion(v || null)}
              options={[
                { value: 0, label: t('mining:sim.workingModel') },
                ...sim.model.versions.map((v) => ({ value: v, label: `v${v}` })),
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            label={t('mining:sim.arrivals')}
            extra={
              p.arrival.unit === 'model'
                ? t('mining:sim.fromModel', { n: sim.model.arrivalsPerMonth })
                : undefined
            }
          >
            <Flex gap={8}>
              <Select
                style={{ width: 170 }}
                value={p.arrival.unit}
                onChange={(unit) => set({ arrival: { ...p.arrival, unit } })}
                options={(['model', 'month', 'day'] as const).map((u) => ({
                  value: u,
                  label: t(`mining:sim.arrivalUnit.${u}`),
                }))}
              />
              {p.arrival.unit !== 'model' && (
                <InputNumber
                  min={0}
                  value={p.arrival.rate}
                  onChange={(v) => set({ arrival: { ...p.arrival, rate: v ?? 0 } })}
                  data-testid="sim-arrival-rate"
                />
              )}
            </Flex>
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label={t('mining:sim.caseSla')}>
            <InputNumber
              min={0}
              value={p.slaHours ?? undefined}
              placeholder={t('mining:sim.none')}
              onChange={(v) => set({ slaHours: typeof v === 'number' ? v : null })}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={t('mining:sim.startDate')}>
            <DatePicker
              allowClear={false}
              value={dayjs(p.startDate)}
              onChange={(d) => d && set({ startDate: d.format('YYYY-MM-DD') })}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={t('mining:sim.days')}>
            <InputNumber
              min={1}
              max={3660}
              value={p.days}
              onChange={(v) => set({ days: v ?? 90 })}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={t('mining:sim.warmup')}>
            <InputNumber
              min={0}
              max={365}
              value={p.warmupDays}
              onChange={(v) => set({ warmupDays: v ?? 0 })}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={t('mining:sim.seed')}>
            <InputNumber min={0} value={p.seed} onChange={(v) => set({ seed: v ?? 1 })} />
          </Form.Item>
        </Col>
      </Row>
      <Typography.Title level={5}>{t('mining:sim.calendar')}</Typography.Title>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item label={t('mining:sim.week')}>
            <Select
              value={p.calendar.week}
              disabled={p.calendar.alwaysOpen}
              onChange={(week) => set({ calendar: { ...p.calendar, week } })}
              options={WORK_WEEKS.map((w) => ({ value: w, label: t(`mining:sim.weeks.${w}`) }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={10}>
          <Form.Item label={t('mining:sim.hours')}>
            <TimePicker.RangePicker
              format="HH:mm"
              minuteStep={15}
              disabled={p.calendar.alwaysOpen}
              allowClear={false}
              value={[
                dayjs(`2000-01-01T${p.calendar.start}`),
                dayjs(`2000-01-01T${p.calendar.end}`),
              ]}
              onChange={(r) =>
                r?.[0] &&
                r[1] &&
                set({
                  calendar: {
                    ...p.calendar,
                    start: r[0].format('HH:mm'),
                    end: r[1].format('HH:mm'),
                  },
                })
              }
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item label={t('mining:sim.alwaysOpen')}>
            <Switch
              checked={p.calendar.alwaysOpen}
              onChange={(v) => set({ calendar: { ...p.calendar, alwaysOpen: v } })}
            />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item
            label={t('mining:sim.holidays')}
            extra={
              <Button
                size="small"
                type="link"
                style={{ paddingInline: 0 }}
                onClick={() => {
                  const y = Number(p.startDate.slice(0, 4));
                  set({
                    calendar: {
                      ...p.calendar,
                      holidays: [
                        ...new Set([
                          ...p.calendar.holidays,
                          ...(UAE_HOLIDAYS[y] ?? []),
                          ...(UAE_HOLIDAYS[y + 1] ?? []),
                        ]),
                      ].sort(),
                    },
                  });
                }}
              >
                {t('mining:sim.addUae')}
              </Button>
            }
          >
            <Select
              mode="tags"
              value={p.calendar.holidays}
              onChange={(v: string[]) =>
                set({
                  calendar: {
                    ...p.calendar,
                    holidays: v.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(),
                  },
                })
              }
              tokenSeparators={[',', ' ']}
              placeholder="YYYY-MM-DD"
            />
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  const steps = (
    <Table<Step>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={sim.model.steps}
      data-testid="sim-steps"
      columns={[
        { title: t('mining:activities.step'), render: (_, s) => label(s) },
        {
          title: t('mining:sim.distribution'),
          width: 150,
          render: (_, s) => (
            <Select
              size="small"
              style={{ width: '100%' }}
              value={stepDist(s).type}
              onChange={(type) => {
                const cur = stepDist(s);
                const mean = cur.mean ?? cur.mode ?? s.durationMinutes ?? 0;
                setStep(s.id, {
                  duration:
                    type === 'triangular' || type === 'uniform'
                      ? { type, min: Math.round(mean * 0.5), mode: mean, max: Math.round(mean * 2) }
                      : type === 'normal'
                        ? { type, mean, sd: Math.round(mean * 0.2) }
                        : { type, mean },
                });
              }}
              options={DISTRIBUTION_TYPES.map((d) => ({
                value: d,
                label: t(`mining:sim.distributions.${d}`),
              }))}
            />
          ),
        },
        {
          title: t('mining:sim.minutes'),
          render: (_, s) => {
            const d = stepDist(s);
            const field = (k: 'mean' | 'sd' | 'min' | 'mode' | 'max') => (
              <InputNumber
                key={k}
                size="small"
                min={0}
                style={{ width: 86 }}
                addonBefore={t(`mining:sim.params.${k}`)}
                value={num(d[k])}
                onChange={(v) => setStep(s.id, { duration: { ...d, [k]: v ?? 0 } })}
                data-testid={`sim-${s.id}-${k}`}
              />
            );
            return (
              <Flex gap={4} wrap="wrap">
                {d.type === 'triangular'
                  ? ['min', 'mode', 'max'].map((k) => field(k as 'min'))
                  : d.type === 'uniform'
                    ? ['min', 'max'].map((k) => field(k as 'min'))
                    : d.type === 'normal'
                      ? ['mean', 'sd'].map((k) => field(k as 'mean'))
                      : field('mean')}
              </Flex>
            );
          },
        },
        {
          title: t('mining:sim.cost'),
          width: 110,
          render: (_, s) => (
            <InputNumber
              size="small"
              min={0}
              value={p.steps[s.id]?.cost ?? s.costPerExecution ?? undefined}
              onChange={(v) => setStep(s.id, { cost: v ?? 0 })}
            />
          ),
        },
      ]}
    />
  );

  const resources = (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={sim.model.lanes}
      data-testid="sim-resources"
      columns={[
        { title: t('mining:sim.lane'), render: (_, l) => label(l) },
        {
          title: t('mining:sim.capacity'),
          width: 140,
          render: (_, l) => (
            <InputNumber
              size="small"
              min={0}
              value={p.resources[l.id]?.capacity}
              status={!p.resources[l.id]?.capacity ? 'error' : undefined}
              onChange={(v) =>
                set({
                  resources: {
                    ...p.resources,
                    [l.id]: { costPerHour: p.resources[l.id]?.costPerHour ?? 0, capacity: v ?? 0 },
                  },
                })
              }
              data-testid={`sim-capacity-${l.id}`}
            />
          ),
        },
        {
          title: t('mining:sim.costPerHour'),
          width: 140,
          render: (_, l) => (
            <InputNumber
              size="small"
              min={0}
              value={p.resources[l.id]?.costPerHour}
              onChange={(v) =>
                set({
                  resources: {
                    ...p.resources,
                    [l.id]: { capacity: p.resources[l.id]?.capacity ?? 1, costPerHour: v ?? 0 },
                  },
                })
              }
            />
          ),
        },
      ]}
    />
  );

  const probabilities = (
    <Flex vertical gap={12}>
      {sim.model.gateways.length === 0 && (
        <Typography.Text type="secondary">{t('mining:sim.noGateways')}</Typography.Text>
      )}
      {sim.model.gateways.map((g) => {
        const sum = g.flows.reduce(
          (s, f) => s + (p.probabilities[f.id] ?? 100 / g.flows.length),
          0,
        );
        const exclusive = g.type === 'bpmn:ExclusiveGateway';
        return (
          <div key={g.id}>
            <Flex gap={8} align="center">
              <Typography.Text strong>{label(g) || g.id}</Typography.Text>
              {exclusive && (
                <Tag color={Math.abs(sum - 100) > 0.5 ? 'red' : 'green'}>
                  {t('mining:sim.sum', { sum: Math.round(sum * 10) / 10 })}
                </Tag>
              )}
            </Flex>
            {g.flows.map((f) => (
              <Flex key={f.id} gap={8} align="center" style={{ marginBlockStart: 4 }}>
                <span style={{ minWidth: 220 }}>→ {label(f)}</span>
                <InputNumber
                  size="small"
                  min={0}
                  max={100}
                  addonAfter="%"
                  value={p.probabilities[f.id] ?? Math.round((100 / g.flows.length) * 10) / 10}
                  onChange={(v) => set({ probabilities: { ...p.probabilities, [f.id]: v ?? 0 } })}
                  data-testid={`sim-prob-${f.id}`}
                />
              </Flex>
            ))}
          </div>
        );
      })}
    </Flex>
  );

  return (
    <Drawer
      open
      width="min(900px, 96vw)"
      title={t('mining:sim.editScenario', { name: label(scenario) })}
      onClose={onClose}
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          data-testid="sim-save-scenario"
          onClick={() =>
            save
              .mutateAsync({
                scenarioId: scenario.id,
                body: { ...name, kind, processVersion: version, params: p },
              })
              .then(onClose)
              .catch((e: unknown) => void message.error(errorMessage(e)))
          }
        >
          {t('mining:sim.save')}
        </Button>
      }
    >
      <Tabs
        items={[
          { key: 'general', label: t('mining:sim.tabs.general'), children: general },
          { key: 'steps', label: t('mining:sim.tabs.steps'), children: steps },
          { key: 'resources', label: t('mining:sim.tabs.resources'), children: resources },
          {
            key: 'probabilities',
            label: t('mining:sim.tabs.probabilities'),
            children: probabilities,
          },
        ]}
      />
    </Drawer>
  );
}
