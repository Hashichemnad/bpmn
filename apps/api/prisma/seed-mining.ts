import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_DIAGRAM_THEME,
  DEFAULT_UAE_HOLIDAYS,
  resolveHolidays,
  autoMatchActivities,
  buildLogData,
  miningKpiSeries,
  parseBpmnGraph,
  periodStart,
  scenarioParamsSchema,
  stableJson,
  shiftPeriod,
  simulate,
  summariseLog,
} from '@processhub/shared';
import { structureToBpmn } from '../src/ai/bpmn/structure-to-bpmn';
import type { ProcessStructure } from '../src/ai/bpmn/process-structure';
import { setPhAttributes } from '../src/mining/bpmn-attributes';
import { INVOICE_STEPS, generateInvoiceLog } from './demo-event-log';

const node = (
  id: string,
  type: ProcessStructure['nodes'][number]['type'],
  nameEn: string,
  nameAr: string,
  lane: string,
): ProcessStructure['nodes'][number] => ({
  id,
  type,
  eventDefinition: 'none',
  nameEn,
  nameAr,
  lane,
  descriptionEn: '',
  descriptionAr: '',
  systemEn: '',
  systemAr: '',
});

/** BPMN of S.01.04 Invoice processing with lanes and the step attributes the simulation uses. */
function invoiceXml(): string {
  const s: ProcessStructure = {
    nameEn: 'Invoice processing',
    nameAr: 'معالجة الفواتير',
    descriptionEn: '',
    descriptionAr: '',
    explanation: '',
    lanes: [
      { id: 'Lane_AP', nameEn: 'Accounts payable clerk', nameAr: 'موظف الحسابات الدائنة' },
      { id: 'Lane_FM', nameEn: 'Finance manager', nameAr: 'المدير المالي' },
      { id: 'Lane_TR', nameEn: 'Treasury', nameAr: 'الخزينة' },
    ],
    nodes: [
      node('Start_Invoice', 'startEvent', 'Invoice received', 'استلام الفاتورة', 'Lane_AP'),
      node('Task_Register', 'userTask', INVOICE_STEPS.register, 'تسجيل الفاتورة', 'Lane_AP'),
      node('Task_Match', 'userTask', INVOICE_STEPS.match, 'مطابقة أمر الشراء', 'Lane_AP'),
      node('Gw_Matched', 'exclusiveGateway', 'Matched?', 'مطابقة؟', 'Lane_AP'),
      node('Task_Clarify', 'userTask', INVOICE_STEPS.clarify, 'الاستيضاح من المورد', 'Lane_AP'),
      node('Task_Approve', 'userTask', INVOICE_STEPS.approve, 'اعتماد الفاتورة', 'Lane_FM'),
      node('Task_Schedule', 'userTask', INVOICE_STEPS.schedule, 'جدولة الدفع', 'Lane_TR'),
      node('Task_Pay', 'serviceTask', INVOICE_STEPS.pay, 'الدفع للمورد', 'Lane_TR'),
      node('End_Paid', 'endEvent', 'Invoice paid', 'تم دفع الفاتورة', 'Lane_TR'),
    ],
    flows: [
      { from: 'Start_Invoice', to: 'Task_Register', nameEn: '', nameAr: '' },
      { from: 'Task_Register', to: 'Task_Match', nameEn: '', nameAr: '' },
      { from: 'Task_Match', to: 'Gw_Matched', nameEn: '', nameAr: '' },
      { from: 'Gw_Matched', to: 'Task_Approve', nameEn: 'Yes', nameAr: 'نعم' },
      { from: 'Gw_Matched', to: 'Task_Clarify', nameEn: 'No', nameAr: 'لا' },
      { from: 'Task_Clarify', to: 'Task_Match', nameEn: '', nameAr: '' },
      { from: 'Task_Approve', to: 'Task_Schedule', nameEn: '', nameAr: '' },
      { from: 'Task_Schedule', to: 'Task_Pay', nameEn: '', nameAr: '' },
      { from: 'Task_Pay', to: 'End_Paid', nameEn: '', nameAr: '' },
    ],
  };
  let xml = structureToBpmn(s, { key: 'invoice', theme: DEFAULT_DIAGRAM_THEME });
  const attrs: Record<string, Record<string, string>> = {
    Task_Register: {
      durationMinutes: '15',
      waitingMinutes: '20',
      frequencyPerMonth: '830',
      costPerExecution: '12',
    },
    Task_Match: { durationMinutes: '20', waitingMinutes: '30', costPerExecution: '15' },
    Task_Clarify: { durationMinutes: '45', costPerExecution: '30' },
    Task_Approve: { durationMinutes: '10', slaMinutes: '480', costPerExecution: '20' },
    Task_Schedule: { durationMinutes: '10', costPerExecution: '8' },
    Task_Pay: { durationMinutes: '5', costPerExecution: '3' },
  };
  for (const [id, a] of Object.entries(attrs)) xml = setPhAttributes(xml, id, a);
  return xml;
}

/**
 * Process mining and simulation demo (Phase 5.1, demo installations only, once): process S.01.04
 * Invoice processing, a generated event log of ~5,000 cases (two main variants, rework, the finance
 * manager as the bottleneck, some deviations) with mapped activities, a KPI calculated from the log
 * and a simulation with an as-is and two to-be scenarios (results computed here).
 */
export async function seedMiningDemo(prisma: PrismaClient, adminId: string | null): Promise<void> {
  if ((await prisma.eventLog.count()) > 0) return;
  const s01 = await prisma.process.findFirst({ where: { code: 'S.01', deletedAt: null } });
  if (!s01) return;
  const user = (email: string) =>
    prisma.user.findFirst({ where: { email }, select: { id: true, departmentId: true } });
  const [analyst, owner] = await Promise.all([
    user('performance@processhub.local'),
    user('owner@processhub.local'),
  ]);
  const ownerId = owner?.id ?? adminId;

  // Process with model and a first version.
  let proc = await prisma.process.findFirst({ where: { code: 'S.01.04', deletedAt: null } });
  const xml = invoiceXml();
  if (!proc) {
    proc = await prisma.process.create({
      data: {
        code: 'S.01.04',
        nameEn: 'Invoice processing',
        nameAr: 'معالجة الفواتير',
        descriptionEn: 'Registers, matches, approves and pays supplier invoices.',
        descriptionAr: 'تسجيل فواتير الموردين ومطابقتها واعتمادها ودفعها.',
        category: s01.category,
        parentId: s01.id,
        level: s01.level + 1,
        sortOrder: 4,
        ownerId,
        departmentId: s01.departmentId,
        createdById: adminId,
        updatedById: adminId,
      },
    });
    await prisma.processModel.create({
      data: { processId: proc.id, bpmnXml: xml, createdById: adminId, updatedById: adminId },
    });
    await prisma.processVersion.create({
      data: {
        processId: proc.id,
        versionNumber: 1,
        bpmnXml: xml,
        changeNote: 'Initial version',
        createdById: adminId,
      },
    });
  }

  // Event log: events, activities (mapped), counts; the snapshot is built on first use.
  const events = generateInvoiceLog(5000, 2026);
  const data = buildLogData(events, ['amount', 'channel']);
  const summary = summariseLog(data);
  const log = await prisma.eventLog.create({
    data: {
      code: 'LOG-001',
      nameEn: 'Invoice processing — ERP export Apr–Sep 2026',
      nameAr: 'معالجة الفواتير — تصدير نظام ERP أبريل–سبتمبر 2026',
      descriptionEn: 'Demo event log (generated): ~5,000 invoices with start and end times.',
      descriptionAr: 'سجل أحداث تجريبي (مولَّد): نحو 5,000 فاتورة بأوقات بداية ونهاية.',
      source: 'FILE',
      status: 'READY',
      processId: proc.id,
      ownerId: analyst?.id ?? adminId,
      departmentId: analyst?.departmentId ?? s01.departmentId,
      fileName: 'invoice-processing-erp-export.csv',
      fileFormat: 'CSV',
      mapping: {
        caseColumn: 'case_id',
        activityColumn: 'activity',
        startColumn: 'start_time',
        endColumn: 'end_time',
        resourceColumn: 'resource',
        departmentColumn: 'department',
        attributeColumns: ['amount', 'channel'],
        timestampFormat: 'iso',
        timeZone: 'Asia/Dubai',
        delimiter: ',',
        sheet: null,
        pseudonymise: false,
        dropDuplicates: true,
      },
      dataVersion: 1,
      periodStart: new Date(summary.periodStart!),
      periodEnd: new Date(summary.periodEnd!),
      caseCount: summary.cases,
      eventCount: summary.events,
      activityCount: summary.activities.length,
      resourceCount: summary.resources,
      hasStartTimes: true,
      attributeNames: ['amount', 'channel'],
      importedAt: new Date(),
      createdById: analyst?.id ?? adminId,
      updatedById: analyst?.id ?? adminId,
    },
  });
  for (let i = 0; i < events.length; i += 5000)
    await prisma.miningEvent.createMany({
      data: events.slice(i, i + 5000).map((e) => ({
        logId: log.id,
        caseId: e.caseId,
        activity: e.activity,
        startAt: e.start === null ? null : new Date(e.start),
        endAt: new Date(e.end),
        resource: e.resource ?? null,
        department: e.department ?? null,
        attributes: e.attrs as Prisma.InputJsonValue,
      })),
    });
  const graph = parseBpmnGraph(xml);
  const matches = autoMatchActivities(
    summary.activities.map((a) => a.name),
    graph.nodes.map((n) => ({ id: n.id, nameEn: n.nameEn, nameAr: n.nameAr })),
  );
  await prisma.miningActivity.createMany({
    data: summary.activities.map((a) => ({
      logId: log.id,
      name: a.name,
      eventCount: a.events,
      caseCount: a.cases,
      bpmnElementId: matches.get(a.name)?.elementId ?? null,
      match: matches.get(a.name)?.match ?? null,
    })),
  });

  // KPI calculated from the log: mean cycle time per month.
  const kpiObj = await prisma.repoObject.create({
    data: {
      type: 'KPI',
      code: 'KPI-M01',
      nameEn: 'Invoice cycle time',
      nameAr: 'مدة دورة الفاتورة',
      descriptionEn:
        'Mean time from invoice registration to payment (hours), from the ERP event log.',
      descriptionAr: 'متوسط الوقت من تسجيل الفاتورة إلى الدفع (ساعات)، من سجل أحداث نظام ERP.',
      ownerId,
      createdById: adminId,
      kpi: {
        create: {
          unit: 'h',
          direction: 'LOWER_IS_BETTER',
          frequency: 'MONTHLY',
          target: 48,
          greenThreshold: 48,
          redThreshold: 96,
          dataSource: 'EVENT_LOG',
          calculatedMetric: 'MINING_THROUGHPUT_HOURS',
          miningLogId: log.id,
        },
      },
    },
  });
  await prisma.objectLink.create({
    data: {
      processId: proc.id,
      bpmnElementId: '#process',
      repoObjectId: kpiObj.id,
      relation: 'MEASURES',
      createdById: adminId,
    },
  });
  const series = miningKpiSeries(data, 'MINING_THROUGHPUT_HOURS', 'MONTHLY');
  for (const [period, v] of Object.entries(series)) {
    if (periodStart(shiftPeriod(period, 'MONTHLY', 1)).getTime() > Date.now()) continue;
    await prisma.kpiMeasurement.create({
      data: {
        kpiId: kpiObj.id,
        period,
        periodStart: periodStart(period),
        value: v.value,
        comment: `LOG-001: ${v.cases}`,
        source: 'EVENT_LOG',
      },
    });
  }

  // Simulation: as-is (one finance manager) and two to-be scenarios, run here.
  const base = scenarioParamsSchema.parse({
    arrival: { unit: 'model' },
    startDate: '2026-10-04',
    days: 90,
    warmupDays: 10,
    calendar: { useCentralHolidays: true },
    resources: {
      Lane_AP: { capacity: 6, costPerHour: 60 },
      Lane_FM: { capacity: 1, costPerHour: 150 },
      Lane_TR: { capacity: 2, costPerHour: 80 },
    },
    steps: {
      Task_Approve: { duration: { type: 'triangular', min: 5, mode: 8, max: 20 } },
      Task_Clarify: { duration: { type: 'exponential', mean: 45 } },
    },
    probabilities: {},
    slaHours: 48,
  });
  // Branch probabilities from the log: ~25 % of matches lead to a clarification.
  const gwFlows = graph.flows.filter((f) => f.from === 'Gw_Matched');
  for (const f of gwFlows) base.probabilities[f.id] = f.to === 'Task_Clarify' ? 25 : 75;
  const scenarios: {
    nameEn: string;
    nameAr: string;
    kind: 'AS_IS' | 'TO_BE';
    params: typeof base;
  }[] = [
    { nameEn: 'As-is', nameAr: 'الوضع الحالي', kind: 'AS_IS', params: base },
    {
      nameEn: 'Second finance approver',
      nameAr: 'معتمد مالي ثانٍ',
      kind: 'TO_BE',
      params: {
        ...base,
        resources: { ...base.resources, Lane_FM: { capacity: 2, costPerHour: 150 } },
      },
    },
    {
      nameEn: 'Automatic PO matching',
      nameAr: 'مطابقة آلية لأوامر الشراء',
      kind: 'TO_BE',
      params: {
        ...base,
        steps: { ...base.steps, Task_Match: { duration: { type: 'fixed', mean: 2 }, cost: 1 } },
        probabilities: Object.fromEntries(
          gwFlows.map((f) => [f.id, f.to === 'Task_Clarify' ? 10 : 90]),
        ),
      },
    },
  ];
  const sim = await prisma.simulation.create({
    data: {
      code: 'SIM-001',
      nameEn: 'Invoice processing — staffing and automation',
      nameAr: 'معالجة الفواتير — الكوادر والأتمتة',
      processId: proc.id,
      logId: log.id,
      ownerId: analyst?.id ?? adminId,
      createdById: analyst?.id ?? adminId,
    },
  });
  const crypto = await import('node:crypto');
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
  for (const [i, sc] of scenarios.entries()) {
    const params = scenarioParamsSchema.parse(sc.params);
    // The central holiday list (D-143) applies; its default is the UAE list.
    const resolved = resolveHolidays(params, DEFAULT_UAE_HOLIDAYS);
    const result = simulate(graph, resolved);
    await prisma.simulationScenario.create({
      data: {
        simulationId: sim.id,
        nameEn: sc.nameEn,
        nameAr: sc.nameAr,
        kind: sc.kind,
        sortOrder: i,
        params: params as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        resultModel: `working:${hash(xml)}|${hash(stableJson(resolved))}`,
        ranAt: new Date(),
      },
    });
  }
  console.log(
    `Seeded process mining demo: ${summary.cases} cases / ${summary.events} events, KPI-M01, SIM-001 (3 scenarios).`,
  );
}
