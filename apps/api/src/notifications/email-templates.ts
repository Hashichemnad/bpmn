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
  };
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
