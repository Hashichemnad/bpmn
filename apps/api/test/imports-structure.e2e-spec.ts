import ExcelJS from 'exceljs';
import { Client, createApp, createUser, loggedIn, resetDb, type TestContext } from './helpers';
import { applyBatch, binary, itemsOf, upload, xlsx } from './imports-fixtures';

const PH_HEADER = [
  'Process code',
  'Name (English)',
  'Name (Arabic)',
  'Category',
  'Parent code',
  'Level',
  'Owner (e-mail)',
  'Department (code or name)',
];

/** Import tools step 2: process house, departments and users from Excel / CSV. */
describe('Import Center — structure (e2e)', () => {
  let ctx: TestContext;
  let admin: Client;
  let superAdmin: Client;

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
    await createUser(ctx.prisma, 'owner@test.local', ['PROCESS_OWNER']);
    admin = await loggedIn(ctx.app, 'admin@test.local');
    superAdmin = await loggedIn(ctx.app, 'super@test.local');
    await ctx.prisma.department.create({
      data: { code: 'FIN', nameEn: 'Finance', nameAr: 'المالية' },
    });
  });

  const house = () =>
    xlsx(PH_HEADER, [
      ['C', 'Core processes', 'العمليات الرئيسية', 'Core', '', 1, '', ''],
      ['C.01', 'Customer services', 'خدمات المتعاملين', '', 'C', 2, 'owner@test.local', 'FIN'],
      ['C.01.01', 'Handle enquiries', '', '', 'C.01', 5, '', 'Finance'],
      ['S', 'Support', 'مساندة', 'مساندة', '', '', '', ''],
    ]);

  it('offers bilingual templates', async () => {
    const res = await admin
      .get('/imports/templates/PROCESS_HOUSE?locale=ar')
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('رمز العملية');
    await admin.get('/imports/templates/USERS?locale=en').expect(200);
  });

  it('builds the process tree, re-imports as updates and undoes the batch', async () => {
    const b = await upload(admin, 'PROCESS_HOUSE', [{ name: 'house.xlsx', data: await house() }]);
    expect(b.status).toBe('READY');
    expect(b.summary).toMatchObject({ create: 4, update: 0, errors: 0 });
    expect(b.columns.find((c: { header: string }) => c.header === 'Parent code').field).toBe(
      'parentCode',
    );
    const items = await itemsOf(admin, b.id);
    expect(items.find((i) => i.key === 'C.01.01')!.issues).toEqual([
      expect.objectContaining({ level: 'WARNING', code: 'LEVEL_ADJUSTED' }),
    ]);
    const done = await applyBatch(admin, b.id);
    expect(done.result).toMatchObject({ created: 4, failed: 0 });
    const leaf = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'C.01.01' },
      include: { parent: true },
    });
    expect(leaf).toMatchObject({
      level: 3,
      category: 'CORE',
      status: 'DRAFT',
      importBatchId: b.id,
    });
    expect(leaf.parent!.code).toBe('C.01');
    const c01 = await ctx.prisma.process.findFirstOrThrow({
      where: { code: 'C.01' },
      include: { owner: true, department: true },
    });
    expect(c01.owner!.email).toBe('owner@test.local');
    expect(c01.department!.code).toBe('FIN');
    expect((await ctx.prisma.process.findFirstOrThrow({ where: { code: 'S' } })).category).toBe(
      'SUPPORT',
    );

    // Re-import: same codes → updates, no duplicates; unchanged rows are skipped.
    const again = await upload(admin, 'PROCESS_HOUSE', [
      {
        name: 'house.csv',
        data: Buffer.from(
          'Process code;Name (English);Parent code\nC.01;Customer care;C\nC;Core processes;\n',
        ),
      },
    ]);
    expect(again.summary).toMatchObject({ create: 0, update: 1, skip: 1 });
    const upd = (await itemsOf(admin, again.id)).find((i) => i.key === 'C.01')!;
    expect(upd).toMatchObject({ action: 'UPDATE', matchBy: 'CODE' });
    expect(upd.changes).toEqual([
      { field: 'nameEn', from: 'Customer services', to: 'Customer care' },
    ]);
    await applyBatch(admin, again.id);
    expect(await ctx.prisma.process.count({ where: { code: 'C.01' } })).toBe(1);
    const updRecords = (await admin.get(`/imports/${again.id}/records`).expect(200)).body.items;
    expect(updRecords[0]).toMatchObject({
      outcome: 'UPDATED',
      before: { nameEn: 'Customer services' },
      after: { nameEn: 'Customer care' },
    });

    // A child added by hand blocks the undo of the first batch.
    const manual = await ctx.prisma.process.create({
      data: { code: 'C.01.02', nameEn: 'Manual', category: 'CORE', parentId: c01.id, level: 3 },
    });
    const check = (await admin.get(`/imports/${b.id}/undo`).expect(200)).body;
    expect(check.canUndo).toBe(false);
    expect(check.blockers[0]).toMatchObject({ key: 'C.01', reason: 'HAS_CHILDREN' });
    await admin.post(`/imports/${b.id}/undo`).expect(409);
    await ctx.prisma.process.update({ where: { id: manual.id }, data: { deletedAt: new Date() } });

    const undone = (await admin.post(`/imports/${b.id}/undo`).expect(200)).body;
    expect(undone).toMatchObject({ status: 'UNDONE', canUndo: false });
    expect(await ctx.prisma.process.count({ where: { deletedAt: null } })).toBe(0);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: 'DELETE', entityType: 'Process' },
    });
    expect(audit).toHaveLength(4);
    expect(audit[0].summary).toMatchObject({ undo: true });
  });

  it('reports missing parents, duplicates, unknown owners / departments and bad categories', async () => {
    const bad = await xlsx(PH_HEADER, [
      ['M', 'Management', '', 'NOPE', '', '', '', ''],
      ['M.01', 'Strategy', '', '', 'X.99', '', 'ghost@test.local', 'NOWHERE'],
      ['M.02', '', '', 'Management', '', '', '', ''],
      ['M.02', 'Again', '', 'Management', '', '', '', ''],
      ['', 'No code', '', 'Core', '', '', '', ''],
      ['A', 'Cycle A', '', 'Core', 'B', '', '', ''],
      ['B', 'Cycle B', '', 'Core', 'A', '', '', ''],
    ]);
    const b = await upload(admin, 'PROCESS_HOUSE', [{ name: 'bad.xlsx', data: bad }]);
    const codes = (key: string) =>
      itemsOf(admin, b.id).then((list) =>
        list.filter((i) => i.key === key).flatMap((i) => i.issues.map((x) => x.code)),
      );
    expect(await codes('M')).toContain('INVALID_CATEGORY');
    expect(await codes('M.01')).toEqual(
      expect.arrayContaining(['UNKNOWN_OWNER', 'UNKNOWN_DEPARTMENT', 'UNKNOWN_PARENT']),
    );
    expect(await codes('M.02')).toEqual(
      expect.arrayContaining(['DUPLICATE_IN_FILE', 'NAME_REQUIRED']),
    );
    expect(await codes('')).toContain('CODE_REQUIRED');
    expect(await codes('A')).toContain('PARENT_CYCLE');
    expect(b.summary.blocking).toBeGreaterThan(0);
    await admin.post(`/imports/${b.id}/apply`).expect(400);

    // With a default owner, an unknown owner is only a warning.
    const ownerId = (
      await ctx.prisma.user.findFirstOrThrow({ where: { email: 'owner@test.local' } })
    ).id;
    const ok = await upload(
      admin,
      'PROCESS_HOUSE',
      [
        {
          name: 'ok.xlsx',
          data: await xlsx(PH_HEADER, [['M', 'Mgmt', '', 'Management', '', '', 'ghost@x.org', '']]),
        },
      ],
      { defaultOwnerId: ownerId },
    );
    expect((await itemsOf(admin, ok.id))[0].issues).toEqual([
      expect.objectContaining({ level: 'WARNING', code: 'UNKNOWN_OWNER_DEFAULT' }),
    ]);
    await applyBatch(admin, ok.id);
    expect((await ctx.prisma.process.findFirstOrThrow({ where: { code: 'M' } })).ownerId).toBe(
      ownerId,
    );
  });

  it('maps columns: a stored mapping rebuilds the preview', async () => {
    const odd = await xlsx(['Ref', 'Title', 'Kind'], [['C', 'Core', 'Core']]);
    const b = await upload(admin, 'PROCESS_HOUSE', [{ name: 'odd.xlsx', data: odd }]);
    expect(b.issues).toEqual([expect.objectContaining({ code: 'COLUMN_MISSING' })]);
    expect(b.summary.items).toBe(0);
    await admin
      .put(`/imports/${b.id}/options`)
      .send({ mapping: { code: 'Ref', nameEn: 'Title', category: 'Kind' } })
      .expect(200);
    let again = (await admin.get(`/imports/${b.id}`).expect(200)).body;
    for (let i = 0; i < 50 && again.status !== 'READY'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      again = (await admin.get(`/imports/${b.id}`).expect(200)).body;
    }
    expect(again.summary).toMatchObject({ create: 1, errors: 0 });
  });

  it('imports the department hierarchy', async () => {
    const data = await xlsx(
      [
        'Department code',
        'Name (English)',
        'Name (Arabic)',
        'Parent department code',
        'Head (e-mail)',
      ],
      [
        ['DG', 'Director General', 'المدير العام', '', 'owner@test.local'],
        ['SPD', 'Strategy', 'الاستراتيجية', 'DG', ''],
        ['FIN', 'Finance and budget', '', 'DG', ''],
        ['X', 'Loop', '', 'Y', ''],
        ['Y', 'Loop', '', 'X', ''],
      ],
    );
    const b = await upload(admin, 'DEPARTMENTS', [{ name: 'deps.xlsx', data }]);
    const items = await itemsOf(admin, b.id);
    expect(items.find((i) => i.key === 'FIN')).toMatchObject({ action: 'UPDATE', matchBy: 'CODE' });
    expect(items.find((i) => i.key === 'X')!.issues[0].code).toBe('PARENT_CYCLE');
    for (const ref of items.filter((i) => ['X', 'Y'].includes(i.key)).map((i) => i.ref))
      await admin
        .put(`/imports/${b.id}/items/${encodeURIComponent(ref)}`)
        .send({ skip: true })
        .expect(200);
    await applyBatch(admin, b.id);
    const spd = await ctx.prisma.department.findFirstOrThrow({
      where: { code: 'SPD' },
      include: { parent: true },
    });
    expect(spd.parent!.code).toBe('DG');
    const fin = await ctx.prisma.department.findFirstOrThrow({
      where: { code: 'FIN' },
      include: { parent: true },
    });
    expect(fin).toMatchObject({ nameEn: 'Finance and budget', nameAr: 'المالية' });
    expect(fin.parent!.code).toBe('DG');
  });

  it('imports users without passwords: invitations, 2FA roles, no Super Admins, re-import adds roles', async () => {
    await superAdmin
      .put('/settings/email')
      .send({
        enabled: true,
        host: 'mailpit',
        port: 1025,
        fromAddress: 'hub@test.local',
        fromName: 'Hub',
      })
      .expect(200);
    await ctx.prisma.repoObject.create({
      data: { type: 'ROLE', code: 'R-AN', nameEn: 'Process analyst' },
    });
    const auth = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'auth' } });
    await ctx.prisma.setting.update({
      where: { key: 'auth' },
      data: { value: { ...(auth.value as object), mfaRequiredRoles: ['ADMIN'] } },
    });
    const data = await xlsx(
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
        [
          'sara@test.local',
          'Sara',
          'سارة',
          'FIN',
          'Process Owner; Modeler / Editor',
          'Process analyst',
          'ar',
        ],
        ['adam@test.local', 'Adam', '', '', 'ADMIN', '', 'en'],
        ['boss@test.local', 'Boss', '', '', 'SUPER_ADMIN', '', ''],
        ['not-an-email', 'X', '', '', '', '', ''],
        ['admin@test.local', 'Me', '', '', 'VIEWER', '', ''],
      ],
    );
    const b = await upload(admin, 'USERS', [{ name: 'users.xlsx', data }], {
      sendInvitations: true,
    });
    const items = await itemsOf(admin, b.id);
    const issuesOf = (k: string) => items.find((i) => i.key === k)!.issues.map((x) => x.code);
    expect(issuesOf('adam@test.local')).toEqual(['MFA_REQUIRED_AT_SIGN_IN']);
    expect(issuesOf('boss@test.local')).toContain('ROLE_NOT_IMPORTABLE');
    expect(issuesOf('not-an-email')).toContain('INVALID_EMAIL');
    expect(issuesOf('admin@test.local')).toContain('OWN_ACCOUNT_UNCHANGED');
    for (const ref of items
      .filter((i) => i.issues.some((x) => x.level === 'ERROR'))
      .map((i) => i.ref))
      await admin
        .put(`/imports/${b.id}/items/${encodeURIComponent(ref)}`)
        .send({ skip: true })
        .expect(200);
    ctx.mail.sent = [];
    const done = await applyBatch(admin, b.id);
    expect(done.result).toMatchObject({ created: 2, failed: 0 });
    const sara = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'sara@test.local' },
      include: { roles: { include: { role: true } }, jobRoles: true, department: true },
    });
    expect(sara).toMatchObject({ passwordHash: '', locale: 'ar', nameAr: 'سارة' });
    expect(sara.roles.map((r) => r.role.key).sort()).toEqual(['MODELER', 'PROCESS_OWNER']);
    expect(sara.jobRoles).toHaveLength(1);
    expect(sara.department!.code).toBe('FIN');
    expect(await ctx.prisma.user.count({ where: { email: 'boss@test.local' } })).toBe(0);

    // The invitation e-mail carries a single-use link; the user sets a password and signs in.
    const mail = ctx.mail.sent.find((m) => m.to === 'sara@test.local')!;
    expect(mail.subject).toBe('دعوة إلى بروسس هب');
    const token = /\/invitation\/([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const anon = await new Client(ctx.app).init();
    const info = (await anon.get(`/auth/invitations/${token}`).expect(200)).body;
    expect(info).toMatchObject({ email: 'sara@test.local', locale: 'ar' });
    expect(
      (await anon.post('/auth/invitations/accept').send({ token, password: 'short' }).expect(400))
        .body.code,
    ).toBe('WEAK_PASSWORD');
    await anon
      .post('/auth/invitations/accept')
      .send({ token, password: 'Strong-Password1' })
      .expect(200);
    await anon
      .post('/auth/invitations/accept')
      .send({ token, password: 'Strong-Password1' })
      .expect(400);
    await loggedIn(ctx.app, 'sara@test.local', 'Strong-Password1');
    await anon.get('/auth/invitations/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').expect(400);

    // Re-import adds a role (never removes one).
    const more = await upload(admin, 'USERS', [
      { name: 'more.csv', data: Buffer.from('email,roles\nsara@test.local,Reviewer\n') },
    ]);
    const item = (await itemsOf(admin, more.id))[0];
    expect(item).toMatchObject({ action: 'UPDATE', matchBy: 'EMAIL' });
    await applyBatch(admin, more.id);
    const roles = await ctx.prisma.userRole.findMany({
      where: { user: { email: 'sara@test.local' } },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.key).sort()).toEqual(['MODELER', 'PROCESS_OWNER', 'REVIEWER']);

    // Undo of the user batch: blocked once a user has signed in.
    const check = (await admin.get(`/imports/${b.id}/undo`).expect(200)).body;
    expect(check.blockers).toEqual([expect.objectContaining({ reason: 'USER_SIGNED_IN' })]);
  });

  it('sends a "Sign in with Microsoft" welcome e-mail instead of an invitation once password sign-in is off', async () => {
    await superAdmin
      .put('/settings/email')
      .send({
        enabled: true,
        host: 'mailpit',
        port: 1025,
        fromAddress: 'hub@test.local',
        fromName: 'Hub',
      })
      .expect(200);
    const sup = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'super@test.local' } });
    const auth = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'auth' } });
    // SSO live, password sign-in off (only the break-glass Super Admin keeps a password).
    await ctx.prisma.setting.update({
      where: { key: 'auth' },
      data: {
        value: {
          ...(auth.value as object),
          ssoEnabled: true,
          clientId: 'client',
          clientSecretSealed: 'v1.sealed',
          localLoginEnabled: false,
          breakGlassUserId: sup.id,
        },
      },
    });
    const users = (rows: string[][]) =>
      xlsx(['E-mail', 'Name (English)', 'Roles (separated by ;)', 'Language (en / ar)'], rows);
    const b = await upload(superAdmin, 'USERS', [
      { name: 'users.xlsx', data: await users([['lina@test.local', 'Lina', 'Viewer', 'en']]) },
    ]);
    expect(b.issues.map((i: { code: string }) => i.code)).toContain('USERS_SSO_WELCOME');
    ctx.mail.sent = [];
    await applyBatch(superAdmin, b.id);
    expect(ctx.mail.sent).toHaveLength(1);
    const mail = ctx.mail.sent[0];
    expect(mail).toMatchObject({ to: 'lina@test.local' });
    expect(mail.text).toContain('Sign in with Microsoft');
    expect(mail.text).toContain('/login');
    expect(mail.text).not.toContain('/invitation/');
    expect(await ctx.prisma.userInvitation.count()).toBe(0);

    // Setting "welcome e-mail" off: no e-mail at all.
    await superAdmin
      .put('/imports/settings')
      .send({ ssoWelcomeEmail: false, allowAiOnImportedDocuments: false })
      .expect(200);
    const c = await upload(superAdmin, 'USERS', [
      { name: 'more.xlsx', data: await users([['omar@test.local', 'Omar', 'Viewer', 'ar']]) },
    ]);
    expect(c.issues.map((i: { code: string }) => i.code)).toContain('USERS_SIGN_IN_WITH_SSO');
    ctx.mail.sent = [];
    await applyBatch(superAdmin, c.id);
    expect(ctx.mail.sent).toHaveLength(0);
    expect(await ctx.prisma.userInvitation.count()).toBe(0);
  });
});
