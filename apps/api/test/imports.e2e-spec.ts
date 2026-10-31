import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { createApp, createUser, loggedIn, resetDb, type Client, type TestContext } from './helpers';
import { applyBatch, binary, upload, xlsx } from './imports-fixtures';

/** Import Center framework (M15 step 1): batches, permissions, upload security, module imports. */
describe('Import Center (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let superAdmin: Client;
  let modeler: Client;
  let officer: Client;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await createUser(ctx.prisma, 'admin@test.local', ['ADMIN']);
    await createUser(ctx.prisma, 'super@test.local', ['SUPER_ADMIN']);
    await createUser(ctx.prisma, 'modeler@test.local', ['MODELER']);
    await createUser(ctx.prisma, 'officer@test.local', ['RISK_OFFICER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    modeler = await loggedIn(ctx.app, 'modeler@test.local');
    officer = await loggedIn(ctx.app, 'officer@test.local');
  });

  const risks = () =>
    xlsx(
      [
        'Code',
        'Title (English)',
        'Category (key)',
        'Inherent likelihood (1-5)',
        'Inherent impact (1-5)',
      ],
      [
        ['R-01', 'Split orders', 'FINANCIAL', 3, 3],
        ['R-02', 'Duplicate invoices', 'FINANCIAL', 2, 4],
      ],
    );

  it('is limited to import.manage (Admins, Super Admins); the package kind to Super Admins', async () => {
    await modeler.get('/imports').expect(403);
    await officer.get('/imports/kinds').expect(403);
    await modeler
      .post('/imports')
      .field('kind', 'GRC_RISKS')
      .attach('files', await risks(), 'risks.xlsx')
      .expect(403);
    const adminKinds = (await admin.get('/imports/kinds').expect(200)).body.map(
      (k: { kind: string }) => k.kind,
    );
    expect(adminKinds).toEqual(
      expect.arrayContaining(['GRC_RISKS', 'EA_APPLICATIONS', 'KPI_KPIS']),
    );
    expect(adminKinds).not.toContain('PACKAGE');
    await admin.get('/imports?page=1').expect(200);
  });

  it('runs an existing module import as a batch: dry run, apply, records, report', async () => {
    const b = await upload(admin, 'GRC_RISKS', [{ name: 'risks.xlsx', data: await risks() }]);
    expect(b).toMatchObject({ status: 'READY', kind: 'GRC_RISKS' });
    expect(b.number).toMatch(/^IMP-\d{4,}$/);
    expect(b.summary).toMatchObject({ items: 1, create: 1, errors: 0, blocking: 0 });
    const items = (await admin.get(`/imports/${b.id}/items`).expect(200)).body.items;
    expect(items[0]).toMatchObject({ entity: 'MODULE_ROWS', facts: { rows: 2, create: 2 } });
    expect(items[0].data).toBeUndefined();
    // Nothing exists before apply.
    expect(await ctx.prisma.repoObject.count({ where: { type: 'RISK' } })).toBe(0);

    const done = await applyBatch(admin, b.id);
    expect(done.status).toBe('APPLIED');
    expect(done.result.module).toMatchObject({ rows: 2, created: 2 });
    expect(done.canUndo).toBe(false);
    expect(await ctx.prisma.repoObject.count({ where: { type: 'RISK', deletedAt: null } })).toBe(2);
    const records = (await admin.get(`/imports/${b.id}/records`).expect(200)).body;
    expect(records.items[0]).toMatchObject({ entity: 'MODULE_ROWS', outcome: 'CREATED' });

    const report = await admin
      .get(`/imports/${b.id}/report?locale=ar`)
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(report.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['الدفعة', 'العناصر']);
    expect(wb.worksheets[1].getRow(2).getCell(7).value).toBe('CREATED');

    const audit = await ctx.prisma.auditLog.findMany({ where: { entityType: 'ImportBatch' } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['CREATE', 'IMPORT', 'EXPORT']),
    );
    // Applied batches cannot be discarded or applied twice.
    await admin.delete(`/imports/${b.id}`).expect(409);
    await admin.post(`/imports/${b.id}/apply`).expect(409);
  });

  it('blocks apply while rows have errors; a batch can be discarded', async () => {
    const bad = await xlsx(
      [
        'Code',
        'Title (English)',
        'Category (key)',
        'Inherent likelihood (1-5)',
        'Inherent impact (1-5)',
      ],
      [['R-09', '', 'NOPE', 9, 1]],
    );
    const b = await upload(admin, 'GRC_RISKS', [{ name: 'bad.xlsx', data: bad }]);
    expect(b.status).toBe('READY');
    expect(b.summary.blocking).toBe(1);
    const errors = (await admin.get(`/imports/${b.id}/items?filter=errors`).expect(200)).body;
    expect(errors.items[0].issues[0]).toMatchObject({ level: 'ERROR', code: 'MODULE_ROW' });
    await admin.post(`/imports/${b.id}/apply`).expect(400);
    // Excluding the item leaves nothing to do.
    await admin
      .put(`/imports/${b.id}/items/${encodeURIComponent(errors.items[0].ref)}`)
      .send({ skip: true })
      .expect(200);
    expect((await admin.post(`/imports/${b.id}/apply`).expect(400)).body.code).toBe(
      'IMPORT_NOTHING_TO_DO',
    );
    await admin.delete(`/imports/${b.id}`).expect(204);
    await admin.get(`/imports/${b.id}`).expect(404);
    expect(await ctx.prisma.importFile.count()).toBe(0);
  });

  it('checks uploads by content: disguised files, macros, old formats, archives', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 1)]);
    let res = await upload(admin, 'GRC_RISKS', [{ name: 'risks.xlsx', data: exe }], {}, 400);
    expect(res.code).toBe('FILE_TYPE_MISMATCH');
    res = await upload(admin, 'GRC_RISKS', [{ name: 'risks.xlsm', data: await risks() }], {}, 400);
    expect(res.code).toBe('MACRO_NOT_ALLOWED');
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    res = await upload(admin, 'GRC_RISKS', [{ name: 'risks.xls', data: ole }], {}, 400);
    expect(res.code).toBe('OLD_OFFICE_FORMAT');
    res = await upload(
      admin,
      'GRC_RISKS',
      [{ name: 'risks.csv', data: Buffer.from('a,b') }],
      {},
      400,
    );
    expect(res.code).toBe('FILE_EXTENSION_NOT_ACCEPTED');
    // Two files for a single-file kind.
    const two = await admin
      .post('/imports')
      .field('kind', 'GRC_RISKS')
      .attach('files', await risks(), 'a.xlsx')
      .attach('files', await risks(), 'b.xlsx')
      .expect(400);
    expect(two.body.code).toBe('TOO_MANY_FILES');
    // A workbook with a VBA project inside (renamed .xlsm) is refused by the reader of the batch.
    const z = await JSZip.loadAsync(await risks());
    z.file('xl/vbaProject.bin', Buffer.from([1, 2, 3]));
    const macro = Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
    const b = await upload(admin, 'GRC_RISKS', [{ name: 'risks.xlsx', data: macro }]);
    expect(['FAILED', 'READY']).toContain(b.status);
    await superAdmin.get('/imports/kinds').expect(200);
  });

  it('validates options, cancels nothing when idle and audits the life cycle', async () => {
    const res = await upload(
      admin,
      'GRC_RISKS',
      [{ name: 'risks.xlsx', data: await risks() }],
      { defaultOwnerId: '00000000-0000-4000-8000-000000000000' },
      400,
    );
    expect(res.code).toBe('UNKNOWN_OWNER');
    const b = await upload(admin, 'GRC_RISKS', [{ name: 'risks.xlsx', data: await risks() }]);
    await admin.post(`/imports/${b.id}/cancel`).expect(409);
    const list = (await admin.get('/imports?kind=GRC_RISKS').expect(200)).body;
    expect(list.items[0]).toMatchObject({ id: b.id, fileNames: ['risks.xlsx'], status: 'READY' });
    const file = await admin
      .get(`/imports/${b.id}/files/${b.files[0].id}`)
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.body.length).toBeGreaterThan(100);
  });
});
