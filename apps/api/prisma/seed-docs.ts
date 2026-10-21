/**
 * Documentation seed (Phase 2).
 *  - ensureSystemTemplates: the six built-in bilingual templates. Missing ones are created;
 *    templates edited by an administrator are never overwritten.
 *  - seedDocsDemo: two demo spaces with bilingual pages linked to the demo processes, plus a
 *    second process version, so compare and restore can be tried. Runs only when there are
 *    no spaces yet and the demo processes exist.
 */
import type { PrismaClient } from '@prisma/client';
import type { SystemTemplateKey } from '@processhub/shared';
import { htmlToText, sanitizeRichText } from '../src/docs/rich-text';
import { requisitionXml } from './demo-diagrams';

// ---------- Small HTML builders (TipTap-compatible markup) ----------
const h2 = (t: string) => `<h2>${t}</h2>`;
const h3 = (t: string) => `<h3>${t}</h3>`;
const p = (t: string) => `<p>${t}</p>`;
const ul = (items: string[]) => `<ul>${items.map((i) => `<li><p>${i}</p></li>`).join('')}</ul>`;
const ol = (items: string[]) => `<ol>${items.map((i) => `<li><p>${i}</p></li>`).join('')}</ol>`;
const table = (head: string[], rows: string[][]) =>
  `<table><tbody><tr>${head.map((h) => `<th><p>${h}</p></th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
const callout = (type: 'info' | 'note' | 'success' | 'warning' | 'danger', html: string) =>
  `<div data-type="callout" data-callout="${type}">${html}</div>`;
const tasks = (items: [string, boolean][]) =>
  `<ul data-type="taskList">${items
    .map(
      ([t, done]) =>
        `<li data-type="taskItem" data-checked="${done}"><label><input type="checkbox"${done ? ' checked="checked"' : ''}><span></span></label><div><p>${t}</p></div></li>`,
    )
    .join('')}</ul>`;
const diagram = (processId: string) =>
  `<div data-type="bpmn-diagram" data-process-id="${processId}"></div>`;

// ---------- Built-in templates ----------
interface TemplateDef {
  key: SystemTemplateKey;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  contentEn: string;
  contentAr: string;
}

export const SYSTEM_TEMPLATES: TemplateDef[] = [
  {
    key: 'SOP',
    nameEn: 'Standard Operating Procedure (SOP)',
    nameAr: 'إجراء تشغيل قياسي',
    descriptionEn: 'Purpose, scope, responsibilities, step-by-step procedure and records.',
    descriptionAr: 'الغرض والنطاق والمسؤوليات والخطوات التفصيلية والسجلات.',
    contentEn:
      h2('1. Purpose') +
      p('Why this procedure exists and what it achieves.') +
      h2('2. Scope') +
      p('Where the procedure applies and where it does not.') +
      h2('3. Responsibilities') +
      table(
        ['Role', 'Responsibility'],
        [
          ['', ''],
          ['', ''],
        ],
      ) +
      h2('4. Procedure') +
      ol(['First step', 'Second step', 'Third step']) +
      h2('5. Records') +
      ul(['Record and where it is kept']) +
      h2('6. References') +
      ul(['Related policies, forms and processes']) +
      callout(
        'info',
        p('Link the related process in the side panel and embed its diagram with the toolbar.'),
      ),
    contentAr:
      h2('١. الغرض') +
      p('سبب وجود هذا الإجراء وما يحققه.') +
      h2('٢. النطاق') +
      p('أين يُطبق الإجراء وأين لا يُطبق.') +
      h2('٣. المسؤوليات') +
      table(
        ['الدور', 'المسؤولية'],
        [
          ['', ''],
          ['', ''],
        ],
      ) +
      h2('٤. الإجراء') +
      ol(['الخطوة الأولى', 'الخطوة الثانية', 'الخطوة الثالثة']) +
      h2('٥. السجلات') +
      ul(['السجل ومكان حفظه']) +
      h2('٦. المراجع') +
      ul(['السياسات والنماذج والعمليات ذات العلاقة']) +
      callout(
        'info',
        p('اربط العملية ذات العلاقة من اللوحة الجانبية وأدرج مخططها من شريط الأدوات.'),
      ),
  },
  {
    key: 'POLICY',
    nameEn: 'Policy',
    nameAr: 'سياسة',
    descriptionEn: 'Policy statement, principles, compliance and review.',
    descriptionAr: 'بيان السياسة والمبادئ والامتثال والمراجعة.',
    contentEn:
      h2('Policy statement') +
      p('The organisation’s position in one or two sentences.') +
      h2('Purpose and scope') +
      p('Who and what the policy covers.') +
      h2('Principles') +
      ul(['Principle', 'Principle']) +
      h2('Roles and responsibilities') +
      table(['Role', 'Responsibility'], [['', '']]) +
      h2('Compliance') +
      p('How compliance is monitored and what happens on breaches.') +
      callout('note', p('Owner: … · Approved by: … · Next review: …')),
    contentAr:
      h2('بيان السياسة') +
      p('موقف المؤسسة في جملة أو جملتين.') +
      h2('الغرض والنطاق') +
      p('من وما الذي تشمله السياسة.') +
      h2('المبادئ') +
      ul(['مبدأ', 'مبدأ']) +
      h2('الأدوار والمسؤوليات') +
      table(['الدور', 'المسؤولية'], [['', '']]) +
      h2('الامتثال') +
      p('كيف تتم متابعة الامتثال وما الإجراء عند المخالفة.') +
      callout('note', p('المالك: … · اعتمدها: … · المراجعة القادمة: …')),
  },
  {
    key: 'WORK_INSTRUCTION',
    nameEn: 'Work Instruction',
    nameAr: 'تعليمات عمل',
    descriptionEn: 'Detailed steps for one task, with prerequisites and checks.',
    descriptionAr: 'خطوات تفصيلية لمهمة واحدة مع المتطلبات والتحققات.',
    contentEn:
      h2('Task') +
      p('The task these instructions describe.') +
      h2('Before you start') +
      tasks([
        ['Access to the system', false],
        ['Required documents at hand', false],
      ]) +
      h2('Steps') +
      ol(['Step', 'Step', 'Step']) +
      callout('warning', p('Common mistakes and how to avoid them.')) +
      h2('Result') +
      p('What is true when the task is done correctly.'),
    contentAr:
      h2('المهمة') +
      p('المهمة التي تصفها هذه التعليمات.') +
      h2('قبل البدء') +
      tasks([
        ['صلاحية الدخول إلى النظام', false],
        ['توفر المستندات المطلوبة', false],
      ]) +
      h2('الخطوات') +
      ol(['خطوة', 'خطوة', 'خطوة']) +
      callout('warning', p('الأخطاء الشائعة وكيفية تجنبها.')) +
      h2('النتيجة') +
      p('ما يتحقق عند إنجاز المهمة بشكل صحيح.'),
  },
  {
    key: 'GUIDE',
    nameEn: 'Guide',
    nameAr: 'دليل',
    descriptionEn: 'Overview, how-to sections and frequently asked questions.',
    descriptionAr: 'نظرة عامة وأقسام إرشادية وأسئلة شائعة.',
    contentEn:
      h2('Overview') +
      p('What this guide is about and who it is for.') +
      h2('How to …') +
      p('Explain the topic step by step.') +
      h2('Frequently asked questions') +
      h3('Question?') +
      p('Answer.') +
      callout('success', p('Tip: keep sections short and link to detailed procedures.')),
    contentAr:
      h2('نظرة عامة') +
      p('موضوع هذا الدليل والفئة المستهدفة.') +
      h2('كيفية …') +
      p('اشرح الموضوع خطوة بخطوة.') +
      h2('الأسئلة الشائعة') +
      h3('سؤال؟') +
      p('إجابة.') +
      callout('success', p('نصيحة: اجعل الأقسام قصيرة واربطها بالإجراءات التفصيلية.')),
  },
  {
    key: 'MEETING_NOTES',
    nameEn: 'Meeting Notes',
    nameAr: 'محضر اجتماع',
    descriptionEn: 'Date, attendees, agenda, decisions and action items.',
    descriptionAr: 'التاريخ والحضور وجدول الأعمال والقرارات والمهام.',
    contentEn:
      table(['Date', 'Chair', 'Attendees'], [['', '', '']]) +
      h2('Agenda') +
      ol(['Topic']) +
      h2('Discussion and decisions') +
      p('Summary of the discussion and the decisions taken.') +
      h2('Action items') +
      tasks([['Action — owner — due date', false]]),
    contentAr:
      table(['التاريخ', 'الرئيس', 'الحضور'], [['', '', '']]) +
      h2('جدول الأعمال') +
      ol(['موضوع']) +
      h2('النقاش والقرارات') +
      p('ملخص النقاش والقرارات المتخذة.') +
      h2('المهام') +
      tasks([['المهمة — المسؤول — تاريخ الاستحقاق', false]]),
  },
  {
    key: 'BLANK',
    nameEn: 'Blank page',
    nameAr: 'صفحة فارغة',
    descriptionEn: 'Start from an empty page.',
    descriptionAr: 'ابدأ بصفحة فارغة.',
    contentEn: '',
    contentAr: '',
  },
];

export async function ensureSystemTemplates(prisma: PrismaClient): Promise<void> {
  let created = 0;
  for (const [i, t] of SYSTEM_TEMPLATES.entries()) {
    const existing = await prisma.pageTemplate.findUnique({ where: { key: t.key } });
    if (existing) continue;
    await prisma.pageTemplate.create({
      data: {
        ...t,
        contentEn: sanitizeRichText(t.contentEn),
        contentAr: sanitizeRichText(t.contentAr),
        isSystem: true,
        sortOrder: i,
      },
    });
    created++;
  }
  if (created) console.log(`Created ${created} built-in page templates.`);
}

// ---------- Demo spaces and pages ----------
interface VersionDef {
  titleEn: string;
  titleAr: string;
  contentEn: string;
  contentAr: string;
  changeNote: string;
  label?: string;
}

export async function seedDocsDemo(prisma: PrismaClient, adminId: string | null): Promise<void> {
  if ((await prisma.space.count()) > 0) {
    console.log('Documentation spaces exist — skipping documentation demo data.');
    return;
  }
  const byCode = async (code: string) =>
    prisma.process.findFirst({ where: { code, deletedAt: null }, select: { id: true } });
  const [requisition, onboarding, verify, itsm, p2p, risk] = await Promise.all(
    ['S.01.01', 'C.01', 'C.01.01', 'S.03', 'S.01', 'M.03'].map(byCode),
  );
  if (!requisition || !onboarding || !verify || !itsm || !p2p || !risk) {
    console.log('Demo processes not found — skipping documentation demo data.');
    return;
  }
  const obj = async (code: string) =>
    (await prisma.repoObject.findFirst({ where: { code, deletedAt: null }, select: { id: true } }))
      ?.id;
  const dept = async (code: string) =>
    (await prisma.department.findFirst({ where: { code }, select: { id: true } }))?.id ?? null;
  const audit = { createdById: adminId, updatedById: adminId };

  const qm = await prisma.space.create({
    data: {
      key: 'QM',
      nameEn: 'Quality Management',
      nameAr: 'إدارة الجودة',
      descriptionEn: 'Quality manual, procedures and work instructions of the management system.',
      descriptionAr: 'دليل الجودة والإجراءات وتعليمات العمل لنظام الإدارة.',
      icon: 'safety',
      ownerId: adminId,
      departmentId: await dept('RSK'),
      ...audit,
    },
  });
  const itp = await prisma.space.create({
    data: {
      key: 'ITP',
      nameEn: 'IT Policies',
      nameAr: 'سياسات تقنية المعلومات',
      descriptionEn: 'Information security and IT usage policies, guides for staff.',
      descriptionAr: 'سياسات أمن المعلومات واستخدام التقنية وأدلة الموظفين.',
      icon: 'cloud',
      ownerId: adminId,
      departmentId: await dept('IT'),
      ...audit,
    },
  });

  const order = new Map<string, number>();
  const page = async (
    spaceId: string,
    parentId: string | null,
    versions: VersionDef[],
    links: { processes?: string[]; objects?: (string | undefined)[]; embedded?: string[] } = {},
  ) => {
    const k = `${spaceId}:${parentId}`;
    const sortOrder = order.get(k) ?? 0;
    order.set(k, sortOrder + 1);
    const last = versions[versions.length - 1];
    const content = (v: VersionDef) => {
      const contentEn = sanitizeRichText(v.contentEn);
      const contentAr = sanitizeRichText(v.contentAr);
      return {
        titleEn: v.titleEn,
        titleAr: v.titleAr,
        contentEn,
        contentAr,
        dirEn: 'ltr',
        dirAr: 'rtl',
      };
    };
    const current = content(last);
    const created = await prisma.page.create({
      data: {
        spaceId,
        parentId,
        sortOrder,
        ...current,
        textEn: htmlToText(current.contentEn),
        textAr: htmlToText(current.contentAr),
        version: versions.length,
        ...audit,
      },
    });
    for (const [i, v] of versions.entries()) {
      await prisma.pageVersion.create({
        data: {
          pageId: created.id,
          versionNumber: i + 1,
          ...content(v),
          changeNote: v.changeNote,
          label: v.label ?? null,
          createdById: adminId,
          // Spread the demo history over the past weeks.
          createdAt: new Date(Date.now() - (versions.length - i) * 6 * 86_400_000),
        },
      });
    }
    for (const processId of links.processes ?? []) {
      await prisma.pageLink.create({
        data: { pageId: created.id, targetType: 'PROCESS', processId, createdById: adminId },
      });
    }
    for (const processId of links.embedded ?? []) {
      await prisma.pageLink.create({
        data: {
          pageId: created.id,
          targetType: 'PROCESS',
          processId,
          embedded: true,
          createdById: adminId,
        },
      });
    }
    for (const repoObjectId of links.objects ?? []) {
      if (!repoObjectId) continue;
      await prisma.pageLink.create({
        data: { pageId: created.id, targetType: 'OBJECT', repoObjectId, createdById: adminId },
      });
    }
    return created.id;
  };

  // ----- Quality Management -----
  const manual = await page(
    qm.id,
    null,
    [
      {
        titleEn: 'Quality Manual',
        titleAr: 'دليل الجودة',
        changeNote: 'Initial version',
        contentEn:
          h2('Overview') +
          p(
            'This manual describes the quality management system: how processes are defined, documented, reviewed and improved.',
          ) +
          h2('How documentation is organised') +
          ul([
            '<strong>Procedures (SOPs)</strong> describe who does what, and link to the process model.',
            '<strong>Work instructions</strong> explain single tasks step by step.',
            '<strong>Records</strong> are kept in the systems named in each procedure.',
          ]) +
          callout(
            'info',
            p(
              'Every page shows the processes it belongs to. Use the search at the top to find any procedure in English or Arabic.',
            ),
          ),
        contentAr:
          h2('نظرة عامة') +
          p(
            'يصف هذا الدليل نظام إدارة الجودة: كيف يتم تعريف العمليات وتوثيقها ومراجعتها وتحسينها.',
          ) +
          h2('تنظيم الوثائق') +
          ul([
            '<strong>الإجراءات</strong> تحدد من يقوم بماذا، وترتبط بنموذج العملية.',
            '<strong>تعليمات العمل</strong> تشرح المهام الفردية خطوة بخطوة.',
            '<strong>السجلات</strong> تُحفظ في الأنظمة المذكورة في كل إجراء.',
          ]) +
          callout(
            'info',
            p(
              'تعرض كل صفحة العمليات المرتبطة بها. استخدم البحث في الأعلى للعثور على أي إجراء بالعربية أو الإنجليزية.',
            ),
          ),
      },
    ],
    { processes: [risk.id] },
  );

  await page(qm.id, manual, [
    {
      titleEn: 'Document Control Procedure',
      titleAr: 'إجراء ضبط الوثائق',
      changeNote: 'Created from template: SOP',
      contentEn:
        h2('1. Purpose') +
        p('Ensure that only current, approved documents are in use.') +
        h2('2. Scope') +
        p('All policies, procedures, work instructions and forms of the management system.') +
        h2('3. Procedure') +
        ol([
          'The author drafts or updates the document in ProcessHub.',
          'Every explicit save creates a version with a change note.',
          'The process owner reviews the change and labels the approved version.',
        ]) +
        h2('4. Records') +
        ul(['Version history of each page (kept automatically).']),
      contentAr:
        h2('١. الغرض') +
        p('ضمان استخدام الوثائق السارية والمعتمدة فقط.') +
        h2('٢. النطاق') +
        p('جميع السياسات والإجراءات وتعليمات العمل والنماذج في نظام الإدارة.') +
        h2('٣. الإجراء') +
        ol([
          'يقوم الكاتب بإعداد الوثيقة أو تحديثها في بروسس هب.',
          'كل حفظ صريح ينشئ إصدارًا مع ملاحظة التغيير.',
          'يراجع مالك العملية التغيير ويضع وسمًا على الإصدار المعتمد.',
        ]) +
        h2('٤. السجلات') +
        ul(['سجل إصدارات كل صفحة (يُحفظ تلقائيًا).']),
    },
  ]);

  const reqV1: VersionDef = {
    titleEn: 'Purchase Requisition Procedure',
    titleAr: 'إجراء طلب الشراء',
    changeNote: 'Created from template: SOP',
    contentEn:
      h2('1. Purpose') +
      p('Define how employees request goods and services and how requests are approved.') +
      h2('2. Responsibilities') +
      table(
        ['Role', 'Responsibility'],
        [
          ['Requester', 'Creates the purchase requisition in the ERP.'],
          ['Department Manager', 'Reviews and approves or rejects the requisition.'],
          ['Procurement Officer', 'Creates the purchase order.'],
        ],
      ) +
      h2('3. Procedure') +
      ol([
        'Create the requisition in the ERP.',
        'The manager reviews the requisition.',
        'Procurement creates the purchase order.',
      ]) +
      diagram(requisition.id),
    contentAr:
      h2('١. الغرض') +
      p('تحديد كيفية طلب الموظفين للسلع والخدمات وكيفية اعتماد الطلبات.') +
      h2('٢. المسؤوليات') +
      table(
        ['الدور', 'المسؤولية'],
        [
          ['مقدم الطلب', 'ينشئ طلب الشراء في نظام تخطيط الموارد.'],
          ['مدير الإدارة', 'يراجع الطلب ويعتمده أو يرفضه.'],
          ['موظف المشتريات', 'يصدر أمر الشراء.'],
        ],
      ) +
      h2('٣. الإجراء') +
      ol([
        'إنشاء الطلب في نظام تخطيط الموارد.',
        'يراجع المدير الطلب.',
        'تصدر المشتريات أمر الشراء.',
      ]) +
      diagram(requisition.id),
  };
  const reqV2: VersionDef = {
    ...reqV1,
    changeNote: 'Added budget check and approval limits',
    contentEn: reqV1.contentEn.replace(
      ol([
        'Create the requisition in the ERP.',
        'The manager reviews the requisition.',
        'Procurement creates the purchase order.',
      ]),
      ol([
        'Create the requisition in the ERP.',
        'The ERP checks the available budget automatically.',
        'The manager approves the requisition (limits below).',
        'Procurement creates the purchase order.',
      ]) +
        h3('Approval limits') +
        table(
          ['Amount', 'Approver'],
          [
            ['Up to 10,000', 'Department Manager'],
            ['Above 10,000', 'Finance Director'],
          ],
        ),
    ),
    contentAr: reqV1.contentAr.replace(
      ol([
        'إنشاء الطلب في نظام تخطيط الموارد.',
        'يراجع المدير الطلب.',
        'تصدر المشتريات أمر الشراء.',
      ]),
      ol([
        'إنشاء الطلب في نظام تخطيط الموارد.',
        'يتحقق النظام من توفر الميزانية تلقائيًا.',
        'يعتمد المدير الطلب (وفق الحدود أدناه).',
        'تصدر المشتريات أمر الشراء.',
      ]) +
        h3('حدود الاعتماد') +
        table(
          ['المبلغ', 'المعتمد'],
          [
            ['حتى ١٠٬٠٠٠', 'مدير الإدارة'],
            ['أكثر من ١٠٬٠٠٠', 'المدير المالي'],
          ],
        ),
    ),
  };
  const reqV3: VersionDef = {
    ...reqV2,
    changeNote: 'Approved by the quality committee',
    label: 'v1.0 – approved by committee',
    contentEn: reqV2.contentEn + callout('success', p('Approved by the quality committee.')),
    contentAr: reqV2.contentAr + callout('success', p('اعتمدته لجنة الجودة.')),
  };
  await page(qm.id, manual, [reqV1, reqV2, reqV3], {
    embedded: [requisition.id],
    processes: [p2p.id],
    objects: [await obj('R-01'), await obj('R-02'), await obj('R-03'), await obj('SYS-01')],
  });

  await page(
    qm.id,
    manual,
    [
      {
        titleEn: 'Customer Onboarding Work Instruction',
        titleAr: 'تعليمات عمل تسجيل العملاء',
        changeNote: 'Created from template: Work Instruction',
        contentEn:
          h2('Task') +
          p('Register a new customer application and open the account.') +
          h2('Before you start') +
          tasks([
            ['Signed application form received', true],
            ['Copy of identity document attached', false],
          ]) +
          h2('Steps') +
          ol([
            'Register the application in the CRM.',
            'Start the identity verification (KYC).',
            'Open the account in core banking.',
            'Send the welcome pack.',
          ]) +
          callout('warning', p('Never open the account before the verification is completed.')) +
          diagram(onboarding.id),
        contentAr:
          h2('المهمة') +
          p('تسجيل طلب عميل جديد وفتح الحساب.') +
          h2('قبل البدء') +
          tasks([
            ['استلام نموذج الطلب موقعًا', true],
            ['إرفاق صورة وثيقة الهوية', false],
          ]) +
          h2('الخطوات') +
          ol([
            'تسجيل الطلب في نظام إدارة علاقات العملاء.',
            'بدء التحقق من الهوية.',
            'فتح الحساب في النظام المصرفي.',
            'إرسال حزمة الترحيب.',
          ]) +
          callout('warning', p('لا تفتح الحساب قبل اكتمال التحقق.')) +
          diagram(onboarding.id),
      },
    ],
    {
      embedded: [onboarding.id],
      processes: [verify.id],
      objects: [await obj('R-05'), await obj('SYS-02'), await obj('SYS-04')],
    },
  );

  await page(qm.id, null, [
    {
      titleEn: 'Management Review — Q3 Meeting Notes',
      titleAr: 'محضر مراجعة الإدارة — الربع الثالث',
      changeNote: 'Created from template: Meeting Notes',
      contentEn:
        table(
          ['Date', 'Chair', 'Attendees'],
          [['30 September', 'CEO', 'Quality, Finance, IT, Customer Services']],
        ) +
        h2('Decisions') +
        ul([
          'The purchase requisition procedure adds an automatic budget check.',
          'KYC turnaround target: 2 working days.',
        ]) +
        h2('Action items') +
        tasks([
          ['Update the Purchase Requisition Procedure — Quality', true],
          ['Report onboarding turnaround monthly — Customer Services', false],
        ]),
      contentAr:
        table(
          ['التاريخ', 'الرئيس', 'الحضور'],
          [['٣٠ سبتمبر', 'الرئيس التنفيذي', 'الجودة، المالية، التقنية، خدمات العملاء']],
        ) +
        h2('القرارات') +
        ul([
          'إضافة تحقق تلقائي من الميزانية إلى إجراء طلب الشراء.',
          'هدف زمن التحقق من الهوية: يوما عمل.',
        ]) +
        h2('المهام') +
        tasks([
          ['تحديث إجراء طلب الشراء — الجودة', true],
          ['تقرير شهري عن زمن تسجيل العملاء — خدمات العملاء', false],
        ]),
    },
  ]);

  // ----- IT Policies -----
  const security = await page(
    itp.id,
    null,
    [
      {
        titleEn: 'Information Security Policy',
        titleAr: 'سياسة أمن المعلومات',
        changeNote: 'Created from template: Policy',
        contentEn:
          h2('Policy statement') +
          p(
            'Information is protected against loss of confidentiality, integrity and availability.',
          ) +
          h2('Principles') +
          ul([
            'Access is granted on a need-to-know basis.',
            'Passwords are personal and never shared.',
            'Security incidents are reported immediately to the IT service desk.',
          ]) +
          h2('Compliance') +
          p('Breaches may lead to disciplinary action.') +
          callout('note', p('Owner: IT · Next review: annually')),
        contentAr:
          h2('بيان السياسة') +
          p('تتم حماية المعلومات من فقدان السرية والسلامة والتوافر.') +
          h2('المبادئ') +
          ul([
            'تُمنح الصلاحيات حسب الحاجة إلى المعرفة.',
            'كلمات المرور شخصية ولا تتم مشاركتها.',
            'يتم الإبلاغ عن الحوادث الأمنية فورًا لمكتب خدمات تقنية المعلومات.',
          ]) +
          h2('الامتثال') +
          p('قد تؤدي المخالفات إلى إجراءات تأديبية.') +
          callout('note', p('المالك: تقنية المعلومات · المراجعة: سنويًا')),
      },
    ],
    { processes: [risk.id, itsm.id] },
  );

  await page(
    itp.id,
    security,
    [
      {
        titleEn: 'Acceptable Use Policy',
        titleAr: 'سياسة الاستخدام المقبول',
        changeNote: 'Created from template: Policy',
        contentEn:
          h2('Policy statement') +
          p('Company IT resources are used for business purposes, lawfully and responsibly.') +
          h2('Rules') +
          ul([
            'Do not install unapproved software.',
            'Use company email for business communication only.',
            'Lock your screen when you leave your desk.',
          ]),
        contentAr:
          h2('بيان السياسة') +
          p('تُستخدم موارد تقنية المعلومات لأغراض العمل وبشكل قانوني ومسؤول.') +
          h2('القواعد') +
          ul([
            'لا تقم بتثبيت برامج غير معتمدة.',
            'استخدم البريد الإلكتروني للعمل فقط.',
            'اقفل الشاشة عند مغادرة مكتبك.',
          ]),
      },
    ],
    { objects: [await obj('SYS-03')] },
  );

  await page(
    itp.id,
    null,
    [
      {
        titleEn: 'IT Service Desk Guide',
        titleAr: 'دليل مكتب خدمات تقنية المعلومات',
        changeNote: 'Created from template: Guide',
        contentEn:
          h2('Overview') +
          p('How to get help with IT incidents and requests.') +
          h2('How to raise a ticket') +
          ol([
            'Open the service portal or send an email to the service desk.',
            'Describe the problem and its impact.',
            'Note the ticket number for follow-up.',
          ]) +
          h2('Frequently asked questions') +
          h3('How fast will I get an answer?') +
          p('Critical incidents within 1 hour, other requests within 1 working day.') +
          callout('success', p('Tip: attach a screenshot — it speeds up the resolution.')),
        contentAr:
          h2('نظرة عامة') +
          p('كيفية الحصول على المساعدة في حوادث وطلبات تقنية المعلومات.') +
          h2('كيفية فتح تذكرة') +
          ol([
            'افتح بوابة الخدمات أو أرسل بريدًا إلى مكتب الخدمات.',
            'صف المشكلة وأثرها.',
            'احتفظ برقم التذكرة للمتابعة.',
          ]) +
          h2('الأسئلة الشائعة') +
          h3('متى سأحصل على رد؟') +
          p('الحوادث الحرجة خلال ساعة، والطلبات الأخرى خلال يوم عمل.') +
          callout('success', p('نصيحة: أرفق صورة للشاشة لتسريع الحل.')),
      },
    ],
    { processes: [itsm.id], objects: [await obj('SYS-03')] },
  );

  // ----- Second version of the Purchase Requisition model (compare / restore demo) -----
  const reqVersions = await prisma.processVersion.count({ where: { processId: requisition.id } });
  if (reqVersions === 1) {
    const xml = requisitionXml(true);
    await prisma.processModel.update({
      where: { processId: requisition.id },
      data: { bpmnXml: xml, updatedById: adminId },
    });
    await prisma.processVersion.create({
      data: {
        processId: requisition.id,
        versionNumber: 2,
        bpmnXml: xml,
        changeNote: 'Added automatic budget check before approval',
        createdById: adminId,
      },
    });
    await prisma.processVersion.updateMany({
      where: { processId: requisition.id, versionNumber: 1 },
      data: { label: 'v1.0 – approved by committee' },
    });
  }

  console.log('Seeded 2 documentation spaces with 8 bilingual pages and a second process version.');
}
