import { randomUUID } from 'node:crypto';
import type { TeamsLanguage, WebhookEventType, WebhookPayload } from '@processhub/shared';
import type { IntegrationEvent } from '../events/domain-events';

/** Public API path of an entity, when the public API has one. */
function apiPath(entity: IntegrationEvent['entity']): string | null {
  switch (entity.type) {
    case 'PROCESS':
      return `/api/public/v1/processes/${entity.id}`;
    case 'PAGE':
      return `/api/public/v1/pages/${entity.id}`;
    case 'DIAGRAM':
      return `/api/public/v1/diagrams/${entity.id}`;
    default:
      return null;
  }
}

/** Knowledge Portal path of a published item. */
function portalPath(entity: IntegrationEvent['entity']): string | null {
  switch (entity.type) {
    case 'PROCESS':
      return `/portal/processes/${entity.id}`;
    case 'PAGE':
      return `/portal/pages/${entity.id}`;
    case 'DIAGRAM':
      return `/portal/diagrams/${entity.id}`;
    default:
      return null;
  }
}

/** The JSON body of a generic webhook delivery: ids, links and a few facts (D-174). */
export function buildPayload(
  e: IntegrationEvent,
  appUrl: string,
  eventId: string = randomUUID(),
  occurredAt = new Date(),
): WebhookPayload {
  const links: Record<string, string> = { app: `${appUrl}${e.link}` };
  const portal = portalPath(e.entity);
  if (portal && e.event.endsWith('.published')) links.portal = `${appUrl}${portal}`;
  const api = apiPath(e.entity);
  if (api) links.api = `${appUrl}${api}`;
  return {
    id: eventId,
    type: e.event,
    occurredAt: occurredAt.toISOString(),
    entity: {
      type: e.entity.type,
      id: e.entity.id,
      code: e.entity.code,
      nameEn: e.entity.nameEn,
      nameAr: e.entity.nameAr,
    },
    links,
    data: e.data ?? {},
  };
}

export function testPayload(appUrl: string): WebhookPayload {
  return {
    id: randomUUID(),
    type: 'test',
    occurredAt: new Date().toISOString(),
    entity: null,
    links: { app: appUrl },
    data: { message: 'Test event from ProcessHub' },
  };
}

// ---------- Microsoft Teams: Adaptive Cards (D-176) ----------

const TITLES: Record<WebhookEventType | 'test', { en: string; ar: string }> = {
  'process.published': { en: 'Process published', ar: 'تم نشر عملية' },
  'process.archived': { en: 'Process archived', ar: 'تمت أرشفة عملية' },
  'page.published': { en: 'Page published', ar: 'تم نشر صفحة' },
  'page.archived': { en: 'Page archived', ar: 'تمت أرشفة صفحة' },
  'diagram.published': { en: 'Diagram published', ar: 'تم نشر مخطط' },
  'diagram.archived': { en: 'Diagram archived', ar: 'تمت أرشفة مخطط' },
  'review.submitted': { en: 'Submitted for review', ar: 'أُرسل للمراجعة' },
  'review.approved': { en: 'Review approved', ar: 'تم اعتماد المراجعة' },
  'review.rejected': { en: 'Review rejected', ar: 'تم رفض المراجعة' },
  'workflow.case.started': { en: 'Request started', ar: 'بدأ طلب جديد' },
  'workflow.case.completed': { en: 'Request completed', ar: 'اكتمل الطلب' },
  'workflow.case.overdue': { en: 'Request task overdue', ar: 'مهمة طلب متأخرة' },
  'issue.raised': { en: 'Issue raised', ar: 'تم تسجيل ملاحظة' },
  'issue.overdue': { en: 'Issue overdue', ar: 'ملاحظة متأخرة' },
  'kpi.red': { en: 'KPI turned red', ar: 'مؤشر أداء في المنطقة الحمراء' },
  'import.completed': { en: 'Import completed', ar: 'اكتمل الاستيراد' },
  test: { en: 'Test message from ProcessHub', ar: 'رسالة تجريبية من ProcessHub' },
};

const LABELS = {
  en: { owner: 'Owner', open: 'Open in ProcessHub', portal: 'Open in the Knowledge Portal' },
  ar: { owner: 'المالك', open: 'فتح في ProcessHub', portal: 'فتح في بوابة المعرفة' },
};

const FACT_LABELS: Record<string, { en: string; ar: string }> = {
  version: { en: 'Version', ar: 'الإصدار' },
  status: { en: 'Status', ar: 'الحالة' },
  outcome: { en: 'Outcome', ar: 'النتيجة' },
  step: { en: 'Step', ar: 'المرحلة' },
  severity: { en: 'Severity', ar: 'الخطورة' },
  period: { en: 'Period', ar: 'الفترة' },
  value: { en: 'Value', ar: 'القيمة' },
  kind: { en: 'Kind', ar: 'النوع' },
  number: { en: 'Number', ar: 'الرقم' },
  due: { en: 'Due', ar: 'الاستحقاق' },
  created: { en: 'Created', ar: 'أُنشئ' },
  updated: { en: 'Updated', ar: 'حُدّث' },
  failed: { en: 'Failed', ar: 'فشل' },
};

/**
 * Text for an Adaptive Card TextBlock: control and bidi-override characters removed, one line,
 * length limited, and Markdown link syntax broken up (`[text](url)` → `[text] (url)`), so a name
 * cannot turn into a link. Teams shows backslash escapes literally, so nothing else is escaped.
 */
export function cardText(value: unknown, max = 300): string {
  const s = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return cut.replace(/\]\s*\(/g, '] (').replace(/^([-+*#>]|\d+\.)\s/, '$1\u00a0');
}

interface CardInput {
  type: WebhookEventType | 'test';
  entity: WebhookPayload['entity'];
  data: WebhookPayload['data'];
  links: Record<string, string>;
  owner: { nameEn: string; nameAr: string } | null;
}

function section(input: CardInput, lang: 'en' | 'ar') {
  const name = input.entity
    ? lang === 'ar'
      ? input.entity.nameAr || input.entity.nameEn
      : input.entity.nameEn || input.entity.nameAr
    : '';
  const facts = Object.entries(input.data)
    .filter(([k, v]) => FACT_LABELS[k] && v !== null && v !== '')
    .map(([k, v]) => ({ title: FACT_LABELS[k][lang], value: cardText(v, 120) }));
  if (input.owner) {
    const owner =
      lang === 'ar'
        ? input.owner.nameAr || input.owner.nameEn
        : input.owner.nameEn || input.owner.nameAr;
    if (owner) facts.unshift({ title: LABELS[lang].owner, value: cardText(owner, 120) });
  }
  return {
    type: 'Container',
    rtl: lang === 'ar',
    items: [
      {
        type: 'TextBlock',
        text: cardText(TITLES[input.type][lang]),
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      ...(input.entity
        ? [
            {
              type: 'TextBlock',
              text: cardText(input.entity.code ? `${input.entity.code} — ${name}` : name),
              wrap: true,
            },
          ]
        : []),
      ...(facts.length ? [{ type: 'FactSet', facts }] : []),
    ],
  };
}

/**
 * Teams "Workflows" webhook body: a message with one Adaptive Card (1.5: `rtl` for Arabic) — title,
 * item, owner, facts, buttons back to ProcessHub. Every text comes through `cardText`.
 */
export function teamsCard(input: CardInput, language: TeamsLanguage) {
  const langs: ('en' | 'ar')[] =
    language === 'EN' ? ['en'] : language === 'AR' ? ['ar'] : ['en', 'ar'];
  const body = langs.map((l, i) => ({
    ...section(input, l),
    separator: i > 0,
    spacing: i > 0 ? 'Medium' : 'None',
  }));
  const ui = langs[0];
  const actions = [
    { type: 'Action.OpenUrl', title: LABELS[ui].open, url: input.links.app },
    ...(input.links.portal
      ? [{ type: 'Action.OpenUrl', title: LABELS[ui].portal, url: input.links.portal }]
      : []),
  ].filter((a) => /^https?:\/\//.test(a.url ?? ''));
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.5',
          rtl: language === 'AR',
          msteams: { width: 'Full' },
          body,
          actions,
        },
      },
    ],
  };
}
