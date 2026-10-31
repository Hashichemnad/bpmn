import { rng, type MiningEventInput } from '@processhub/shared';

/**
 * Deterministic demo event log of "S.01.04 Invoice processing" (Phase 5.1 seed, samples and the
 * 1 M-event performance script): main path, a clarification loop with rework (~25 %), the finance
 * manager's approval as the bottleneck (long queue), and a few deviations (no PO match ~4 %,
 * approval after scheduling ~3 %). Times follow a Sun–Thu, 07:30–15:30 working week in Asia/Dubai.
 */
export const INVOICE_STEPS = {
  register: 'Register invoice',
  match: 'Match with purchase order',
  clarify: 'Clarify with supplier',
  approve: 'Approve invoice',
  schedule: 'Schedule payment',
  pay: 'Pay supplier',
} as const;

const CLERKS = ['Sara', 'Omar', 'Huda', 'Ali'];
const MANAGERS = ['Fatima', 'Khalid'];
const TREASURY = ['Noor', 'Yousef'];
const DUBAI = 4 * 3_600_000;
const DAY = 86_400_000;

/** Next working moment (Sun–Thu 07:30–15:30 local) at or after `t` (UTC ms). */
function working(t: number): number {
  for (let guard = 0; guard < 30; guard++) {
    const local = new Date(t + DUBAI);
    const dow = local.getUTCDay();
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const dayStart =
      t - (minutes * 60_000 + local.getUTCSeconds() * 1000 + local.getUTCMilliseconds());
    if (dow === 5 || dow === 6 || minutes >= 15.5 * 60) {
      t = dayStart + DAY + 7.5 * 3_600_000;
      continue;
    }
    if (minutes < 7.5 * 60) return dayStart + 7.5 * 3_600_000;
    return t;
  }
  return t;
}

export function generateInvoiceLog(cases: number, seed = 2026, start = Date.UTC(2026, 3, 1, 4)) {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const exp = (mean: number) => -Math.log(1 - r()) * mean;
  const events: MiningEventInput[] = [];
  const span = 182 * DAY;
  for (let i = 0; i < cases; i++) {
    const id = `INV-${String(i + 1).padStart(6, '0')}`;
    const amount = r() < 0.6 ? 'Low' : r() < 0.75 ? 'Medium' : 'High';
    const channel = r() < 0.5 ? 'Portal' : r() < 0.8 ? 'Email' : 'Paper';
    const attrs = { amount, channel };
    let t = working(start + (i / cases) * span + r() * 3_600_000);
    const step = (
      activity: string,
      waitMin: number,
      workMin: number,
      resource: string,
      department: string,
    ) => {
      const s = working(t + exp(waitMin) * 60_000);
      const e = s + Math.max(1, workMin * (0.6 + r() * 0.8)) * 60_000;
      events.push({ caseId: id, activity, start: s, end: e, resource, department, attrs });
      t = e;
    };
    const clerk = pick(CLERKS);
    step(INVOICE_STEPS.register, 20, 15, clerk, 'Accounts Payable');
    const skipMatch = r() < 0.04;
    if (!skipMatch) {
      step(INVOICE_STEPS.match, 60, channel === 'Paper' ? 35 : 20, clerk, 'Accounts Payable');
      // Rework loop: clarification and a second match.
      let loops = 0;
      while (r() < (loops ? 0.15 : 0.25) && loops < 3) {
        step(INVOICE_STEPS.clarify, 120, 45, clerk, 'Accounts Payable');
        step(INVOICE_STEPS.match, 240, 20, clerk, 'Accounts Payable');
        loops++;
      }
    }
    const lateApproval = r() < 0.03;
    // Bottleneck: the finance managers' queue (high amounts wait longer).
    const approvalWait = amount === 'High' ? 2400 : 900;
    if (!lateApproval) step(INVOICE_STEPS.approve, approvalWait, 10, pick(MANAGERS), 'Finance');
    step(INVOICE_STEPS.schedule, 60, 10, pick(TREASURY), 'Treasury');
    if (lateApproval) step(INVOICE_STEPS.approve, approvalWait, 10, pick(MANAGERS), 'Finance');
    step(INVOICE_STEPS.pay, 300, 5, pick(TREASURY), 'Treasury');
  }
  return events;
}

const csvCell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const local = (t: number) => new Date(t + DUBAI).toISOString().slice(0, 16).replace('T', ' ');

/** CSV with local (Asia/Dubai) times: case, activity, start, end, resource, department, amount, channel. */
export function invoiceLogCsv(events: MiningEventInput[]): string {
  const rows = ['case_id,activity,start_time,end_time,resource,department,amount,channel'];
  for (const e of events)
    rows.push(
      [
        e.caseId,
        e.activity,
        local(e.start!),
        local(e.end),
        e.resource ?? '',
        e.department ?? '',
        e.attrs?.amount ?? '',
        e.attrs?.channel ?? '',
      ]
        .map((x) => csvCell(String(x)))
        .join(','),
    );
  return `${rows.join('\n')}\n`;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** XES (IEEE 1849) with start / complete lifecycle events. */
export function invoiceLogXes(events: MiningEventInput[]): string {
  const byCase = new Map<string, MiningEventInput[]>();
  for (const e of events) byCase.set(e.caseId, [...(byCase.get(e.caseId) ?? []), e]);
  const iso = (t: number) => new Date(t + DUBAI).toISOString().replace('Z', '+04:00');
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<log xes.version="1.0" xmlns="http://www.xes-standard.org/">',
    '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>',
    '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>',
    '  <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>',
    '  <extension name="Organizational" prefix="org" uri="http://www.xes-standard.org/org.xesext"/>',
    '  <string key="concept:name" value="Invoice processing (ProcessHub sample)"/>',
  ];
  for (const [id, evs] of byCase) {
    out.push('  <trace>', `    <string key="concept:name" value="${xml(id)}"/>`);
    out.push(`    <string key="channel" value="${xml(evs[0].attrs?.channel ?? '')}"/>`);
    for (const e of evs)
      for (const [tr, t] of [
        ['start', e.start!],
        ['complete', e.end],
      ] as const)
        out.push(
          `    <event><string key="concept:name" value="${xml(e.activity)}"/><string key="lifecycle:transition" value="${tr}"/><date key="time:timestamp" value="${iso(t)}"/><string key="org:resource" value="${xml(e.resource ?? '')}"/><string key="org:group" value="${xml(e.department ?? '')}"/></event>`,
        );
    out.push('  </trace>');
  }
  out.push('</log>');
  return `${out.join('\n')}\n`;
}
