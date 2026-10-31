import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseBpmn, applyBpmnSuggestions } from './bpmn-tools';
import { readVisio, resolveMapping } from './visio-tools';
import { readAml } from './aris-tools';
import {
  fragment,
  markRtl,
  processSuggestions,
  splitByHeading1,
  takeTitle,
  templateGaps,
  textToHtml,
} from './doc-tools';
import { librarySuggestions } from './process-target';
import { ImportFileError, openSafeZip } from '../safe-upload';

const SAMPLES = join(__dirname, '../../../../../docs/samples/import');
const read = (n: string) => readFileSync(join(SAMPLES, n));

describe('BPMN import normaliser', () => {
  let files: Map<string, string>;
  beforeAll(async () => {
    const zip = await openSafeZip(read('bpmn-diagrams.zip'));
    files = new Map();
    for (const e of zip.entries) files.set(e.path, await zip.readText(e.path));
  });
  const file = (start: string) => [...files.entries()].find(([k]) => k.startsWith(start))![1];

  it('puts labels into the Arabic or English slot by script and strips vendor extensions', () => {
    const ar = analyseBpmn(file('C.01.02'), 'a.bpmn', {
      stripVendor: true,
      layout: 'MISSING',
      key: 't',
    });
    expect(ar.arabic).toBe(true);
    expect(ar.xml).toContain('ph:nameAr="استلام الطلب"');
    expect(ar.xml).not.toContain('signavio');
    expect(ar.hadLayout).toBe(true);
    expect(ar.laidOut).toBe(false);
    expect(ar.lanes).toEqual([{ id: 'Lane_C0102', name: 'موظف خدمة المتعاملين' }]);
    const kept = analyseBpmn(file('C.01.01'), 'b.bpmn', {
      stripVendor: false,
      layout: 'MISSING',
      key: 't',
    });
    expect(kept.xml).toContain('signavio');
    expect(kept.issues.map((i) => i.code)).toContain('VENDOR_KEPT');
  });

  it('lays out a diagram without diagram interchange', () => {
    const a = analyseBpmn(file('S.02'), 's.bpmn', {
      stripVendor: true,
      layout: 'MISSING',
      key: 't',
    });
    expect(a.hadLayout).toBe(false);
    expect(a.laidOut).toBe(true);
    expect(a.xml).toContain('bpmndi:BPMNShape');
    expect(a.xml).not.toContain('camunda');
    expect(a.elements).toBe(6);
    expect(a.issues.map((i) => i.code)).toContain('LAYOUT_GENERATED');
  });

  it('refuses non-BPMN XML and applies accepted suggestions', () => {
    expect(() =>
      analyseBpmn('<x/>', 'x.xml', { stripVendor: true, layout: 'MISSING', key: 't' }),
    ).toThrow(ImportFileError);
    const a = analyseBpmn(file('S.02'), 's.bpmn', {
      stripVendor: true,
      layout: 'MISSING',
      key: 't',
    });
    const xml = applyBpmnSuggestions(
      a.xml,
      new Map([['Lane_Officer', 'role-1']]),
      new Map([['Approve', 'term-1']]),
    );
    expect(xml).toContain('ph:roleId="role-1"');
    expect(xml).toContain('ph:labelRef="term-1"');
  });
});

describe('Visio reader', () => {
  it('maps flowchart shapes, swimlanes and connectors; reports unmapped masters', async () => {
    const [page] = await readVisio(read('S.03 Leave request flowchart.vsdx'), 'v.vsdx', undefined);
    expect(page.name).toBe('Leave request');
    expect(page.structure.lanes.map((l) => l.nameEn)).toEqual([
      'Employee',
      'Line Manager',
      'HR Officer',
    ]);
    const types = page.structure.nodes.map((n) => n.type).sort();
    expect(types).toEqual(['endEvent', 'exclusiveGateway', 'startEvent', 'task', 'task', 'task']);
    expect(page.structure.flows.find((f) => f.nameEn === 'Yes')).toBeTruthy();
    expect(page.unmapped.get('document')).toBe(1);
    const [mapped] = await readVisio(read('S.03 Leave request flowchart.vsdx'), 'v.vsdx', {
      Document: 'task',
    });
    expect(mapped.unmapped.size).toBe(0);
    expect(resolveMapping({ x: 'not-a-type' })('x')).toBeNull();
  });
});

describe('ARIS AML reader', () => {
  it('reads objects, an EPC and a value-added chain; skips other models', () => {
    const aml = readAml(read('aris-procurement.xml').toString('utf8'), 'a.xml');
    expect(aml.objects.map((o) => `${o.type}:${o.nameEn}`).sort()).toEqual([
      'ROLE:Procurement Manager',
      'ROLE:Requester',
      'SYSTEM:ERP system',
    ]);
    const epc = aml.models.find((m) => m.kind === 'EPC')!;
    expect(epc).toMatchObject({ nameEn: 'Purchase requisition', nameAr: 'طلب الشراء' });
    expect(epc.content.edges.filter((e) => e.kind === 'assignment')).toHaveLength(3);
    expect(epc.objectNodes.size).toBe(3);
    expect(aml.models.find((m) => m.kind === 'VALUE_CHAIN')!.content.nodes).toHaveLength(3);
    expect(aml.skipped).toEqual([{ name: 'Procurement organisation', typeNum: 'MT_ORG_CHRT' }]);
    expect(() => readAml('<root/>', 'x.xml')).toThrow(ImportFileError);
  });
});

describe('document helpers', () => {
  it('marks Arabic blocks right-to-left and takes the first heading as title', () => {
    const root = fragment('<p>English</p><p>نص عربي</p>');
    markRtl(root);
    expect(root.innerHTML).toBe('<p>English</p><p dir="rtl">نص عربي</p>');
    expect(takeTitle('<h1>Title</h1><p>x</p>', 'f')).toEqual({ title: 'Title', html: '<p>x</p>' });
  });

  it('splits by Heading 1 and finds missing template sections', () => {
    const parts = splitByHeading1('<p>intro</p><h1>A</h1><p>a</p><h1>B</h1><p>b</p>', 'Doc');
    expect(parts.map((p) => p.title)).toEqual(['Doc', 'A', 'B']);
    expect(
      templateGaps('<h2>Purpose</h2>', '<h2>Purpose</h2><h2>Scope</h2><h2>Records</h2>'),
    ).toEqual(['Scope', 'Records']);
    expect(textToHtml('a\nb\n\nنص')).toBe('<p>a<br>b</p><p dir="rtl">نص</p>');
  });

  it('suggests process links (code in the title accepted, in the text offered)', () => {
    const procs = [{ id: 'p1', code: 'C.01.01', nameEn: 'Handle enquiries', nameAr: '' }];
    expect(
      processSuggestions(procs, { file: 'C.01.01 SOP.docx', title: 'SOP', text: '' })[0],
    ).toMatchObject({
      targetId: 'p1',
      accepted: true,
    });
    expect(
      processSuggestions(procs, { file: 'x.docx', title: 'x', text: 'see C.01.01' })[0].accepted,
    ).toBe(false);
  });

  it('suggests library objects: exact names accepted, partial matches offered', () => {
    const lib = [{ id: 'r1', nameEn: 'Procurement Officer', nameAr: 'موظف المشتريات' }];
    expect(
      librarySuggestions('ROLE', [{ id: 'L1', name: 'procurement officer' }], lib)[0].accepted,
    ).toBe(true);
    expect(
      librarySuggestions('ROLE', [{ id: 'L2', name: 'Senior Procurement Officer' }], lib)[0]
        .accepted,
    ).toBe(false);
    expect(librarySuggestions('ROLE', [{ id: 'L3', name: 'Finance' }], lib)).toEqual([]);
  });
});
