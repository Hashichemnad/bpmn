import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';
import { applyBatch, itemsOf, upload, waitBatch } from './imports-fixtures';

const SAMPLES = join(__dirname, '../../../docs/samples/import');
const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });

/** Import tools step 3: BPMN, Visio, ARIS AML and DMN diagrams. */
describe('Import Center — diagrams (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
  });

  it('imports a BPMN ZIP: matches by code, Arabic labels, auto-layout, vendor extensions, role suggestions; re-import updates', async () => {
    await applyBatch(admin, (await upload(admin, 'DEPARTMENTS', [sample('departments.xlsx')])).id);
    const house = await upload(admin, 'PROCESS_HOUSE', [sample('process-house.xlsx')]);
    expect(house.summary).toMatchObject({ create: 9, errors: 0 });
    await applyBatch(admin, house.id);
    const role = await ctx.prisma.repoObject.create({
      data: { type: 'ROLE', nameEn: 'Procurement Officer', nameAr: 'موظف المشتريات' },
    });
    await ctx.prisma.repoObject.create({
      data: { type: 'TERM', nameEn: 'Approve supplier', status: 'APPROVED' },
    });

    const b = await upload(admin, 'BPMN', [sample('bpmn-diagrams.zip')]);
    expect(b.status).toBe('READY');
    const items = await itemsOf(admin, b.id);
    expect(items).toHaveLength(3);
    const en = items.find((i) => i.key === 'C.01.01 Handle enquiries')!;
    const ar = items.find((i) => i.key.startsWith('C.01.02'))!;
    const s02 = items.find((i) => i.key.startsWith('S.02'))!;
    expect(en).toMatchObject({ action: 'UPDATE', matchBy: 'CODE' });
    expect(en.facts).toMatchObject({ language: 'EN', layout: 'file', lanes: 1 });
    expect(en.issues.map((x) => x.code)).toContain('VENDOR_STRIPPED');
    expect(ar).toMatchObject({ action: 'UPDATE', matchBy: 'CODE', nameAr: 'تسجيل الطلبات' });
    expect(ar.facts).toMatchObject({ language: 'AR' });
    expect(s02.facts).toMatchObject({ layout: 'auto', lanes: 2 });
    expect(s02.issues.map((x) => x.code)).toEqual(
      expect.arrayContaining(['LAYOUT_GENERATED', 'VENDOR_STRIPPED']),
    );
    expect(s02.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ROLE', targetId: role.id, accepted: true }),
        expect.objectContaining({ kind: 'TERM', source: 'Approve supplier', accepted: true }),
      ]),
    );
    expect(s02.action).toBe('UPDATE');

    const done = await applyBatch(admin, b.id);
    expect(done.result.failed).toBe(0);
    const arProcess = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'C.01.02' },
      include: { model: true, versions: true },
    });
    expect(arProcess.model!.bpmnXml).toContain('ph:nameAr="استلام الطلب"');
    expect(arProcess.model!.bpmnXml).not.toContain('signavio');
    expect(arProcess.versions[0].changeNote).toMatch(/^Imported from bpmn-diagrams\.zip/);
    const s02Process = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'S.02' },
      include: { model: true, links: true },
    });
    const xml = s02Process.model!.bpmnXml;
    expect(xml).toContain('BPMNShape');
    expect(xml).not.toContain('camunda');
    expect(xml).toContain(`ph:roleId="${role.id}"`);
    expect(s02Process.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ repoObjectId: role.id, relation: 'PERFORMS' }),
        expect.objectContaining({ relation: 'NAMED' }),
      ]),
    );

    // Re-import: the same processes are updated (versions grow), nothing is duplicated.
    const again = await upload(admin, 'BPMN', [sample('bpmn-diagrams.zip')], {
      vendorExtensions: 'KEEP',
    });
    expect(again.summary).toMatchObject({ create: 0, update: 3 });
    await applyBatch(admin, again.id);
    expect(await ctx.prisma.process.count({ where: { code: 'S.02' } })).toBe(1);
    expect(await ctx.prisma.processVersion.count({ where: { processId: s02Process.id } })).toBe(2);
  });

  it('creates processes for unmatched diagrams under a parent and undoes them', async () => {
    const parent = await ctx.prisma.process.create({
      data: { code: 'C.09', nameEn: 'Imports', category: 'CORE', level: 1 },
    });
    const b = await upload(admin, 'BPMN', [sample('bpmn-diagrams.zip')], {
      parentProcessId: parent.id,
      attachTo: 'CREATE',
    });
    expect(b.summary).toMatchObject({ create: 3 });
    await applyBatch(admin, b.id);
    const children = await ctx.prisma.process.findMany({
      where: { parentId: parent.id },
      include: { model: true },
    });
    expect(children.map((c) => c.code).sort()).toEqual(['C.01.01', 'C.01.02', 'S.02']);
    expect(children.every((c) => c.importBatchId === b.id && c.model && c.status === 'DRAFT')).toBe(
      true,
    );
    await admin.post(`/imports/${b.id}/undo`).expect(200);
    expect(
      await ctx.prisma.process.count({ where: { parentId: parent.id, deletedAt: null } }),
    ).toBe(0);
  });

  it('converts a Visio flowchart with swimlanes; the shape mapping can be changed', async () => {
    const b = await upload(admin, 'VISIO', [sample('S.03 Leave request flowchart.vsdx')]);
    expect(b.status).toBe('READY');
    expect(b.columns).toEqual(
      expect.arrayContaining([
        { header: 'decision', field: 'exclusiveGateway', sample: '1' },
        { header: 'swimlane', field: 'lane', sample: '3' },
        { header: 'document', field: null, sample: '1' },
      ]),
    );
    let [item] = await itemsOf(admin, b.id);
    expect(item.facts).toMatchObject({ lanes: 3, elements: 6, flows: 5, unmapped: 1 });
    expect(item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VISIO_UNMAPPED',
          params: { shape: 'document', count: 1 },
        }),
      ]),
    );
    await admin
      .put(`/imports/${b.id}/options`)
      .send({ shapeMapping: { document: 'task' } })
      .expect(200);
    await waitBatch(admin, b.id);
    [item] = await itemsOf(admin, b.id);
    expect(item.facts).toMatchObject({ elements: 7, unmapped: 0 });
    await applyBatch(admin, b.id);
    const p = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'S.03' },
      include: { model: true },
    });
    expect(p.model!.bpmnXml).toContain('exclusiveGateway');
    expect(p.model!.bpmnXml).toContain('ph:nameEn="Line Manager"');
    expect((p.model!.bpmnXml.match(/<bpmn:lane /g) ?? []).length).toBe(3);
  });

  it('refuses old binary Visio files with a clear message', async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const res = await upload(admin, 'VISIO', [{ name: 'old.vsd', data: ole }], {}, 400);
    expect(res.code).toBe('VSD_BINARY');
  });

  it('imports ARIS AML: objects into the library, EPC and value chain diagrams with links', async () => {
    await ctx.prisma.repoObject.create({ data: { type: 'SYSTEM', nameEn: 'ERP system' } });
    const b = await upload(admin, 'ARIS', [sample('aris-procurement.xml')]);
    expect(b.issues).toEqual([
      expect.objectContaining({
        code: 'ARIS_MODELS_SKIPPED',
        params: { count: 1, types: 'MT_ORG_CHRT' },
      }),
    ]);
    const items = await itemsOf(admin, b.id);
    expect(items.filter((i) => i.key === 'ROLE').map((i) => i.action)).toEqual([
      'CREATE',
      'CREATE',
    ]);
    expect(items.find((i) => i.key === 'SYSTEM')).toMatchObject({
      action: 'SKIP',
      matchBy: 'NAME',
    });
    expect(items.find((i) => i.key === 'EPC')).toMatchObject({
      action: 'CREATE',
      nameEn: 'Purchase requisition',
      nameAr: 'طلب الشراء',
    });
    await applyBatch(admin, b.id);
    const epc = await ctx.prisma.diagram.findFirstOrThrow({
      where: { type: 'EPC' },
      include: { links: true, versions: true },
    });
    const content = JSON.parse(epc.content);
    expect(content.nodes.map((n: { kind: string }) => n.kind).sort()).toEqual(
      [
        'event',
        'event',
        'event',
        'event',
        'function',
        'function',
        'orgUnit',
        'orgUnit',
        'system',
        'xor',
      ].sort(),
    );
    expect(epc.links).toHaveLength(3);
    expect(epc.versions).toHaveLength(1);
    expect(epc.importBatchId).toBe(b.id);
    const vc = await ctx.prisma.diagram.findFirstOrThrow({ where: { type: 'VALUE_CHAIN' } });
    expect(JSON.parse(vc.content).nodes).toHaveLength(3);
    expect(
      await ctx.prisma.repoObject.count({ where: { type: 'ROLE', importBatchId: b.id } }),
    ).toBe(2);

    // Re-import: objects match the earlier import, the draft diagrams get a new version.
    const again = await upload(admin, 'ARIS', [sample('aris-procurement.xml')]);
    const second = await itemsOf(admin, again.id);
    expect(second.filter((i) => i.key === 'ROLE').map((i) => i.matchBy)).toEqual([
      'EXTERNAL_ID',
      'EXTERNAL_ID',
    ]);
    expect(second.find((i) => i.key === 'EPC')!.action).toBe('UPDATE');
    await applyBatch(admin, again.id);
    expect(await ctx.prisma.diagram.count({ where: { type: 'EPC' } })).toBe(1);
    expect(await ctx.prisma.diagramVersion.count({ where: { diagramId: epc.id } })).toBe(2);
  });

  it('imports DMN decision tables and rejects unsafe XML per file', async () => {
    const zip = new JSZip();
    zip.file('good.dmn', readFileSync(join(SAMPLES, 'approval-authority.dmn')));
    zip.file(
      'evil.dmn',
      '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">&x;</definitions>',
    );
    const b = await upload(admin, 'DMN', [
      { name: 'dmn.zip', data: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) },
    ]);
    const items = await itemsOf(admin, b.id);
    expect(items.find((i) => i.key === 'evil')!.issues[0].code).toBe('XML_DTD_NOT_ALLOWED');
    expect(items.find((i) => i.key === 'good')!.action).toBe('CREATE');
    await applyBatch(admin, b.id);
    expect(await ctx.prisma.diagram.count({ where: { type: 'DMN', deletedAt: null } })).toBe(1);
  });

  it('rejects path traversal in a ZIP and executables named .bpmn', async () => {
    const zip = new JSZip();
    zip.file('../../etc/evil.bpmn', '<x/>');
    const b = await upload(admin, 'BPMN', [
      { name: 'evil.zip', data: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) },
    ]);
    expect(b.status).toBe('FAILED');
    expect(b.issues[0]).toMatchObject({ code: 'ZIP_UNSAFE_PATH' });
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);
    const res = await upload(admin, 'BPMN', [{ name: 'x.bpmn', data: exe }], {}, 400);
    expect(res.code).toBe('FILE_TYPE_MISMATCH');
  });
});
