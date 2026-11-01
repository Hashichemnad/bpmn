/**
 * Volume seed (final session, part A): a production-size repository for performance measurements.
 *
 *   500 users · ~2,000 processes (diagrams up to 200 elements, several versions, 60 % published) ·
 *   ~5,000 wiki pages · 1,000 risks / 1,500 controls with three years of test history · 300 applications ·
 *   200 KPIs with three years of monthly values · a 1M-event mining log · ~10,000 workflow requests with
 *   tasks · 50 import batches · reviews, notifications and a large audit log.
 *
 * NEVER run it against real data. It refuses NODE_ENV=production, needs VOLUME_SEED=yes and an
 * installation without earlier volume data (it adds to whatever demo data is there).
 *
 *   createdb processhub_volume
 *   DATABASE_URL=postgresql://…/processhub_volume npx prisma migrate deploy
 *   DATABASE_URL=… SEED_DEMO_DATA=true npx ts-node --transpile-only prisma/seed.ts      # optional
 *   DATABASE_URL=… JWT_ACCESS_SECRET=… VOLUME_SEED=yes WORKFLOW_POLL_SECONDS=0 SCHEDULER_INTERVAL_MINUTES=0 \
 *     npx ts-node --transpile-only prisma/seed-volume.ts [--scale=1] [--skip=mining,workflow]
 *
 * `--scale=0.01` gives a small repository with every kind of data (used by the API test that keeps
 * this script working when the schema changes). Measurements: `prisma/perf-api.ts`, docs/PROGRESS.md.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma, type ProcessCategory } from '@prisma/client';
import {
  SYSTEM_ROLES,
  readWorkflowModel,
  type Permission,
  type SystemRoleKey,
} from '@processhub/shared';
import { hashPassword } from '../src/auth/argon';
import type { AuthUser } from '../src/common/auth-user';
import { buildBpmn, type DiagramFlow, type DiagramNode, type NodeType } from './bpmn-builder';
import { generateInvoiceLog } from './demo-event-log';
import { syncRolesAndPermissions } from './seed';
import { leaveRequestXml } from './workflow-demo';

/** Password of every volume user (`user<n>@volume.local`); never used outside test databases. */
export const VOLUME_PASSWORD = 'Volume-Test-2026!';
export const VOLUME_MARKER = 'volume.seed';

type Db = PrismaClient;
const DAY = 86_400_000;

export interface VolumeOptions {
  scale: number;
  skip: Set<string>;
  /** Builds an application context for the workflow requests (run through the real services). */
  appContext?: () => Promise<{
    get<T>(type: new (...args: never[]) => T): T;
    close(): Promise<void>;
  }>;
  log?: (msg: string) => void;
}

// ---------- deterministic pseudo-random data ----------

let seed = 20261101;
function rnd(): number {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const VERBS = [
  ['Receive', 'استلام'],
  ['Review', 'مراجعة'],
  ['Approve', 'اعتماد'],
  ['Register', 'تسجيل'],
  ['Verify', 'التحقق من'],
  ['Prepare', 'إعداد'],
  ['Send', 'إرسال'],
  ['Archive', 'أرشفة'],
  ['Assess', 'تقييم'],
  ['Calculate', 'احتساب'],
  ['Notify', 'إشعار'],
  ['Close', 'إغلاق'],
] as const;
const NOUNS = [
  ['request', 'الطلب'],
  ['invoice', 'الفاتورة'],
  ['contract', 'العقد'],
  ['application', 'الطلب المقدم'],
  ['report', 'التقرير'],
  ['budget', 'الميزانية'],
  ['purchase order', 'أمر الشراء'],
  ['permit', 'التصريح'],
  ['complaint', 'الشكوى'],
  ['payment', 'الدفعة'],
  ['employee file', 'ملف الموظف'],
  ['licence', 'الرخصة'],
  ['asset', 'الأصل'],
  ['vendor', 'المورد'],
] as const;
const AREAS = [
  ['Finance', 'المالية'],
  ['Human Resources', 'الموارد البشرية'],
  ['Procurement', 'المشتريات'],
  ['Legal Affairs', 'الشؤون القانونية'],
  ['Information Technology', 'تقنية المعلومات'],
  ['Customer Service', 'خدمة المتعاملين'],
  ['Strategy', 'الاستراتيجية'],
  ['Internal Audit', 'التدقيق الداخلي'],
  ['Facilities', 'المرافق'],
  ['Communications', 'الاتصال'],
] as const;
const SENTENCE_EN =
  'The responsible team checks the submitted information against the policy, records the decision in the system and informs the requester within the agreed service level.';
const SENTENCE_AR =
  'يتحقق الفريق المسؤول من المعلومات المقدمة وفق السياسة، ويسجل القرار في النظام، ويبلغ مقدم الطلب ضمن مستوى الخدمة المتفق عليه.';

const phrase = () => {
  const v = pick(VERBS);
  const n = pick(NOUNS);
  return { en: `${v[0]} ${n[0]}`, ar: `${v[1]} ${n[1]}` };
};

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// ---------- diagrams ----------

/** A left-to-right diagram with `size` elements: tasks, exclusive splits / joins, wrapped into rows. */
export function volumeDiagram(key: string, size: number) {
  const nodes: DiagramNode[] = [];
  const flows: DiagramFlow[] = [];
  let col = 0;
  let row = 0;
  const COLS = 14;
  const place = (type: NodeType, label: { en: string; ar: string } | null, dy = 0) => {
    if (col >= COLS) {
      col = 0;
      row++;
    }
    const n: DiagramNode = {
      id: `${type === 'exclusiveGateway' ? 'Gateway' : type === 'userTask' ? 'Task' : 'Event'}_${nodes.length + 1}`,
      type,
      en: label?.en ?? '',
      ar: label?.ar ?? '',
      x: 120 + col * 150 + (type === 'exclusiveGateway' ? 25 : type.endsWith('Event') ? 32 : 0),
      y:
        100 + row * 320 + dy + (type === 'exclusiveGateway' ? 15 : type.endsWith('Event') ? 22 : 0),
      ...(type === 'userTask' && chance(0.3) ? { descEn: SENTENCE_EN, descAr: SENTENCE_AR } : {}),
    };
    nodes.push(n);
    return n;
  };
  const link = (a: DiagramNode, b: DiagramNode, label?: { en: string; ar: string }) =>
    flows.push({
      id: `Flow_${flows.length + 1}`,
      from: a.id,
      to: b.id,
      en: label?.en,
      ar: label?.ar,
    });

  let prev = place('startEvent', { en: 'Start', ar: 'البداية' });
  col++;
  while (nodes.length < size - 1) {
    if (nodes.length + 5 < size - 1 && chance(0.18) && col < COLS - 3) {
      const split = place('exclusiveGateway', { en: 'Approved?', ar: 'معتمد؟' });
      link(prev, split);
      col++;
      const yes = place('userTask', phrase());
      const no = place('userTask', phrase(), 130);
      link(split, yes, { en: 'Yes', ar: 'نعم' });
      link(split, no, { en: 'No', ar: 'لا' });
      col++;
      const join = place('exclusiveGateway', null);
      link(yes, join);
      link(no, join);
      col++;
      prev = join;
    } else {
      const t = place('userTask', phrase());
      link(prev, t);
      col++;
      prev = t;
    }
  }
  const end = place('endEvent', { en: 'End', ar: 'النهاية' });
  link(prev, end);
  return {
    xml: buildBpmn(key, nodes, flows),
    taskIds: nodes.filter((n) => n.type === 'userTask').map((n) => n.id),
    labels: nodes.filter((n) => n.en).map((n) => ({ en: n.en, ar: n.ar })),
  };
}

const pageHtml = (title: string, n: number) =>
  `<h2>${title}</h2>` +
  Array.from(
    { length: n },
    (_, i) =>
      `<p>${SENTENCE_EN} Step ${i + 1} applies to every request of this kind.</p>` +
      (i % 3 === 0 ? `<ul><li>${SENTENCE_EN}</li><li>${SENTENCE_EN}</li></ul>` : ''),
  ).join('');
const pageHtmlAr = (title: string, n: number) =>
  `<h2>${title}</h2>` + Array.from({ length: n }, () => `<p>${SENTENCE_AR}</p>`).join('');
const htmlText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------- main ----------

export async function seedVolume(prisma: Db, opts: VolumeOptions): Promise<Record<string, number>> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const S = (n: number, min = 1) => Math.max(min, Math.round(n * opts.scale));
  const t0 = Date.now();
  const step = (label: string) => log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${label}`);
  if (await prisma.setting.findUnique({ where: { key: VOLUME_MARKER } })) {
    throw new Error('This database already holds volume data');
  }
  await syncRolesAndPermissions(prisma);
  const counts: Record<string, number> = {};
  const now = Date.now();
  const roleRows = await prisma.role.findMany();
  const roleId = (k: SystemRoleKey) => roleRows.find((r) => r.key === k)!.id;

  // ----- departments and users -----
  step('departments and users');
  const departments = AREAS.map(([en, ar], i) => ({
    id: randomUUID(),
    code: `VOL-${i + 1}`,
    nameEn: `${en} (volume)`,
    nameAr: `${ar} (حجم)`,
  }));
  const subDepartments = departments.flatMap((d, i) =>
    [1, 2].map((j) => ({
      id: randomUUID(),
      code: `VOL-${i + 1}.${j}`,
      nameEn: `${d.nameEn} — unit ${j}`,
      nameAr: `${d.nameAr} — وحدة ${j}`,
      parentId: d.id,
    })),
  );
  await prisma.department.createMany({ data: [...departments, ...subDepartments] });
  const allDeps = [...departments, ...subDepartments];
  const passwordHash = await hashPassword(VOLUME_PASSWORD);
  const userCount = S(500, 20);
  const roleMix: [SystemRoleKey, number][] = [
    ['ADMIN', 0.01],
    ['PROCESS_OWNER', 0.12],
    ['MODELER', 0.16],
    ['REVIEWER', 0.06],
    ['RISK_OFFICER', 0.02],
    ['INTERNAL_AUDIT', 0.01],
    ['ENTERPRISE_ARCHITECT', 0.01],
    ['PERFORMANCE_OFFICER', 0.01],
    ['AUDITOR', 0.01],
  ];
  const users = Array.from({ length: userCount }, (_, i) => {
    let acc = 0;
    const r = i / userCount;
    let role: SystemRoleKey = 'VIEWER';
    for (const [k, share] of roleMix) {
      acc += share;
      if (r < acc) {
        role = k;
        break;
      }
    }
    if (i === 0) role = 'SUPER_ADMIN';
    return {
      id: randomUUID(),
      email: `user${i}@volume.local`,
      nameEn: `Volume User ${i}`,
      nameAr: `مستخدم ${i}`,
      passwordHash,
      locale: i % 3 === 0 ? 'ar' : 'en',
      departmentId: allDeps[i % allDeps.length].id,
      lastLoginAt: new Date(now - int(0, 30) * DAY),
      role,
    };
  });
  await chunked(users, 1000, (part) =>
    prisma.user.createMany({ data: part.map(({ role: _r, ...u }) => u) }),
  );
  await prisma.userRole.createMany({
    data: users.map((u) => ({ userId: u.id, roleId: roleId(u.role) })),
  });
  for (const [i, d] of allDeps.entries()) {
    await prisma.department.update({
      where: { id: d.id },
      data: { managerId: users[1 + (i % Math.max(1, Math.floor(users.length / 10)))].id },
    });
  }
  const byRole = (k: SystemRoleKey) => users.filter((u) => u.role === k);
  const owners = byRole('PROCESS_OWNER');
  const reviewers = [...byRole('REVIEWER'), ...owners.slice(0, 5)];
  const admin = users[0];
  counts.users = users.length;

  // ----- library: roles, systems / applications -----
  step('library roles and applications');
  const jobRoles = Array.from({ length: S(150, 5) }, (_, i) => ({
    id: randomUUID(),
    type: 'ROLE' as const,
    code: `ROL-V${i + 1}`,
    nameEn: `${pick(AREAS)[0]} officer ${i + 1}`,
    nameAr: `موظف ${pick(AREAS)[1]} ${i + 1}`,
    createdById: admin.id,
  }));
  const apps = Array.from({ length: S(300, 5) }, (_, i) => ({
    id: randomUUID(),
    type: 'SYSTEM' as const,
    code: `APP-V${String(i + 1).padStart(3, '0')}`,
    nameEn: `Application ${i + 1}`,
    nameAr: `تطبيق ${i + 1}`,
    descriptionEn: SENTENCE_EN,
    descriptionAr: SENTENCE_AR,
    createdById: admin.id,
  }));
  await prisma.repoObject.createMany({ data: [...jobRoles, ...apps] });
  await prisma.application.createMany({
    data: apps.map((a, i) => ({
      objectId: a.id,
      appType: pick(['APPLICATION', 'PLATFORM', 'SERVICE', 'DATABASE', 'EXTERNAL'] as const),
      vendor: pick(['Oracle', 'Microsoft', 'SAP', 'In-house', 'Salesforce']),
      version: `${int(1, 12)}.${int(0, 9)}`,
      businessOwnerId: pick(owners).id,
      itOwnerId: users[(i * 13) % users.length].id,
      departmentId: pick(allDeps).id,
      hosting: pick(['ON_PREMISE', 'CLOUD', 'SAAS'] as const),
      hostingCountry: pick(['AE', 'AE', 'IE', 'DE']),
      lifecycle: pick(['PLANNED', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'PHASING_OUT', 'RETIRED'] as const),
      criticality: pick(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const),
      dataClassification: pick(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET'] as const),
    })),
  });
  await prisma.userJobRole.createMany({
    data: users.map((u, i) => ({ userId: u.id, repoObjectId: jobRoles[i % jobRoles.length].id })),
    skipDuplicates: true,
  });
  counts.applications = apps.length;

  // ----- governance workflow -----
  const reviewSteps = [
    {
      nameEn: 'Owner review',
      nameAr: 'مراجعة المالك',
      rule: 'ANY',
      assignees: [{ type: 'OWNER' }],
    },
  ];
  const workflow = await prisma.workflow.create({
    data: {
      nameEn: 'Volume review',
      nameAr: 'مراجعة الحجم',
      steps: reviewSteps as unknown as Prisma.InputJsonValue,
      createdById: admin.id,
    },
  });

  // ----- process house -----
  step('processes, diagrams and versions');
  const processCount = S(2000, 30);
  const categories: ProcessCategory[] = ['MANAGEMENT', 'CORE', 'SUPPORT'];
  type P = Prisma.ProcessCreateManyInput & { id: string; level: number };
  const processes: P[] = [];
  const l1 = Math.max(3, Math.round(processCount / 130));
  const l2PerL1 = 10;
  for (let a = 0; a < l1; a++) {
    const cat = categories[a % 3];
    const letter = cat[0];
    const area = AREAS[a % AREAS.length];
    const p1: P = {
      id: randomUUID(),
      code: `${letter}.V${String(a + 1).padStart(2, '0')}`,
      nameEn: `${area[0]} management ${a + 1}`,
      nameAr: `إدارة ${area[1]} ${a + 1}`,
      category: cat,
      level: 1,
      sortOrder: a,
      ownerId: pick(owners).id,
      departmentId: allDeps[a % allDeps.length].id,
      workflowId: workflow.id,
      createdById: admin.id,
    };
    processes.push(p1);
    for (let b = 0; b < l2PerL1 && processes.length < processCount; b++) {
      const p2: P = {
        ...p1,
        id: randomUUID(),
        code: `${p1.code}.${String(b + 1).padStart(2, '0')}`,
        nameEn: `${p1.nameEn} — ${phrase().en}`,
        nameAr: `${p1.nameAr} — ${phrase().ar}`,
        parentId: p1.id,
        level: 2,
        sortOrder: b,
      };
      processes.push(p2);
    }
  }
  const level2 = processes.filter((p) => p.level === 2);
  for (let i = 0; processes.length < processCount; i++) {
    const parent = level2[i % level2.length];
    const ph = phrase();
    processes.push({
      ...parent,
      id: randomUUID(),
      code: `${parent.code}.${String(Math.floor(i / level2.length) + 1).padStart(2, '0')}`,
      nameEn: ph.en,
      nameAr: ph.ar,
      descriptionEn: SENTENCE_EN,
      descriptionAr: SENTENCE_AR,
      parentId: parent.id,
      level: 3,
      sortOrder: Math.floor(i / level2.length),
      ownerId: pick(owners).id,
    });
  }
  for (const p of processes) {
    p.status =
      p.level < 3
        ? 'PUBLISHED'
        : pick(['PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'DRAFT', 'IN_REVIEW', 'APPROVED'] as const);
    p.nextReviewAt = new Date(now + int(-60, 365) * DAY);
  }
  // Parents first (Restrict foreign key), in batches.
  for (const level of [1, 2, 3]) {
    await chunked(
      processes.filter((p) => p.level === level),
      1000,
      (part) => prisma.process.createMany({ data: part }),
    );
  }
  counts.processes = processes.length;

  // Diagrams with 10 – 200 elements (5 % over 150), 1 – 5 versions each; links to roles / systems.
  const published: { id: string; version: number; diagram: ReturnType<typeof volumeDiagram> }[] =
    [];
  let versionRows = 0;
  let linkRows = 0;
  const diagramProcesses = processes.filter((p) => p.level === 3 || chance(0.3));
  for (let i = 0; i < diagramProcesses.length; i += 50) {
    const part = diagramProcesses.slice(i, i + 50);
    const models: Prisma.ProcessModelCreateManyInput[] = [];
    const versions: Prisma.ProcessVersionCreateManyInput[] = [];
    const links: Prisma.ObjectLinkCreateManyInput[] = [];
    for (const p of part) {
      const size = chance(0.05) ? int(150, 200) : int(10, 80);
      const d = volumeDiagram(p.code.replace(/\./g, '_'), size);
      const nVersions = int(1, 5);
      models.push({
        processId: p.id,
        bpmnXml: d.xml,
        createdById: p.ownerId,
        updatedById: p.ownerId,
      });
      for (let v = 1; v <= nVersions; v++) {
        versions.push({
          processId: p.id,
          versionNumber: v,
          bpmnXml: d.xml,
          changeNote: v === 1 ? 'First version' : `Change ${v}`,
          createdAt: new Date(now - (nVersions - v + 1) * 40 * DAY),
          createdById: p.ownerId,
        });
      }
      for (const taskId of d.taskIds) {
        if (chance(0.6))
          links.push({
            processId: p.id,
            bpmnElementId: taskId,
            repoObjectId: pick(jobRoles).id,
            relation: 'PERFORMS',
          });
        if (chance(0.25))
          links.push({
            processId: p.id,
            bpmnElementId: taskId,
            repoObjectId: pick(apps).id,
            relation: 'SUPPORTS',
          });
      }
      if (p.status === 'PUBLISHED') published.push({ id: p.id, version: nVersions, diagram: d });
    }
    await prisma.processModel.createMany({ data: models });
    await prisma.processVersion.createMany({ data: versions });
    await prisma.objectLink.createMany({ data: links, skipDuplicates: true });
    versionRows += versions.length;
    linkRows += links.length;
  }
  counts.processVersions = versionRows;
  counts.objectLinks = linkRows;

  // Publications (current + one earlier) for the portal; reviews (approved history + open ones).
  step('publications and reviews');
  const procById = new Map(processes.map((p) => [p.id, p]));
  const pubRows: Prisma.PublicationCreateManyInput[] = [];
  const withDiagram = new Set(published.map((p) => p.id));
  for (const p of processes.filter(
    (x) => x.status === 'PUBLISHED' && x.level < 3 && !withDiagram.has(x.id),
  )) {
    pubRows.push({
      entityType: 'PROCESS',
      entityId: p.id,
      versionNumber: 1,
      code: p.code,
      titleEn: p.nameEn,
      titleAr: p.nameAr,
      approverIds: [p.ownerId!],
      publishedById: p.ownerId,
      publishedAt: new Date(now - 100 * DAY),
    });
  }
  for (const pub of published) {
    const p = procById.get(pub.id)!;
    const common = {
      entityType: 'PROCESS' as const,
      entityId: p.id,
      code: p.code,
      titleEn: p.nameEn,
      titleAr: p.nameAr,
      descriptionEn: p.descriptionEn ?? '',
      descriptionAr: p.descriptionAr ?? '',
      textEn: pub.diagram.labels.map((l) => l.en).join('\n'),
      textAr: pub.diagram.labels.map((l) => l.ar).join('\n'),
      approverIds: [p.ownerId!],
      publishedById: p.ownerId,
    };
    if (pub.version > 1)
      pubRows.push({
        ...common,
        versionNumber: pub.version - 1,
        current: false,
        publishedAt: new Date(now - 90 * DAY),
        endedAt: new Date(now - 40 * DAY),
      });
    pubRows.push({ ...common, versionNumber: pub.version, publishedAt: new Date(now - 40 * DAY) });
  }
  await chunked(pubRows, 500, (part) => prisma.publication.createMany({ data: part }));
  // Published step links (portal "who / which system").
  await prisma.$executeRaw`
    INSERT INTO "PublishedLink" ("id", "publicationId", "bpmnElementId", "repoObjectId", "relation")
    SELECT gen_random_uuid(), pub."id", l."bpmnElementId", l."repoObjectId", l."relation"
    FROM "Publication" pub JOIN "ObjectLink" l ON l."processId" = pub."entityId"
    WHERE pub."current" = true AND pub."entityType" = 'PROCESS'
      AND pub."entityId" = ANY(${published.map((p) => p.id)}::uuid[])`;
  counts.publications = pubRows.length;

  const openReviews = processes.filter((p) => p.status === 'IN_REVIEW');
  const reviewRows: Prisma.ReviewCreateManyInput[] = [];
  const taskRows: Prisma.ReviewTaskCreateManyInput[] = [];
  const snapshot = (assigneeIds: string[]) =>
    [
      {
        nameEn: 'Owner review',
        nameAr: 'مراجعة المالك',
        rule: 'ANY',
        assigneeIds,
        approvedBySubmitter: false,
      },
    ] as unknown as Prisma.InputJsonValue;
  for (const p of [...openReviews, ...published.slice(0, S(800)).map((x) => procById.get(x.id)!)]) {
    const id = randomUUID();
    const open = p.status === 'IN_REVIEW';
    const assignee = open ? pick(reviewers).id : p.ownerId!;
    reviewRows.push({
      id,
      entityType: 'PROCESS',
      entityId: p.id,
      versionNumber: 1,
      status: open ? 'IN_PROGRESS' : 'APPROVED',
      workflowId: workflow.id,
      workflowNameEn: workflow.nameEn,
      workflowNameAr: workflow.nameAr,
      steps: snapshot([assignee]),
      submittedById: pick(byRole('MODELER').length ? byRole('MODELER') : owners).id,
      submittedAt: new Date(now - int(1, 60) * DAY),
      dueAt: new Date(now + int(-10, 20) * DAY),
      completedAt: open ? null : new Date(now - 41 * DAY),
    });
    taskRows.push({
      reviewId: id,
      stepIndex: 0,
      assigneeId: assignee,
      status: open ? 'PENDING' : 'APPROVED',
      decidedAt: open ? null : new Date(now - 41 * DAY),
    });
  }
  await chunked(reviewRows, 1000, (part) => prisma.review.createMany({ data: part }));
  await chunked(taskRows, 1000, (part) => prisma.reviewTask.createMany({ data: part }));
  counts.reviews = reviewRows.length;

  // ----- wiki -----
  step('wiki spaces and pages');
  const spaces = Array.from({ length: S(40, 2) }, (_, i) => ({
    id: randomUUID(),
    key: `VOL${i + 1}`,
    nameEn: `${AREAS[i % AREAS.length][0]} handbook ${i + 1}`,
    nameAr: `دليل ${AREAS[i % AREAS.length][1]} ${i + 1}`,
    ownerId: pick(owners).id,
    departmentId: allDeps[i % allDeps.length].id,
    workflowId: workflow.id,
    createdById: admin.id,
  }));
  await prisma.space.createMany({ data: spaces });
  const pageCount = S(5000, 20);
  type Pg = Prisma.PageCreateManyInput & { id: string; depth: number };
  const pages: Pg[] = [];
  for (let i = 0; i < pageCount; i++) {
    const space = spaces[i % spaces.length];
    const siblings = pages.filter((x) => x.spaceId === space.id && x.depth < 2);
    const parent = siblings.length > 3 && chance(0.8) ? pick(siblings.slice(-30)) : null;
    const ph = phrase();
    const titleEn = `SOP: ${ph.en} ${i + 1}`;
    const titleAr = `إجراء: ${ph.ar} ${i + 1}`;
    const contentEn = pageHtml(titleEn, int(4, 25));
    const contentAr = pageHtmlAr(titleAr, int(3, 12));
    pages.push({
      id: randomUUID(),
      depth: parent ? parent.depth + 1 : 0,
      spaceId: space.id,
      parentId: parent?.id ?? null,
      sortOrder: i,
      titleEn,
      titleAr,
      contentEn,
      contentAr,
      textEn: htmlText(contentEn),
      textAr: htmlText(contentAr),
      version: int(1, 3),
      status: pick(['PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'DRAFT', 'IN_REVIEW'] as const),
      ownerId: space.ownerId,
      createdById: space.ownerId,
      nextReviewAt: new Date(now + int(-30, 365) * DAY),
    });
  }
  for (const depth of [0, 1, 2]) {
    await chunked(
      pages.filter((p) => p.depth === depth),
      500,
      (part) => prisma.page.createMany({ data: part.map(({ depth: _d, ...p }) => p) }),
    );
  }
  const pageVersions: Prisma.PageVersionCreateManyInput[] = [];
  const pagePubs: Prisma.PublicationCreateManyInput[] = [];
  for (const p of pages) {
    for (let v = 1; v <= (p.version ?? 1); v++) {
      pageVersions.push({
        pageId: p.id,
        versionNumber: v,
        titleEn: p.titleEn!,
        titleAr: p.titleAr!,
        contentEn: p.contentEn!,
        contentAr: p.contentAr!,
        dirEn: 'ltr',
        dirAr: 'rtl',
        changeNote: v === 1 ? 'Created' : `Update ${v}`,
        createdById: p.ownerId,
      });
    }
    if (p.status === 'PUBLISHED')
      pagePubs.push({
        entityType: 'PAGE',
        entityId: p.id,
        versionNumber: p.version ?? 1,
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        textEn: p.textEn,
        textAr: p.textAr,
        approverIds: [p.ownerId!],
        publishedById: p.ownerId,
        publishedAt: new Date(now - int(1, 300) * DAY),
      });
  }
  await chunked(pageVersions, 500, (part) => prisma.pageVersion.createMany({ data: part }));
  await chunked(pagePubs, 500, (part) => prisma.publication.createMany({ data: part }));
  // Every tenth page links to a process (portal "related documents").
  const pageLinks = pages
    .filter((_, i) => i % 10 === 0)
    .map((p) => ({ pageId: p.id, targetType: 'PROCESS' as const, processId: pick(processes).id }));
  await prisma.pageLink.createMany({ data: pageLinks, skipDuplicates: true });
  counts.pages = pages.length;
  counts.pageVersions = pageVersions.length;

  // ----- GRC -----
  step('risks, controls and test history');
  const riskOfficer = byRole('RISK_OFFICER')[0] ?? admin;
  const risks = Array.from({ length: S(1000, 10) }, (_, i) => ({
    id: randomUUID(),
    type: 'RISK' as const,
    code: `RSK-V${String(i + 1).padStart(4, '0')}`,
    nameEn: `Risk of incorrect ${pick(NOUNS)[0]} ${i + 1}`,
    nameAr: `خطر عدم صحة ${pick(NOUNS)[1]} ${i + 1}`,
    descriptionEn: SENTENCE_EN,
    descriptionAr: SENTENCE_AR,
    ownerId: pick(owners).id,
    createdById: riskOfficer.id,
  }));
  const controls = Array.from({ length: S(1500, 15) }, (_, i) => ({
    id: randomUUID(),
    type: 'CONTROL' as const,
    code: `CTL-V${String(i + 1).padStart(4, '0')}`,
    nameEn: `${pick(VERBS)[0]} ${pick(NOUNS)[0]} control ${i + 1}`,
    nameAr: `ضابط ${pick(VERBS)[1]} ${pick(NOUNS)[1]} ${i + 1}`,
    descriptionEn: SENTENCE_EN,
    descriptionAr: SENTENCE_AR,
    ownerId: pick(owners).id,
    createdById: riskOfficer.id,
  }));
  await chunked([...risks, ...controls], 1000, (part) =>
    prisma.repoObject.createMany({ data: part }),
  );
  await prisma.risk.createMany({
    data: risks.map((r) => ({
      objectId: r.id,
      category: pick(['OPERATIONAL', 'FINANCIAL', 'COMPLIANCE', 'STRATEGIC', 'IT']),
      departmentId: pick(allDeps).id,
      inherentLikelihood: int(1, 5),
      inherentImpact: int(1, 5),
      residualLikelihood: int(1, 4),
      residualImpact: int(1, 4),
      status: pick(['ACTIVE', 'ACTIVE', 'ACTIVE', 'DRAFT', 'RETIRED'] as const),
      nextReviewAt: new Date(now + int(-30, 300) * DAY),
      lastAssessedAt: new Date(now - int(1, 300) * DAY),
    })),
  });
  await prisma.control.createMany({
    data: controls.map((c) => ({
      objectId: c.id,
      controlType: pick(['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'] as const),
      nature: pick(['MANUAL', 'AUTOMATED', 'IT_DEPENDENT_MANUAL'] as const),
      frequency: pick(['PER_TRANSACTION', 'DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const),
      departmentId: pick(allDeps).id,
      keyControl: chance(0.3),
      systemId: chance(0.4) ? pick(apps).id : null,
      effectiveness: pick([
        'EFFECTIVE',
        'EFFECTIVE',
        'PARTLY',
        'NOT_EFFECTIVE',
        'NOT_ASSESSED',
      ] as const),
      operatingEffectiveness: pick(['EFFECTIVE', 'PARTLY', 'NOT_ASSESSED'] as const),
      status: pick(['ACTIVE', 'ACTIVE', 'ACTIVE', 'DRAFT'] as const),
      nextReviewAt: new Date(now + int(-30, 300) * DAY),
      lastTestedAt: new Date(now - int(1, 200) * DAY),
    })),
  });
  const riskControls = new Map<string, { riskId: string; controlId: string }>();
  for (const c of controls) {
    for (let k = 0; k < int(1, 2); k++) {
      const r = pick(risks);
      riskControls.set(`${r.id}|${c.id}`, { riskId: r.id, controlId: c.id });
    }
  }
  await chunked([...riskControls.values()], 2000, (part) =>
    prisma.riskControl.createMany({ data: part }),
  );
  // Risks and controls on process steps (heat maps per process, coverage).
  const grcLinks: Prisma.ObjectLinkCreateManyInput[] = [];
  for (const pub of published) {
    for (const taskId of pub.diagram.taskIds.slice(0, 4)) {
      if (chance(0.35))
        grcLinks.push({
          processId: pub.id,
          bpmnElementId: taskId,
          repoObjectId: pick(risks).id,
          relation: 'MITIGATES',
        });
      if (chance(0.35))
        grcLinks.push({
          processId: pub.id,
          bpmnElementId: taskId,
          repoObjectId: pick(controls).id,
          relation: 'MITIGATES',
        });
    }
  }
  await chunked(grcLinks, 2000, (part) =>
    prisma.objectLink.createMany({ data: part, skipDuplicates: true }),
  );
  // Quarterly tests of key controls over three years (+ plans), closed except the last quarter.
  const testers = [...byRole('INTERNAL_AUDIT'), ...byRole('RISK_OFFICER'), admin];
  const keyControls = controls.filter((_, i) => i % 3 === 0);
  const plans = keyControls.map((c) => ({
    id: randomUUID(),
    controlId: c.id,
    testType: 'OPERATING',
    sampleSize: 5,
    frequency: 'QUARTERLY',
    testerId: pick(testers).id,
    reviewerId: admin.id,
    nextDueAt: new Date(now + int(5, 90) * DAY),
    createdById: riskOfficer.id,
  }));
  await chunked(plans, 2000, (part) => prisma.controlTestPlan.createMany({ data: part }));
  const tests: Prisma.ControlTestCreateManyInput[] = [];
  for (const plan of plans) {
    for (let q = 0; q < 12; q++) {
      const due = new Date(now - (11 - q) * 91 * DAY);
      const done = q < 11;
      const year = due.getUTCFullYear();
      tests.push({
        planId: plan.id,
        controlId: plan.controlId,
        testType: 'OPERATING',
        period: `${year}-Q${Math.floor(due.getUTCMonth() / 3) + 1}`,
        dueAt: due,
        status: done ? 'CLOSED' : pick(['PLANNED', 'IN_PROGRESS', 'SUBMITTED']),
        origin: 'PLAN',
        sampleSize: 5,
        testerId: plan.testerId,
        reviewerId: plan.reviewerId,
        conclusion: done ? pick(['EFFECTIVE', 'EFFECTIVE', 'PARTLY', 'NOT_EFFECTIVE']) : null,
        executedById: done ? plan.testerId : null,
        reviewedById: done ? plan.reviewerId : null,
        submittedAt: done ? new Date(due.getTime() - 3 * DAY) : null,
        reviewedAt: done ? new Date(due.getTime() - DAY) : null,
        closedAt: done ? new Date(due.getTime() - DAY) : null,
        createdById: riskOfficer.id,
      });
    }
  }
  await chunked(tests, 2000, (part) => prisma.controlTest.createMany({ data: part }));
  const issues = Array.from({ length: S(500, 5) }, (_, i) => ({
    code: `ISS-V${String(i + 1).padStart(4, '0')}`,
    titleEn: `Control deficiency ${i + 1}`,
    titleAr: `قصور في الضابط ${i + 1}`,
    sourceType: 'CONTROL_TEST',
    severity: pick(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    status: pick(['OPEN', 'OPEN', 'IN_PROGRESS', 'CLOSED']),
    ownerId: pick(owners).id,
    dueAt: new Date(now + int(-60, 120) * DAY),
    controlId: pick(controls).id,
    departmentId: pick(allDeps).id,
    createdById: riskOfficer.id,
  }));
  await prisma.issue.createMany({ data: issues });
  counts.risks = risks.length;
  counts.controls = controls.length;
  counts.controlTests = tests.length;
  counts.issues = issues.length;

  // ----- KPIs -----
  step('KPIs and three years of measurements');
  const kpis = Array.from({ length: S(200, 4) }, (_, i) => ({
    id: randomUUID(),
    type: 'KPI' as const,
    code: `KPI-V${String(i + 1).padStart(3, '0')}`,
    nameEn: `${pick(NOUNS)[0]} cycle time ${i + 1}`,
    nameAr: `زمن دورة ${pick(NOUNS)[1]} ${i + 1}`,
    ownerId: pick(owners).id,
    createdById: admin.id,
  }));
  await prisma.repoObject.createMany({ data: kpis });
  await prisma.kpi.createMany({
    data: kpis.map((k, i) => ({
      objectId: k.id,
      unit: pick(['%', 'days', 'AED', 'count']),
      direction: i % 2 ? ('HIGHER_IS_BETTER' as const) : ('LOWER_IS_BETTER' as const),
      frequency: 'MONTHLY' as const,
      target: 80,
      greenThreshold: i % 2 ? 80 : 20,
      redThreshold: i % 2 ? 60 : 40,
      baseline: 50,
      departmentId: pick(allDeps).id,
    })),
  });
  const measurements: Prisma.KpiMeasurementCreateManyInput[] = [];
  const start = new Date(
    Date.UTC(new Date(now).getUTCFullYear() - 3, new Date(now).getUTCMonth(), 1),
  );
  for (const k of kpis) {
    let v = int(30, 90);
    for (let m = 0; m < 36; m++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
      v = Math.max(0, Math.min(100, v + int(-6, 6)));
      measurements.push({
        kpiId: k.id,
        period: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        periodStart: d,
        value: v,
        createdById: k.ownerId,
      });
    }
  }
  await chunked(measurements, 2000, (part) => prisma.kpiMeasurement.createMany({ data: part }));
  await prisma.objectLink.createMany({
    data: kpis.map((k) => ({
      processId: published.length ? pick(published).id : pick(processes).id,
      bpmnElementId: '#process',
      repoObjectId: k.id,
      relation: 'MEASURES' as const,
    })),
    skipDuplicates: true,
  });
  counts.kpis = kpis.length;
  counts.kpiMeasurements = measurements.length;

  // ----- import batches -----
  step('import batches');
  const maxNumber =
    (await prisma.importBatch.aggregate({ _max: { number: true } }))._max.number ?? 0;
  const batches = Array.from({ length: S(50, 2) }, (_, i) => ({
    id: randomUUID(),
    number: maxNumber + i + 1,
    kind: pick(['BPMN', 'WORD', 'PROCESS_HOUSE', 'USERS', 'GRC_RISKS']),
    status: pick(['APPLIED', 'APPLIED', 'APPLIED', 'UNDONE', 'READY', 'FAILED'] as const),
    note: `Volume batch ${i + 1}`,
    progress: 1,
    summary: { created: 20, updated: 0, skipped: 0 } as Prisma.InputJsonValue,
    createdById: admin.id,
    createdAt: new Date(now - (50 - i) * DAY),
    appliedAt: new Date(now - (50 - i) * DAY),
  }));
  await prisma.importBatch.createMany({ data: batches });
  const items = batches.flatMap((b) =>
    Array.from({ length: 20 }, (_, j) => ({
      batchId: b.id,
      ref: `row ${j + 2}`,
      entityType: 'Process',
      entityId: pick(processes).id,
      outcome: 'CREATED',
      externalKey: `${b.number}-${j}`,
      nameEn: `Imported item ${j + 1}`,
      seq: j,
    })),
  );
  await prisma.importItem.createMany({ data: items });
  counts.importBatches = batches.length;

  // ----- notifications and audit log -----
  step('notifications and audit log');
  const notes: Prisma.NotificationCreateManyInput[] = [];
  for (const u of users) {
    for (let k = 0; k < 20; k++) {
      const p = pick(processes);
      notes.push({
        userId: u.id,
        type: pick(['REVIEW_REQUESTED', 'PUBLISHED', 'COMMENT_REPLY', 'GRC_REVIEW', 'KPI']),
        entityType: 'PROCESS',
        entityId: p.id,
        params: { titleEn: p.nameEn, titleAr: p.nameAr } as Prisma.InputJsonValue,
        link: `/processes/${p.id}`,
        readAt: chance(0.7) ? new Date(now - int(0, 60) * DAY) : null,
        createdAt: new Date(now - int(0, 90) * DAY),
      });
    }
  }
  await chunked(notes, 5000, (part) => prisma.notification.createMany({ data: part }));
  const audit: Prisma.AuditLogCreateManyInput[] = [];
  const auditCount = S(200_000, 200);
  for (let i = 0; i < auditCount; i++) {
    const u = pick(users);
    const p = pick(processes);
    audit.push({
      userId: u.id,
      action: pick(['UPDATE', 'UPDATE', 'CREATE', 'LOGIN', 'PUBLISH']),
      entityType: 'Process',
      entityId: p.id,
      summary: { code: p.code } as Prisma.InputJsonValue,
      createdAt: new Date(now - Math.floor(rnd() * 365 * DAY)),
    });
    if (audit.length === 10_000) {
      await prisma.auditLog.createMany({ data: audit.splice(0) });
    }
  }
  if (audit.length) await prisma.auditLog.createMany({ data: audit });
  counts.notifications = notes.length;
  counts.auditLog = auditCount;

  // ----- mining: a 1M-event log -----
  if (!opts.skip.has('mining')) {
    step('mining log (~5.5 events per case)');
    const caseCount = S(180_000, 200);
    const events = generateInvoiceLog(caseCount, 99);
    const logId = randomUUID();
    const p2p = published.length ? pick(published) : pick(processes);
    await prisma.eventLog.create({
      data: {
        id: logId,
        code: 'LOG-V01',
        nameEn: 'Invoice handling (volume)',
        nameAr: 'معالجة الفواتير (حجم)',
        processId: p2p.id,
        ownerId: admin.id,
        status: 'IMPORTING',
        createdById: admin.id,
      },
    });
    const activity = new Map<string, { events: number; cases: Set<string> }>();
    let rows: Prisma.MiningEventCreateManyInput[] = [];
    let minT = Infinity;
    let maxT = -Infinity;
    const resources = new Set<string>();
    for (const e of events) {
      const end = e.end;
      minT = Math.min(minT, end);
      maxT = Math.max(maxT, end);
      if (e.resource) resources.add(e.resource);
      const a = activity.get(e.activity) ?? { events: 0, cases: new Set<string>() };
      a.events++;
      a.cases.add(e.caseId);
      activity.set(e.activity, a);
      rows.push({
        logId,
        caseId: e.caseId,
        activity: e.activity,
        startAt: e.start === null ? null : new Date(e.start),
        endAt: new Date(end),
        resource: e.resource ?? null,
        department: e.department ?? null,
        attributes: e.attrs as Prisma.InputJsonValue,
      });
      if (rows.length === 5000) {
        await prisma.miningEvent.createMany({ data: rows });
        rows = [];
      }
    }
    if (rows.length) await prisma.miningEvent.createMany({ data: rows });
    await prisma.miningActivity.createMany({
      data: [...activity].map(([name, a]) => ({
        logId,
        name,
        eventCount: a.events,
        caseCount: a.cases.size,
      })),
    });
    // dataVersion 1 without a snapshot: the first analysis builds it from the events (SnapshotService).
    await prisma.eventLog.update({
      where: { id: logId },
      data: {
        status: 'READY',
        dataVersion: 1,
        caseCount,
        eventCount: events.length,
        activityCount: activity.size,
        resourceCount: resources.size,
        hasStartTimes: true,
        attributeNames: ['amount', 'channel'],
        periodStart: new Date(minT),
        periodEnd: new Date(maxT),
        importedAt: new Date(),
      },
    });
    counts.miningEvents = events.length;
  }

  // ----- workflow requests through the real services -----
  if (!opts.skip.has('workflow') && opts.appContext) {
    step('workflow requests (real services)');
    counts.workflowCases = await seedVolumeWorkflow(
      prisma,
      opts,
      users,
      allDeps,
      S(10_000, 20),
      step,
    );
  }

  // Measurement scripts sign in with passwords: no role must enrol 2FA on this test database.
  const auth = await prisma.setting.findUnique({ where: { key: 'auth' } });
  const authValue = {
    ...((auth?.value as Record<string, unknown> | null) ?? {}),
    mfaRequiredRoles: [],
  };
  await prisma.setting.upsert({
    where: { key: 'auth' },
    create: { key: 'auth', value: authValue as Prisma.InputJsonValue },
    update: { value: authValue as Prisma.InputJsonValue },
  });
  await prisma.setting.create({
    data: {
      key: VOLUME_MARKER,
      value: { at: new Date().toISOString(), scale: opts.scale, counts } as Prisma.InputJsonValue,
    },
  });
  step('done');
  return counts;
}

async function seedVolumeWorkflow(
  prisma: Db,
  opts: VolumeOptions,
  users: { id: string; email: string; departmentId: string | null; role: SystemRoleKey }[],
  deps: { id: string }[],
  n: number,
  step: (s: string) => void,
): Promise<number> {
  const { WorkflowCasesService } = await import('../src/workflow/workflow-cases.service');
  const { WorkflowTasksService } = await import('../src/workflow/workflow-tasks.service');
  const hr = await prisma.repoObject.create({
    data: { type: 'ROLE', nameEn: 'HR Officer (volume)' },
  });
  await prisma.userJobRole.createMany({
    data: users.slice(1, 6).map((u) => ({ userId: u.id, repoObjectId: hr.id })),
    skipDuplicates: true,
  });
  const xml = leaveRequestXml(hr.id);
  const owner = users.find((u) => u.role === 'PROCESS_OWNER') ?? users[0];
  const proc = await prisma.process.create({
    data: {
      code: 'S.V99',
      nameEn: 'Leave request (volume)',
      nameAr: 'طلب إجازة (حجم)',
      category: 'SUPPORT',
      status: 'PUBLISHED',
      ownerId: owner.id,
      departmentId: deps[0].id,
    },
  });
  await prisma.processModel.create({ data: { processId: proc.id, bpmnXml: xml } });
  await prisma.processVersion.create({
    data: { processId: proc.id, versionNumber: 1, bpmnXml: xml, changeNote: 'Volume' },
  });
  await prisma.workflowProcessConfig.create({
    data: { processId: proc.id, enabled: true, casePrefix: 'VLV', eventLog: true },
  });
  const def = await prisma.workflowDefinition.create({
    data: {
      processId: proc.id,
      versionNumber: 1,
      bpmnXml: xml,
      model: readWorkflowModel(xml) as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.workflowProcessConfig.update({
    where: { processId: proc.id },
    data: { activeDefinitionId: def.id },
  });
  const app = await opts.appContext!();
  try {
    const cases = app.get(WorkflowCasesService);
    const tasks = app.get(WorkflowTasksService);
    const meta = { ip: null, userAgent: 'volume-seed' };
    const managers = new Set(
      (await prisma.department.findMany({ select: { managerId: true } })).map((d) => d.managerId),
    );
    const requesters = users.filter((u) => !managers.has(u.id) && u.departmentId);
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const u = requesters[i % requesters.length];
      await cases.start(
        proc.id,
        {
          leaveType: pick(['annual', 'sick', 'unpaid']),
          firstDay: '2026-12-01',
          days: (i % 15) + 1,
          reason: 'Volume',
        },
        [],
        volumeAuth(u, 'VIEWER'),
        meta,
      );
      if ((i + 1) % 1000 === 0)
        step(`  ${i + 1} requests (${((Date.now() - t0) / (i + 1)).toFixed(0)} ms each)`);
    }
    // A third approved by the managers: history, completed tasks, the next step's open tasks.
    const open = await prisma.workflowTask.findMany({
      where: { status: 'OPEN', elementId: 'ManagerApproval', case: { processId: proc.id } },
      take: Math.round(n / 3),
      select: { id: true, version: true, assigneeId: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const t of open) {
      const u = t.assigneeId ? byId.get(t.assigneeId) : undefined;
      if (!u) continue;
      await tasks.complete(
        t.id,
        { data: {}, decision: 'APPROVE', comment: '', version: t.version },
        volumeAuth(u, 'VIEWER'),
        meta,
      );
    }
  } finally {
    await app.close();
  }
  return n;
}

export function volumeAuth(
  u: { id: string; email: string; departmentId: string | null },
  role: SystemRoleKey,
): AuthUser {
  return {
    id: u.id,
    email: u.email,
    nameEn: u.email,
    nameAr: '',
    locale: 'en',
    departmentId: u.departmentId,
    roles: [role],
    permissions: new Set<Permission>(SYSTEM_ROLES[role].permissions),
    hasPassword: true,
    ssoLinked: false,
    mfaEnabled: false,
  };
}

if (require.main === module) {
  const arg = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (process.env.NODE_ENV === 'production') {
    console.error('The volume seed never runs in production (NODE_ENV=production).');
    process.exit(1);
  }
  if (process.env.VOLUME_SEED !== 'yes') {
    console.error(
      'Set VOLUME_SEED=yes to confirm that this database is a disposable test database.',
    );
    process.exit(1);
  }
  const prisma = new PrismaClient();
  seedVolume(prisma, {
    scale: Number(arg('scale') ?? 1),
    skip: new Set((arg('skip') ?? '').split(',').filter(Boolean)),
    appContext: async () => {
      await import('reflect-metadata');
      const { NestFactory } = await import('@nestjs/core');
      const { AppModule } = await import('../src/app.module');
      return NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    },
  })
    .then((counts) => console.table(counts))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
