import type { Locale, NotificationType } from '@processhub/shared';

/** Values available to the templates (both languages; the recipient's is picked). */
export type NotificationParams = Record<string, string | number>;

interface Template {
  subject: string;
  body: string;
}

/**
 * Bilingual email templates. `{title}`, `{actor}`, `{step}` are taken in the recipient's
 * language from `titleEn/titleAr`, `actorEn/actorAr`, `stepEn/stepAr`; other placeholders
 * (`{version}`, `{comment}`, `{due}`, `{status}`, `{reply}`) are used as they are.
 */
/** Phase 4.2 types: subject and text come from KIND_TEMPLATES by `params.kind`. */
const BY_KIND = { subject: '{kindSubject}', body: '{kindBody}' };

const TEMPLATES: Record<Locale, Record<NotificationType, Template>> = {
  en: {
    REVIEW_REQUESTED: {
      subject: 'Review requested: {title}',
      body: '{actor} asked you to review “{title}” (version {version}). Step: {step}.',
    },
    CHANGES_REQUESTED: {
      subject: 'Changes requested: {title}',
      body: '{actor} requested changes to “{title}”: {comment}',
    },
    REJECTED: {
      subject: 'Rejected: {title}',
      body: '{actor} rejected “{title}”: {comment}',
    },
    APPROVED: {
      subject: 'Approved: {title}',
      body: '“{title}” (version {version}) has been approved and can now be published.',
    },
    PUBLISHED: {
      subject: 'Published: {title}',
      body: '{actor} published “{title}” (version {version}). It is now the official version in the Knowledge Portal.',
    },
    MENTIONED: {
      subject: '{actor} mentioned you on “{title}”',
      body: '{actor} mentioned you in a comment on “{title}”: {comment}',
    },
    COMMENT_REPLY: {
      subject: 'New reply on “{title}”',
      body: '{actor} replied in a discussion on “{title}”: {comment}',
    },
    REVIEW_OVERDUE: {
      subject: 'Overdue: {title}',
      body: '{overdue}',
    },
    REVIEW_DUE: {
      subject: 'Periodic review due: {title}',
      body: '“{title}” is due for its periodic review on {due}. Please check that the content is still correct.',
    },
    FEEDBACK_RECEIVED: {
      subject: 'New feedback on “{title}”',
      body: '{actor} sent feedback ({kind}) on “{title}”: {comment}',
    },
    FEEDBACK_UPDATED: {
      subject: 'Your feedback on “{title}” was updated',
      body: 'Status: {status}. {reply}',
    },
    GRC_REVIEW: {
      subject: 'Risk & Compliance review due: {code} {title}',
      body: '“{title}” is due for review on {due}. Please reassess it in Risk & Compliance.',
    },
    GRC_CHANGE: BY_KIND,
    CONTROL_TEST: BY_KIND,
    ISSUE: BY_KIND,
    AUDIT: BY_KIND,
  },
  ar: {
    REVIEW_REQUESTED: {
      subject: 'طلب مراجعة: {title}',
      body: 'طلب منك {actor} مراجعة «{title}» (الإصدار {version}). المرحلة: {step}.',
    },
    CHANGES_REQUESTED: {
      subject: 'مطلوب تعديلات: {title}',
      body: 'طلب {actor} تعديلات على «{title}»: {comment}',
    },
    REJECTED: {
      subject: 'مرفوض: {title}',
      body: 'رفض {actor} «{title}»: {comment}',
    },
    APPROVED: {
      subject: 'تم الاعتماد: {title}',
      body: 'تم اعتماد «{title}» (الإصدار {version}) ويمكن نشره الآن.',
    },
    PUBLISHED: {
      subject: 'تم النشر: {title}',
      body: 'نشر {actor} «{title}» (الإصدار {version}). أصبح الآن الإصدار الرسمي في بوابة المعرفة.',
    },
    MENTIONED: {
      subject: 'أشار إليك {actor} في «{title}»',
      body: 'أشار إليك {actor} في تعليق على «{title}»: {comment}',
    },
    COMMENT_REPLY: {
      subject: 'رد جديد على «{title}»',
      body: 'رد {actor} في نقاش حول «{title}»: {comment}',
    },
    REVIEW_OVERDUE: {
      subject: 'متأخر: {title}',
      body: '{overdue}',
    },
    REVIEW_DUE: {
      subject: 'موعد المراجعة الدورية: {title}',
      body: 'موعد المراجعة الدورية لـ «{title}» هو {due}. يرجى التأكد من أن المحتوى ما زال صحيحاً.',
    },
    FEEDBACK_RECEIVED: {
      subject: 'ملاحظة جديدة على «{title}»',
      body: 'أرسل {actor} ملاحظة ({kind}) على «{title}»: {comment}',
    },
    FEEDBACK_UPDATED: {
      subject: 'تم تحديث ملاحظتك على «{title}»',
      body: 'الحالة: {status}. {reply}',
    },
    GRC_REVIEW: {
      subject: 'موعد مراجعة المخاطر والامتثال: {code} {title}',
      body: 'موعد مراجعة «{title}» هو {due}. يرجى إعادة تقييمه في قسم المخاطر والامتثال.',
    },
    GRC_CHANGE: BY_KIND,
    CONTROL_TEST: BY_KIND,
    ISSUE: BY_KIND,
    AUDIT: BY_KIND,
  },
};

/**
 * Phase 4.2 notification types share one template each; the text depends on `params.kind`
 * (e.g. GRC_CHANGE requested / approved / rejected).
 */
export const KIND_TEMPLATES: Record<Locale, Record<string, { subject: string; body: string }>> = {
  en: {
    'GRC_CHANGE:requested': {
      subject: 'Approval requested: change of {title}',
      body: '{actor} proposed a change of “{title}” ({step}). The current values stay in force until it is approved.',
    },
    'GRC_CHANGE:approved': {
      subject: 'Change approved: {title}',
      body: 'The proposed change of “{title}” was approved and is now in force.',
    },
    'GRC_CHANGE:rejected': {
      subject: 'Change rejected: {title}',
      body: '{actor} rejected the proposed change of “{title}”. {comment}',
    },
    'CONTROL_TEST:assigned': {
      subject: 'Control test {period}: {title}',
      body: 'A test of the control “{title}” ({period}) is assigned to you, due on {due}.',
    },
    'CONTROL_TEST:due': {
      subject: 'Control test due on {due}: {title}',
      body: 'The test of “{title}” ({period}) is due on {due}.',
    },
    'CONTROL_TEST:overdue': {
      subject: 'Control test overdue: {title}',
      body: 'The test of “{title}” ({period}) was due on {due} and is not submitted yet.',
    },
    'CONTROL_TEST:submitted': {
      subject: 'Control test to review: {title}',
      body: '{actor} submitted the test of “{title}” ({period}) for your review.',
    },
    'CONTROL_TEST:returned': {
      subject: 'Control test returned: {title}',
      body: '{actor} returned the test of “{title}” ({period}): {comment}',
    },
    'CONTROL_TEST:reviewed': {
      subject: 'Control test reviewed: {title}',
      body: 'The test of “{title}” ({period}) was reviewed. Conclusion: {conclusion}.',
    },
    'ISSUE:assigned': {
      subject: 'Issue assigned to you: {title}',
      body: 'The issue “{title}” is assigned to you. Due: {due}.',
    },
    'ISSUE:action_assigned': {
      subject: 'Action assigned to you: {step}',
      body: 'The action “{step}” of the issue “{title}” is assigned to you. Due: {due}.',
    },
    'ISSUE:ready': {
      subject: 'Issue ready for verification: {title}',
      body: 'The owner reports that the issue “{title}” is fixed. Please verify it.',
    },
    'ISSUE:closed': {
      subject: 'Issue closed: {title}',
      body: '{actor} verified the fix and closed the issue “{title}”.',
    },
    'ISSUE:returned': {
      subject: 'Issue verification rejected: {title}',
      body: '{actor} did not accept the fix of “{title}”: {comment}',
    },
    'ISSUE:accepted': {
      subject: 'Risk accepted: {title}',
      body: '{actor} accepted the risk of the issue “{title}”: {comment}',
    },
    'ISSUE:reopened': {
      subject: 'Issue reopened: {title}',
      body: '{actor} reopened the issue “{title}”: {comment}',
    },
    'ISSUE:due': {
      subject: 'Issue due on {due}: {title}',
      body: 'The issue “{title}” is due on {due}.',
    },
    'ISSUE:overdue': {
      subject: 'Issue overdue: {title}',
      body: 'The issue “{title}” was due on {due} and is still open.',
    },
    'ISSUE:escalated': {
      subject: 'Escalation: overdue issue {title}',
      body: 'The issue “{title}” was due on {due} and is still open. You receive this escalation as the owner’s manager or as Risk & Compliance.',
    },
    'ISSUE:action_due': {
      subject: 'Action due on {due}: {step}',
      body: 'The action “{step}” of the issue “{title}” is due on {due}.',
    },
    'ISSUE:action_overdue': {
      subject: 'Action overdue: {step}',
      body: 'The action “{step}” of the issue “{title}” was due on {due}.',
    },
    'ISSUE:action_escalated': {
      subject: 'Escalation: overdue action {step}',
      body: 'The action “{step}” of the issue “{title}” was due on {due} and is not done.',
    },
    'AUDIT:team': {
      subject: 'Audit engagement: {title}',
      body: 'You are on the team of the audit engagement “{title}”.',
    },
    'AUDIT:response': {
      subject: 'Management response requested: {title}',
      body: 'Please respond to the audit finding “{title}”: agree with an action and a target date, or explain why not.',
    },
    'AUDIT:agreed': {
      subject: 'Finding agreed: {title}',
      body: '{actor} agreed to the audit finding “{title}”; an issue with the action was created.',
    },
    'AUDIT:disagreed': {
      subject: 'Finding not agreed: {title}',
      body: '{actor} did not agree to the audit finding “{title}”: {comment}',
    },
  },
  ar: {
    'GRC_CHANGE:requested': {
      subject: 'طلب اعتماد: تعديل {title}',
      body: 'اقترح {actor} تعديل «{title}» ({step}). تبقى القيم الحالية سارية حتى الاعتماد.',
    },
    'GRC_CHANGE:approved': {
      subject: 'تم اعتماد التعديل: {title}',
      body: 'تم اعتماد التعديل المقترح على «{title}» وأصبح ساريًا.',
    },
    'GRC_CHANGE:rejected': {
      subject: 'رُفض التعديل: {title}',
      body: 'رفض {actor} التعديل المقترح على «{title}». {comment}',
    },
    'CONTROL_TEST:assigned': {
      subject: 'اختبار الضابط {period}: {title}',
      body: 'أُسند إليك اختبار الضابط «{title}» ({period})، موعده {due}.',
    },
    'CONTROL_TEST:due': {
      subject: 'موعد اختبار الضابط {due}: {title}',
      body: 'موعد اختبار «{title}» ({period}) هو {due}.',
    },
    'CONTROL_TEST:overdue': {
      subject: 'اختبار ضابط متأخر: {title}',
      body: 'كان موعد اختبار «{title}» ({period}) في {due} ولم يُقدَّم بعد.',
    },
    'CONTROL_TEST:submitted': {
      subject: 'اختبار ضابط للمراجعة: {title}',
      body: 'قدّم {actor} اختبار «{title}» ({period}) لمراجعتك.',
    },
    'CONTROL_TEST:returned': {
      subject: 'أُعيد اختبار الضابط: {title}',
      body: 'أعاد {actor} اختبار «{title}» ({period}): {comment}',
    },
    'CONTROL_TEST:reviewed': {
      subject: 'تمت مراجعة اختبار الضابط: {title}',
      body: 'تمت مراجعة اختبار «{title}» ({period}). النتيجة: {conclusion}.',
    },
    'ISSUE:assigned': {
      subject: 'أُسندت إليك ملاحظة: {title}',
      body: 'أُسندت إليك الملاحظة «{title}». الموعد: {due}.',
    },
    'ISSUE:action_assigned': {
      subject: 'أُسند إليك إجراء: {step}',
      body: 'أُسند إليك الإجراء «{step}» من الملاحظة «{title}». الموعد: {due}.',
    },
    'ISSUE:ready': {
      subject: 'ملاحظة جاهزة للتحقق: {title}',
      body: 'أفاد المالك بمعالجة الملاحظة «{title}». يرجى التحقق منها.',
    },
    'ISSUE:closed': {
      subject: 'أُغلقت الملاحظة: {title}',
      body: 'تحقق {actor} من المعالجة وأغلق الملاحظة «{title}».',
    },
    'ISSUE:returned': {
      subject: 'رُفض التحقق: {title}',
      body: 'لم يقبل {actor} معالجة «{title}»: {comment}',
    },
    'ISSUE:accepted': {
      subject: 'تم قبول المخاطر: {title}',
      body: 'قبل {actor} مخاطر الملاحظة «{title}»: {comment}',
    },
    'ISSUE:reopened': {
      subject: 'أُعيد فتح الملاحظة: {title}',
      body: 'أعاد {actor} فتح الملاحظة «{title}»: {comment}',
    },
    'ISSUE:due': {
      subject: 'موعد الملاحظة {due}: {title}',
      body: 'موعد الملاحظة «{title}» هو {due}.',
    },
    'ISSUE:overdue': {
      subject: 'ملاحظة متأخرة: {title}',
      body: 'كان موعد الملاحظة «{title}» في {due} وما زالت مفتوحة.',
    },
    'ISSUE:escalated': {
      subject: 'تصعيد: ملاحظة متأخرة {title}',
      body: 'كان موعد الملاحظة «{title}» في {due} وما زالت مفتوحة. تصلك هذه الرسالة بصفتك مدير المالك أو من المخاطر والامتثال.',
    },
    'ISSUE:action_due': {
      subject: 'موعد الإجراء {due}: {step}',
      body: 'موعد الإجراء «{step}» من الملاحظة «{title}» هو {due}.',
    },
    'ISSUE:action_overdue': {
      subject: 'إجراء متأخر: {step}',
      body: 'كان موعد الإجراء «{step}» من الملاحظة «{title}» في {due}.',
    },
    'ISSUE:action_escalated': {
      subject: 'تصعيد: إجراء متأخر {step}',
      body: 'كان موعد الإجراء «{step}» من الملاحظة «{title}» في {due} ولم يُنجز.',
    },
    'AUDIT:team': {
      subject: 'مهمة تدقيق: {title}',
      body: 'أنت ضمن فريق مهمة التدقيق «{title}».',
    },
    'AUDIT:response': {
      subject: 'مطلوب رد الإدارة: {title}',
      body: 'يرجى الرد على نتيجة التدقيق «{title}»: الموافقة مع إجراء وتاريخ مستهدف، أو توضيح سبب عدم الموافقة.',
    },
    'AUDIT:agreed': {
      subject: 'تمت الموافقة على النتيجة: {title}',
      body: 'وافق {actor} على نتيجة التدقيق «{title}»، وأُنشئت ملاحظة بالإجراء.',
    },
    'AUDIT:disagreed': {
      subject: 'لم تتم الموافقة على النتيجة: {title}',
      body: 'لم يوافق {actor} على نتيجة التدقيق «{title}»: {comment}',
    },
  },
};

const CONCLUSIONS: Record<Locale, Record<string, string>> = {
  en: {
    EFFECTIVE: 'effective',
    EFFECTIVE_WITH_EXCEPTIONS: 'effective with exceptions',
    NOT_EFFECTIVE: 'not effective',
  },
  ar: {
    EFFECTIVE: 'فعال',
    EFFECTIVE_WITH_EXCEPTIONS: 'فعال مع استثناءات',
    NOT_EFFECTIVE: 'غير فعال',
  },
};

const OVERDUE: Record<Locale, { task: string; periodic: string }> = {
  en: {
    task: 'Your review of “{title}” was due on {due} and is still waiting for your decision.',
    periodic: 'The periodic review of “{title}” was due on {due}. Please review the content.',
  },
  ar: {
    task: 'كان موعد مراجعتك لـ «{title}» في {due} وما زالت بانتظار قرارك.',
    periodic: 'كان موعد المراجعة الدورية لـ «{title}» في {due}. يرجى مراجعة المحتوى.',
  },
};

const LABELS: Record<Locale, Record<string, string>> = {
  en: {
    open: 'Open in ProcessHub',
    footer: 'You receive this email because of your notification settings in ProcessHub.',
    IMPROVEMENT: 'suggestion',
    OUTDATED: 'outdated content',
    OPEN: 'Open',
    IN_PROGRESS: 'In progress',
    DONE: 'Done',
    testSubject: 'ProcessHub test email',
    testBody: 'Email delivery from ProcessHub works.',
  },
  ar: {
    open: 'فتح في بروسس هب',
    footer: 'تصلك هذه الرسالة بحسب إعدادات الإشعارات في بروسس هب.',
    IMPROVEMENT: 'اقتراح',
    OUTDATED: 'محتوى قديم',
    OPEN: 'مفتوحة',
    IN_PROGRESS: 'قيد المعالجة',
    DONE: 'تمت',
    testSubject: 'رسالة اختبار من بروسس هب',
    testBody: 'إرسال البريد من بروسس هب يعمل.',
  },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pick = (p: NotificationParams, field: string, locale: Locale) => {
  const en = String(p[`${field}En`] ?? '');
  const ar = String(p[`${field}Ar`] ?? '');
  return (locale === 'ar' ? ar || en : en || ar) || String(p[field] ?? '');
};

function formatDate(value: string | number | undefined, locale: Locale) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'long' }).format(d);
}

/** Text values for every placeholder in the recipient's language (not escaped). */
export function templateValues(
  type: NotificationType,
  params: NotificationParams,
  locale: Locale,
): Record<string, string> {
  const labels = LABELS[locale];
  const code = params.code ? `${String(params.code)} ` : '';
  const values: Record<string, string> = {
    title: `${code}${pick(params, 'title', locale)}`.trim(),
    actor: pick(params, 'actor', locale),
    step: pick(params, 'step', locale),
    version: String(params.version ?? ''),
    comment: String(params.comment ?? ''),
    due: formatDate(params.due, locale),
    status: labels[String(params.status ?? '')] ?? String(params.status ?? ''),
    kind: labels[String(params.kind ?? '')] ?? String(params.kind ?? ''),
    reply: String(params.reply ?? ''),
    period: String(params.period ?? ''),
    conclusion:
      CONCLUSIONS[locale][String(params.conclusion ?? '')] ?? String(params.conclusion ?? ''),
  };
  const kindTpl = KIND_TEMPLATES[locale][`${type}:${String(params.kind ?? '')}`];
  // Unknown kinds fall back to the item's title (never an empty e-mail).
  values.kindSubject = kindTpl ? fill(kindTpl.subject, values) : values.title;
  values.kindBody = kindTpl ? fill(kindTpl.body, values) : values.title;
  if (type === 'REVIEW_OVERDUE') {
    values.overdue = fill(
      OVERDUE[locale][params.kind === 'periodic' ? 'periodic' : 'task'],
      values,
    );
  }
  return values;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');

function layout(locale: Locale, heading: string, paragraph: string, url: string | null) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const font =
    locale === 'ar'
      ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif"
      : 'Inter, Arial, sans-serif';
  const button = url
    ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(LABELS[locale].open)}</a></p>`
    : '';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f1f5f9;font-family:${font}">
<div dir="${dir}" style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;padding:24px;color:#0f172a;text-align:${dir === 'rtl' ? 'right' : 'left'}">
<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(heading)}</h2>
<p style="margin:0;line-height:1.6;white-space:pre-wrap">${escapeHtml(paragraph)}</p>
${button}
<p style="margin:24px 0 0;color:#64748b;font-size:12px">${escapeHtml(LABELS[locale].footer)}</p>
</div></body></html>`;
}

/** Subject, HTML and plain-text body of a notification email in the recipient's language. */
export function renderEmail(
  type: NotificationType,
  params: NotificationParams,
  locale: Locale,
  url: string | null,
) {
  const tpl = TEMPLATES[locale][type];
  const values = templateValues(type, params, locale);
  const subject = fill(tpl.subject, values).replace(/\s+/g, ' ').trim();
  const body = fill(tpl.body, values).trim();
  return {
    subject,
    html: layout(locale, subject, body, url),
    text: `${body}${url ? `\n\n${LABELS[locale].open}: ${url}` : ''}\n\n${LABELS[locale].footer}\n`,
  };
}

export function renderTestEmail(locale: Locale) {
  const l = LABELS[locale];
  return {
    subject: l.testSubject,
    html: layout(locale, l.testSubject, l.testBody, null),
    text: l.testBody,
  };
}
