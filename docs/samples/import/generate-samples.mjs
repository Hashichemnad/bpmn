// Generates the invented sample files of the Import Center (docs/samples/import/README.md).
/* global Buffer, process */
// Run from the repository root: node docs/samples/import/generate-samples.mjs
// Uses the API's dependencies (exceljs, jszip, docx). All names and texts are invented.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../apps/api/package.json'));
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const docx = require('docx');
const out = (name, data) => writeFileSync(join(here, name), data);

// A 2×2 PNG (blue) used as an embedded image / attachment.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPjPwMDAxMDAwMDAAAAJcQEB9wE8UAAAAABJRU5ErkJggg==',
  'base64',
);

async function workbook(sheet, header, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  header.forEach((_, i) => (ws.getColumn(i + 1).width = 26));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Structure ----------
out(
  'departments.xlsx',
  await workbook(
    'Departments',
    [
      'Department code',
      'Name (English)',
      'Name (Arabic)',
      'Parent department code',
      'Head (e-mail)',
    ],
    [
      ['DGO', 'Director General Office', 'مكتب المدير العام', '', ''],
      ['CSD', 'Customer Services', 'خدمات المتعاملين', 'DGO', ''],
      ['PRC', 'Procurement', 'المشتريات', 'DGO', ''],
      ['HRD', 'Human Resources', 'الموارد البشرية', 'DGO', ''],
    ],
  ),
);
out(
  'process-house.xlsx',
  await workbook(
    'Process house',
    [
      'Process code',
      'Name (English)',
      'Name (Arabic)',
      'Description (English)',
      'Category',
      'Parent code',
      'Level',
      'Owner (e-mail)',
      'Department (code or name)',
      'Sort order',
    ],
    [
      [
        'M',
        'Management processes',
        'العمليات الإدارية',
        'Strategy and governance',
        'Management',
        '',
        1,
        '',
        'DGO',
        1,
      ],
      ['M.01', 'Strategic planning', 'التخطيط الاستراتيجي', '', '', 'M', 2, '', 'DGO', 1],
      [
        'C',
        'Core processes',
        'العمليات الرئيسية',
        'Services to customers',
        'Core',
        '',
        1,
        '',
        '',
        2,
      ],
      ['C.01', 'Customer services', 'خدمات المتعاملين', '', '', 'C', 2, '', 'CSD', 1],
      ['C.01.01', 'Handle enquiries', 'معالجة الاستفسارات', '', '', 'C.01', 3, '', 'CSD', 1],
      ['C.01.02', 'Register requests', 'تسجيل الطلبات', '', '', 'C.01', 3, '', 'CSD', 2],
      ['S', 'Support processes', 'العمليات المساندة', '', 'Support', '', 1, '', '', 3],
      ['S.02', 'Supplier onboarding', 'تسجيل الموردين', '', '', 'S', 2, '', 'PRC', 1],
      ['S.03', 'Recruitment', 'التوظيف', '', '', 'S', 2, '', 'HRD', 2],
    ],
  ),
);
out(
  'users.xlsx',
  await workbook(
    'Users',
    [
      'E-mail',
      'Name (English)',
      'Name (Arabic)',
      'Department (code or name)',
      'Roles (separated by ;)',
      'Job roles (separated by ;)',
      'Language (en / ar)',
    ],
    [
      ['layla.hassan@example.org', 'Layla Hassan', 'ليلى حسن', 'CSD', 'PROCESS_OWNER', '', 'ar'],
      ['omar.saleh@example.org', 'Omar Saleh', 'عمر صالح', 'PRC', 'MODELER', '', 'en'],
      ['nadia.karim@example.org', 'Nadia Karim', 'نادية كريم', 'HRD', 'REVIEWER', '', 'ar'],
    ],
  ),
);

// ---------- BPMN ZIP ----------
const BPMN_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
const shape = (id, x, y, w = 100, h = 80) =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/></bpmndi:BPMNShape>`;
const edge = (id, pts) =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}"/>`).join('')}</bpmndi:BPMNEdge>`;

function linearBpmn(id, name, steps, lane) {
  const ids = ['Start', ...steps.map((_, i) => `Task_${i + 1}`), 'End'];
  const nodes = [
    `<bpmn:startEvent id="Start" name="${lane.start}"/>`,
    ...steps.map((s, i) => `<bpmn:userTask id="Task_${i + 1}" name="${s}"/>`),
    `<bpmn:endEvent id="End" name="${lane.end}"/>`,
  ];
  const flows = ids
    .slice(1)
    .map(
      (to, i) => `<bpmn:sequenceFlow id="Flow_${i + 1}" sourceRef="${ids[i]}" targetRef="${to}"/>`,
    );
  const x = (i) => 180 + i * 160;
  const shapes = ids.map((n, i) =>
    n === 'Start' || n === 'End' ? shape(n, x(i) + 32, 182, 36, 36) : shape(n, x(i), 160),
  );
  const edges = ids.slice(1).map((_, i) =>
    edge(`Flow_${i + 1}`, [
      [x(i) + 100, 200],
      [x(i + 1), 200],
    ]),
  );
  return `${BPMN_HEAD} xmlns:signavio="http://www.signavio.com" id="Defs_${id}" targetNamespace="http://example.org/bpmn">
  <bpmn:collaboration id="Collab_${id}"><bpmn:participant id="Pool_${id}" name="${name}" processRef="Process_${id}"/></bpmn:collaboration>
  <bpmn:process id="Process_${id}" isExecutable="false">
    <bpmn:extensionElements><signavio:signavioMetaData metaKey="bgcolor" metaValue="#ffffff"/></bpmn:extensionElements>
    <bpmn:laneSet id="LaneSet_${id}"><bpmn:lane id="Lane_${id}" name="${lane.name}">${ids.map((n) => `<bpmn:flowNodeRef>${n}</bpmn:flowNodeRef>`).join('')}</bpmn:lane></bpmn:laneSet>
    ${nodes.join('\n    ')}
    ${flows.join('\n    ')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${id}"><bpmndi:BPMNPlane id="Plane_${id}" bpmnElement="Collab_${id}">
    ${shape(`Pool_${id}`, 120, 100, 160 * ids.length + 60, 200)}
    ${shape(`Lane_${id}`, 150, 100, 160 * ids.length + 30, 200)}
    ${shapes.join('\n    ')}
    ${edges.join('\n    ')}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

const noLayout = `${BPMN_HEAD} xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Defs_S02" targetNamespace="http://example.org/bpmn">
  <bpmn:process id="Process_S02" name="Supplier onboarding" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:laneSet id="LaneSet_S02">
      <bpmn:lane id="Lane_Officer" name="Procurement Officer"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>Complete</bpmn:flowNodeRef><bpmn:flowNodeRef>Register</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane_Manager" name="Procurement Manager"><bpmn:flowNodeRef>Approve</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start" name="Supplier application received"/>
    <bpmn:userTask id="Check" name="Check supplier documents" camunda:assignee="officer"/>
    <bpmn:exclusiveGateway id="Complete" name="Documents complete?"/>
    <bpmn:userTask id="Approve" name="Approve supplier"/>
    <bpmn:serviceTask id="Register" name="Register supplier in ERP" camunda:type="external" camunda:topic="erp"/>
    <bpmn:endEvent id="End" name="Supplier registered"/>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Check"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Check" targetRef="Complete"/>
    <bpmn:sequenceFlow id="F3" name="Yes" sourceRef="Complete" targetRef="Approve"/>
    <bpmn:sequenceFlow id="F4" name="No" sourceRef="Complete" targetRef="Check"/>
    <bpmn:sequenceFlow id="F5" sourceRef="Approve" targetRef="Register"/>
    <bpmn:sequenceFlow id="F6" sourceRef="Register" targetRef="End"/>
  </bpmn:process>
</bpmn:definitions>
`;
const bpmnZip = new JSZip();
bpmnZip.file(
  'C.01.01 Handle enquiries.bpmn',
  linearBpmn('C0101', 'Handle enquiries', ['Receive enquiry', 'Answer enquiry', 'Close enquiry'], {
    name: 'Customer Service Agent',
    start: 'Enquiry received',
    end: 'Enquiry closed',
  }),
);
bpmnZip.file(
  'C.01.02 تسجيل الطلبات.bpmn',
  linearBpmn(
    'C0102',
    'تسجيل الطلبات',
    ['استلام الطلب', 'التحقق من البيانات', 'تسجيل الطلب في النظام'],
    {
      name: 'موظف خدمة المتعاملين',
      start: 'تم استلام الطلب',
      end: 'تم تسجيل الطلب',
    },
  ),
);
bpmnZip.file('S.02 Supplier onboarding (no layout).bpmn', noLayout);
out(
  'bpmn-diagrams.zip',
  await bpmnZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
);

// ---------- Visio (.vsdx): flowchart with swimlanes ----------
const V = 'http://schemas.microsoft.com/office/visio/2012/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const masters = [
  [1, 'Process'],
  [2, 'Decision'],
  [3, 'Start/End'],
  [4, 'Dynamic connector'],
  [5, 'Swimlane'],
  [6, 'Document'],
];
const cells = (o) =>
  Object.entries(o)
    .map(([k, v]) => `<Cell N="${k}" V="${v}"/>`)
    .join('');
const vshape = (id, master, text, x, y, w, h) =>
  `<Shape ID="${id}" NameU="${masters.find((m) => m[0] === master)[1]}.${id}" Master="${master}" Type="Shape">${cells({ PinX: x, PinY: y, Width: w, Height: h })}<Text>${text}</Text></Shape>`;
const vconn = (id, text) =>
  `<Shape ID="${id}" NameU="Dynamic connector.${id}" Master="4" Type="Shape">${cells({ PinX: 0, PinY: 0, Width: 0, Height: 0, BeginX: 0, BeginY: 0, EndX: 1, EndY: 1 })}<Text>${text}</Text></Shape>`;
const pageShapes = [
  vshape(1, 5, 'Employee', 5, 6.5, 10, 2),
  vshape(2, 5, 'Line Manager', 5, 4.5, 10, 2),
  vshape(3, 5, 'HR Officer', 5, 2.5, 10, 2),
  vshape(10, 3, 'Leave needed', 1, 6.5, 1, 0.5),
  vshape(11, 1, 'Submit leave request', 2.5, 6.5, 1.5, 0.75),
  vshape(12, 2, 'Approved?', 4.5, 4.5, 1, 1),
  vshape(13, 1, 'Record leave', 6.5, 2.5, 1.5, 0.75),
  vshape(14, 1, 'Inform employee of rejection', 6.5, 4.5, 1.5, 0.75),
  vshape(15, 3, 'Leave recorded', 8.5, 2.5, 1, 0.5),
  vshape(16, 6, 'Leave policy', 8.5, 6.5, 1, 0.75),
  vconn(20, ''),
  vconn(21, ''),
  vconn(22, 'Yes'),
  vconn(23, 'No'),
  vconn(24, ''),
];
const connects = [
  [20, 10, 11],
  [21, 11, 12],
  [22, 12, 13],
  [23, 12, 14],
  [24, 13, 15],
]
  .map(
    ([c, a, b]) =>
      `<Connect FromSheet="${c}" FromCell="BeginX" ToSheet="${a}" ToCell="PinX"/><Connect FromSheet="${c}" FromCell="EndX" ToSheet="${b}" ToCell="PinX"/>`,
  )
  .join('');
const vsdx = new JSZip();
vsdx.file(
  '[Content_Types].xml',
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/></Types>',
);
vsdx.file(
  '_rels/.rels',
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`,
);
vsdx.file(
  'visio/document.xml',
  `<?xml version="1.0" encoding="UTF-8"?><VisioDocument xmlns="${V}"/>`,
);
vsdx.file(
  'visio/masters/masters.xml',
  `<?xml version="1.0" encoding="UTF-8"?><Masters xmlns="${V}">${masters.map(([id, n]) => `<Master ID="${id}" NameU="${n}" Name="${n}"/>`).join('')}</Masters>`,
);
vsdx.file(
  'visio/pages/pages.xml',
  `<?xml version="1.0" encoding="UTF-8"?><Pages xmlns="${V}" xmlns:r="${R}"><Page ID="0" NameU="Leave request" Name="Leave request"><Rel r:id="rId1"/></Page></Pages>`,
);
vsdx.file(
  'visio/pages/_rels/pages.xml.rels',
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/></Relationships>`,
);
vsdx.file(
  'visio/pages/page1.xml',
  `<?xml version="1.0" encoding="UTF-8"?><PageContents xmlns="${V}"><Shapes>${pageShapes.join('')}</Shapes><Connects>${connects}</Connects></PageContents>`,
);
out(
  'S.03 Leave request flowchart.vsdx',
  await vsdx.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
);

// ---------- ARIS AML: EPC, value-added chain, roles and a system ----------
const attr = (en, ar) =>
  `<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><StyledElement><PlainText TextValue="${en}"/></StyledElement></AttrValue>${ar ? `<AttrValue LocaleId="1025"><StyledElement><PlainText TextValue="${ar}"/></StyledElement></AttrValue>` : ''}</AttrDef>`;
const def = (id, type, symbol, en, ar) =>
  `<ObjDef ObjDef.ID="ObjDef.${id}" TypeNum="${type}" SymbolNum="${symbol}"><GUID>00000000-0000-4000-8000-0000000000${id}</GUID>${attr(en, ar)}</ObjDef>`;
const occ = (id, defId, symbol, x, y, cxns = []) =>
  `<ObjOcc ObjOcc.ID="ObjOcc.${id}" ObjDef.IdRef="ObjDef.${defId}" SymbolNum="${symbol}"><Position Pos.X="${x}" Pos.Y="${y}"/><Size Size.dX="300" Size.dY="150"/>${cxns.map((to, i) => `<CxnOcc CxnOcc.ID="CxnOcc.${id}${i}" ToObjOcc.IdRef="ObjOcc.${to}"/>`).join('')}</ObjOcc>`;
const aml = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info CreateTime="10:00:00.000" CreateDate="01.10.2026" DatabaseName="Demo" UserName="system" ArisExeVersion="10"/>
  <Language LocaleId="1033"/>
  <Language LocaleId="1025"/>
  <Group Group.ID="Group.Root">
    ${def(10, 'OT_EVT', 'ST_EV', 'Purchase need identified', 'تم تحديد حاجة شراء')}
    ${def(11, 'OT_FUNC', 'ST_FUNC', 'Create purchase requisition', 'إنشاء طلب شراء')}
    ${def(12, 'OT_EVT', 'ST_EV', 'Requisition created', 'تم إنشاء الطلب')}
    ${def(13, 'OT_FUNC', 'ST_FUNC', 'Approve requisition', 'اعتماد الطلب')}
    ${def(14, 'OT_RULE', 'ST_OPR_XOR_1', 'XOR', '')}
    ${def(15, 'OT_EVT', 'ST_EV', 'Requisition approved', 'تم اعتماد الطلب')}
    ${def(16, 'OT_EVT', 'ST_EV', 'Requisition rejected', 'تم رفض الطلب')}
    ${def(20, 'OT_PERS_TYPE', 'ST_EMPL_TYPE', 'Requester', 'مقدم الطلب')}
    ${def(21, 'OT_POS', 'ST_POS', 'Procurement Manager', 'مدير المشتريات')}
    ${def(22, 'OT_APPL_SYS_TYPE', 'ST_APPL_SYS_TYPE', 'ERP system', 'نظام تخطيط الموارد')}
    ${def(30, 'OT_FUNC', 'ST_VAL_ADD_CHN_SML_1', 'Plan', 'التخطيط')}
    ${def(31, 'OT_FUNC', 'ST_VAL_ADD_CHN_SML_1', 'Source', 'التوريد')}
    ${def(32, 'OT_FUNC', 'ST_VAL_ADD_CHN_SML_1', 'Pay', 'الدفع')}
    <Model Model.ID="Model.1" Model.Type="MT_EEPC"><GUID>00000000-0000-4000-8000-000000000101</GUID>${attr('Purchase requisition', 'طلب الشراء')}
      ${occ(1, 10, 'ST_EV', 1000, 200, [2])}
      ${occ(2, 11, 'ST_FUNC', 1000, 600, [3])}
      ${occ(3, 12, 'ST_EV', 1000, 1000, [4])}
      ${occ(4, 13, 'ST_FUNC', 1000, 1400, [5])}
      ${occ(5, 14, 'ST_OPR_XOR_1', 1070, 1800, [6, 7])}
      ${occ(6, 15, 'ST_EV', 700, 2200)}
      ${occ(7, 16, 'ST_EV', 1300, 2200)}
      ${occ(8, 20, 'ST_EMPL_TYPE', 300, 600, [2])}
      ${occ(9, 21, 'ST_POS', 300, 1400, [4])}
      ${occ(10, 22, 'ST_APPL_SYS_TYPE', 1700, 600, [2])}
    </Model>
    <Model Model.ID="Model.2" Model.Type="MT_VAL_ADD_CHN_DGM"><GUID>00000000-0000-4000-8000-000000000102</GUID>${attr('Procure to pay', 'من الشراء إلى الدفع')}
      ${occ(20, 30, 'ST_VAL_ADD_CHN_SML_1', 200, 200, [21])}
      ${occ(21, 31, 'ST_VAL_ADD_CHN_SML_1', 700, 200, [22])}
      ${occ(22, 32, 'ST_VAL_ADD_CHN_SML_1', 1200, 200)}
    </Model>
    <Model Model.ID="Model.3" Model.Type="MT_ORG_CHRT"><GUID>00000000-0000-4000-8000-000000000103</GUID>${attr('Procurement organisation', '')}</Model>
  </Group>
</AML>
`;
out('aris-procurement.xml', aml);

// ---------- Word SOPs (English and Arabic) ----------
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  ExternalHyperlink,
  AlignmentType,
} = docx;
const cell = (t, rtl) =>
  new TableCell({
    children: [
      new Paragraph({ children: [new TextRun({ text: t, rightToLeft: rtl })], bidirectional: rtl }),
    ],
  });
function sop(rtl, t) {
  const p = (text, opts = {}) =>
    new Paragraph({
      children: [new TextRun({ text, rightToLeft: rtl })],
      bidirectional: rtl,
      ...opts,
    });
  return new Document({
    creator: 'ProcessHub samples',
    title: t.title,
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : undefined,
            children: [new TextRun({ text: t.title, rightToLeft: rtl })],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            bidirectional: rtl,
            children: [new TextRun({ text: t.h1, rightToLeft: rtl })],
          }),
          p(t.purpose),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            bidirectional: rtl,
            children: [new TextRun({ text: t.h2, rightToLeft: rtl })],
          }),
          ...t.steps.map(
            (s) =>
              new Paragraph({
                children: [new TextRun({ text: s, rightToLeft: rtl })],
                numbering: { reference: 'steps', level: 0 },
                bidirectional: rtl,
              }),
          ),
          new Table({
            rows: t.table.map((r) => new TableRow({ children: r.map((c) => cell(c, rtl)) })),
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            bidirectional: rtl,
            children: [new TextRun({ text: t.h3, rightToLeft: rtl })],
          }),
          p(t.risk),
          new Paragraph({
            bidirectional: rtl,
            children: [
              new ImageRun({ type: 'png', data: PNG, transformation: { width: 40, height: 40 } }),
            ],
          }),
          new Paragraph({
            bidirectional: rtl,
            children: [
              new ExternalHyperlink({
                link: 'https://example.org/policies',
                children: [new TextRun({ text: t.link, style: 'Hyperlink', rightToLeft: rtl })],
              }),
            ],
          }),
        ],
      },
    ],
    numbering: {
      config: [
        {
          reference: 'steps',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
  });
}
out(
  'C.01.01 SOP Handle enquiries (EN).docx',
  await Packer.toBuffer(
    sop(false, {
      title: 'C.01.01 Handle enquiries — Standard operating procedure',
      h1: 'Purpose',
      purpose:
        'This procedure describes how customer enquiries are received, answered and closed within three working days.',
      h2: 'Procedure',
      steps: [
        'Receive the enquiry by phone, e-mail or the portal.',
        'Answer the enquiry or forward it to the responsible section.',
        'Close the enquiry and inform the customer.',
      ],
      table: [
        ['Step', 'Role', 'Time'],
        ['Receive', 'Customer Service Agent', '1 hour'],
        ['Answer', 'Customer Service Agent', '2 days'],
      ],
      h3: 'Risks and controls',
      risk: 'Risk: enquiries are not answered in time. Control: the supervisor reviews open enquiries every morning.',
      link: 'Customer service policy',
    }),
  ),
);
out(
  'C.01.02 إجراء تسجيل الطلبات (AR).docx',
  await Packer.toBuffer(
    sop(true, {
      title: 'C.01.02 تسجيل الطلبات — إجراء العمل القياسي',
      h1: 'الغرض',
      purpose:
        'يصف هذا الإجراء كيفية استلام طلبات المتعاملين والتحقق من بياناتها وتسجيلها في النظام خلال يوم عمل واحد.',
      h2: 'الإجراء',
      steps: [
        'استلام الطلب من المتعامل.',
        'التحقق من اكتمال البيانات والمستندات.',
        'تسجيل الطلب في النظام وإبلاغ المتعامل برقم الطلب.',
      ],
      table: [
        ['الخطوة', 'الدور', 'المدة'],
        ['الاستلام', 'موظف خدمة المتعاملين', 'ساعة'],
        ['التسجيل', 'موظف خدمة المتعاملين', 'يوم'],
      ],
      h3: 'المخاطر والضوابط',
      risk: 'الخطر: تسجيل طلب ببيانات ناقصة. الضابط: مراجعة المشرف لعينة يومية من الطلبات المسجلة.',
      link: 'سياسة خدمة المتعاملين',
    }),
  ),
);

// ---------- Confluence space export (HTML) ----------
const conf = new JSZip();
const page = (title, crumbs, body) =>
  `<!DOCTYPE html><html><head><title>Quality Manual : ${title}</title><meta charset="UTF-8"></head><body><div id="page"><div id="main"><div id="main-header"><div id="breadcrumb-section"><ol id="breadcrumbs">${crumbs.map(([f, t]) => `<li><a href="${f}">${t}</a></li>`).join('')}</ol></div><h1 id="title-heading" class="pagetitle"><span id="title-text">Quality Manual : ${title}</span></h1></div><div id="content" class="view"><div id="main-content" class="wiki-content group">${body}</div></div></div></div></body></html>`;
conf.file(
  'QM/index.html',
  `<!DOCTYPE html><html><head><title>Quality Manual : Home</title></head><body><div id="main-content"><h2>Available Pages:</h2><ul><li><a href="Quality-Manual_1001.html">Quality Manual</a><ul><li><a href="Document-control_1002.html">Document control</a><ul><li><a href="Records-retention_1003.html">Records retention</a></li></ul></li></ul></li></ul></div></body></html>`,
);
conf.file(
  'QM/Quality-Manual_1001.html',
  page(
    'Quality Manual',
    [['index.html', 'Quality Manual']],
    '<p>The quality manual describes our management system. See <a href="Document-control_1002.html">Document control</a>.</p><p>Process <strong>C.01.01</strong> handles enquiries.</p>',
  ),
);
conf.file(
  'QM/Document-control_1002.html',
  page(
    'Document control',
    [
      ['index.html', 'Quality Manual'],
      ['Quality-Manual_1001.html', 'Quality Manual'],
    ],
    '<h2>Rules</h2><ul><li>Every document has an owner.</li><li>Documents are reviewed yearly.</li></ul><p><img src="attachments/1002/2001.png" alt="Flow"></p><p><a href="attachments/1002/2002.pdf">Form (PDF)</a> · <a href="Missing-page_9999.html">Old page</a></p><script>alert(1)</script>',
  ),
);
conf.file(
  'QM/Records-retention_1003.html',
  page(
    'Records retention',
    [
      ['index.html', 'Quality Manual'],
      ['Quality-Manual_1001.html', 'Quality Manual'],
      ['Document-control_1002.html', 'Document control'],
    ],
    '<table><tbody><tr><th>Record</th><th>Years</th></tr><tr><td>Contracts</td><td>10</td></tr></tbody></table>',
  ),
);
conf.file('QM/attachments/1002/2001.png', PNG);
const pdf = (lines) => {
  const content = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
};
conf.file('QM/attachments/1002/2002.pdf', pdf(['Document change request form']));
out(
  'confluence-quality-manual.zip',
  await conf.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
);

// ---------- PDF (text) and Markdown folder ----------
out(
  'S.02 Supplier onboarding guide.pdf',
  pdf([
    'S.02 Supplier onboarding - user guide',
    '1. The supplier submits the application on the portal.',
    '2. The procurement officer checks the documents.',
    '3. The procurement manager approves the supplier.',
    'Risk: fake suppliers are registered. Control: trade licence checked online.',
  ]),
);
const md = new JSZip();
md.file(
  'guides/README.md',
  '# Staff guides\n\nGuides for new staff. Start with [Onboarding](onboarding/first-week.md).\n',
);
md.file(
  'guides/onboarding/first-week.md',
  '# Your first week\n\n1. Collect your badge.\n2. Read the [quality manual](../README.md).\n3. Meet your line manager.\n\n![Office map](images/map.png)\n\n| Day | Activity |\n| --- | --- |\n| 1 | Welcome |\n| 2 | Systems training |\n\nSee also [old wiki](../missing.md).\n',
);
md.file('guides/onboarding/images/map.png', PNG);
out('markdown-guides.zip', await md.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

process.stdout.write(`Samples written to ${here}\n`);
