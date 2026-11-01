/**
 * API timings of the main screens on a volume database (final session, part A). Signs in over HTTP
 * like the browser (CSRF cookie + header) and measures each endpoint sequentially: warm-up requests,
 * then P50 / P95 / max of `--runs` requests. Prints a Markdown table for docs/PROGRESS.md.
 *
 *   # API running against the volume database (prisma/seed-volume.ts), e.g. node dist/src/main.js
 *   DATABASE_URL=… npx ts-node --transpile-only prisma/perf-api.ts --base=http://localhost:3000 [--runs=20]
 *
 * DATABASE_URL is only read to pick sample IDs (a published process, a request, the mining log …).
 */
import { PrismaClient } from '@prisma/client';
import { VOLUME_PASSWORD } from './seed-volume';

const arg = (name: string, def: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const BASE = `${arg('base', 'http://localhost:3000')}/api/v1`;
const RUNS = Number(arg('runs', '20'));
const ONLY = arg('only', '');

class Session {
  private cookies = new Map<string, string>();
  csrf = '';

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        cookie: this.cookieHeader(),
        // The double-submit token is rotated at sign-in: always send the current cookie value.
        'x-csrf-token': this.cookies.get('ph_csrf') ?? this.csrf,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.keep(res);
    return res;
  }

  async login(email: string, password: string) {
    await this.request('GET', '/auth/csrf');
    this.csrf = this.cookies.get('ph_csrf') ?? '';
    const res = await this.request('POST', '/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`Login ${email}: ${res.status} ${await res.text()}`);
    return this;
  }
}

interface Probe {
  label: string;
  session: Session;
  method?: string;
  path: string;
  body?: unknown;
  /** Not a page call (export / background job): the 2 s limit, not the 300 ms target. */
  heavy?: boolean;
  runs?: number;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function measure(p: Probe) {
  const runs = p.runs ?? RUNS;
  const times: number[] = [];
  let bytes = 0;
  for (let i = 0; i < runs + 2; i++) {
    const t = performance.now();
    const res = await p.session.request(p.method ?? 'GET', p.path, p.body);
    const buf = await res.arrayBuffer();
    const ms = performance.now() - t;
    if (res.status >= 400)
      throw new Error(`${p.label}: ${res.status} ${Buffer.from(buf).toString()}`);
    bytes = buf.byteLength;
    if (i >= 2) times.push(ms); // two warm-up requests (caches, JIT)
  }
  return {
    label: p.label,
    p50: pct(times, 50),
    p95: pct(times, 95),
    max: Math.max(...times),
    kb: bytes / 1024,
    heavy: !!p.heavy,
  };
}

async function main() {
  const prisma = new PrismaClient();
  const pick = async <T>(q: Promise<T | null>, what: string): Promise<T> => {
    const r = await q;
    if (!r) throw new Error(`No ${what} in this database — run prisma/seed-volume.ts first`);
    return r;
  };
  const superAdmin = await pick(
    prisma.user.findFirst({ where: { email: 'user0@volume.local' } }),
    'volume users',
  );
  const pub = await pick(
    prisma.publication.findFirst({
      where: {
        entityType: 'PROCESS',
        current: true,
        code: { contains: '.V' },
        textEn: { not: '' },
      },
      orderBy: { textEn: 'desc' },
    }),
    'published process',
  );
  const bigModel = (
    await prisma.$queryRaw<{ processId: string }[]>`
      SELECT "processId" FROM "ProcessModel" ORDER BY length("bpmnXml") DESC LIMIT 1`
  )[0];
  const page = await pick(
    prisma.publication.findFirst({ where: { entityType: 'PAGE', current: true } }),
    'published page',
  );
  const l1 = await pick(
    prisma.process.findFirst({
      where: { level: 2, code: { contains: '.V' }, status: 'PUBLISHED' },
    }),
    'level-2 process',
  );
  const log = await prisma.eventLog.findFirst({ where: { code: 'LOG-V01' } });
  const kase = await prisma.workflowCase.findFirst({
    where: { process: { code: 'S.V99' } },
    orderBy: { startedAt: 'desc' },
  });
  const manager = await prisma.workflowTask.groupBy({
    by: ['assigneeId'],
    where: { status: 'OPEN', assigneeId: { not: null }, case: { process: { code: 'S.V99' } } },
    _count: { _all: true },
    orderBy: { _count: { assigneeId: 'desc' } },
    take: 1,
  });
  const managerUser = manager[0]?.assigneeId
    ? await prisma.user.findUnique({ where: { id: manager[0].assigneeId } })
    : null;
  const viewer = await pick(
    prisma.user.findFirst({
      where: { email: { endsWith: '@volume.local' }, roles: { some: { role: { key: 'VIEWER' } } } },
    }),
    'viewer',
  );
  const volumeIds = (
    await prisma.user.findMany({
      where: { email: { endsWith: '@volume.local' } },
      select: { id: true },
    })
  ).map((u) => u.id);
  const reviewer = await prisma.reviewTask.findFirst({
    where: { status: 'PENDING', assigneeId: { in: volumeIds } },
  });
  const reviewerUser = reviewer
    ? await prisma.user.findUnique({ where: { id: reviewer.assigneeId } })
    : null;
  await prisma.$disconnect();

  const admin = await new Session().login(superAdmin.email, VOLUME_PASSWORD);
  const portal = await new Session().login(viewer.email, VOLUME_PASSWORD);
  const mgr = managerUser ? await new Session().login(managerUser.email, VOLUME_PASSWORD) : admin;
  const rev = reviewerUser ? await new Session().login(reviewerUser.email, VOLUME_PASSWORD) : admin;

  const probes: Probe[] = [
    { label: 'Auth: current user', session: admin, path: '/auth/me' },
    { label: 'Process tree', session: admin, path: '/processes/tree' },
    { label: 'Process list (page 1)', session: admin, path: '/processes?page=1&pageSize=20' },
    {
      label: 'Process detail (largest diagram)',
      session: admin,
      path: `/processes/${bigModel.processId}`,
    },
    {
      label: 'Process model (largest diagram)',
      session: admin,
      path: `/processes/${bigModel.processId}/model`,
    },
    {
      label: 'Process versions',
      session: admin,
      path: `/processes/${bigModel.processId}/versions`,
    },
    { label: 'Search "invoice"', session: admin, path: '/search?q=invoice' },
    { label: 'Portal home', session: portal, path: '/portal/home' },
    { label: 'Portal process list', session: portal, path: '/portal/processes' },
    { label: 'Portal process page', session: portal, path: `/portal/processes/${pub.entityId}` },
    { label: 'Portal page', session: portal, path: `/portal/pages/${page.entityId}` },
    { label: 'Portal search "approve"', session: portal, path: '/portal/search?q=approve' },
    { label: 'Portal "my processes"', session: portal, path: '/portal/my' },
    { label: 'My tasks (reviewer)', session: rev, path: '/tasks' },
    { label: 'Notifications (unread count)', session: rev, path: '/notifications/unread-count' },
    { label: 'Notifications (list)', session: rev, path: '/notifications' },
    {
      label: 'Inbox: workflow tasks (manager)',
      session: mgr,
      path: '/workflow/tasks?scope=mine&page=1&pageSize=20',
    },
    { label: 'Inbox: task counts (manager)', session: mgr, path: '/workflow/tasks/counts' },
    { label: 'Governance dashboard', session: admin, path: '/governance/dashboard' },
    { label: 'GRC dashboard + heat maps', session: admin, path: '/grc/dashboard' },
    {
      label: 'GRC process view (heat map per process)',
      session: admin,
      path: `/grc/processes/${pub.entityId}`,
    },
    { label: 'Risk register (page 1)', session: admin, path: '/grc/risks?page=1&pageSize=20' },
    {
      label: 'Control register (page 1)',
      session: admin,
      path: '/grc/controls?page=1&pageSize=20',
    },
    { label: 'Assurance dashboard', session: admin, path: '/assurance/dashboard' },
    { label: 'Assurance tasks', session: admin, path: '/assurance/tasks' },
    { label: 'KPI list (page 1)', session: admin, path: '/kpis?page=1&pageSize=20' },
    { label: 'KPI scorecard (dashboard)', session: admin, path: '/kpis/scorecard' },
    {
      label: 'Application catalogue (page 1)',
      session: admin,
      path: '/ea/applications?page=1&pageSize=20',
    },
    { label: 'Workflow monitor', session: admin, path: '/workflow/monitor' },
    { label: 'Workflow dashboard', session: admin, path: '/workflow/dashboard' },
    ...(kase
      ? [{ label: 'Workflow case page', session: admin, path: `/workflow/cases/${kase.id}` }]
      : []),
    { label: 'Import Center (batches)', session: admin, path: '/imports?page=1&pageSize=20' },
    { label: 'Audit log (page 1)', session: admin, path: '/audit-logs?page=1&pageSize=50' },
    { label: 'Users (page 1)', session: admin, path: '/users?page=1&pageSize=20' },
    ...(log
      ? [
          { label: 'Mining log', session: admin, path: `/mining/logs/${log.id}` },
          {
            label: 'Mining map (analysis, cached)',
            session: admin,
            method: 'POST',
            path: `/mining/logs/${log.id}/analysis`,
            body: {},
          },
        ]
      : []),
    {
      label: 'Apply theme (dry run, all diagrams)',
      session: admin,
      method: 'POST',
      path: '/settings/diagram-theme/apply',
      body: { dryRun: true },
      heavy: true,
      runs: 3,
    },
    {
      label: 'Handbook export (branch, Word)',
      session: admin,
      method: 'POST',
      path: '/reports/handbook',
      body: { processId: l1.id, includeChildren: true, locale: 'en' },
      heavy: true,
      runs: 3,
    },
  ];
  const rows = [];
  for (const p of probes) {
    if (ONLY && !p.label.toLowerCase().includes(ONLY.toLowerCase())) continue;
    try {
      const r = await measure(p);
      rows.push(r);
      console.error(`${r.label}: p95 ${r.p95.toFixed(0)} ms`);
    } catch (e) {
      console.error(`${p.label}: FAILED ${(e as Error).message.slice(0, 300)}`);
      rows.push({ label: p.label, p50: NaN, p95: NaN, max: NaN, kb: 0, heavy: !!p.heavy });
    }
  }
  console.log('| Endpoint | P50 ms | P95 ms | Max ms | Response KB |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    const flag = r.heavy ? (r.p95 > 2000 ? ' ⚠' : '') : r.p95 > 300 ? ' ⚠' : '';
    console.log(
      `| ${r.label}${r.heavy ? ' (export / job)' : ''} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)}${flag} | ${r.max.toFixed(0)} | ${r.kb.toFixed(0)} |`,
    );
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
