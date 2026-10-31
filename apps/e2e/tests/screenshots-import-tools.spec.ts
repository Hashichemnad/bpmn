import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, loginAdmin } from './helpers';

/**
 * Documentation screenshots of the import tools (docs/screenshots/import-tools), English and Arabic:
 * batch preview with the validation report, Visio shape mapping, a Word SOP as an Arabic wiki page,
 * the migration dashboard and the Import Center with the full export. Not part of the regular suite:
 * run with SCREENSHOTS=1 against a seeded stack.
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(300_000);
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'import-tools');
const SAMPLES = join(__dirname, '..', '..', '..', 'docs', 'samples', 'import');

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

/** Creates a batch through the API (multipart upload from the signed-in browser) and waits for it. */
async function batch(
  page: Page,
  kind: string,
  files: { name: string; data: Buffer }[],
  options: Record<string, unknown> = {},
  apply = false,
): Promise<string> {
  const id = await page.evaluate(
    async ({ kind, files, options }) => {
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('ph_csrf='))
        ?.split('=')[1];
      const form = new FormData();
      form.append('kind', kind);
      form.append('options', JSON.stringify(options));
      for (const f of files) form.append('files', new Blob([new Uint8Array(f.data)]), f.name);
      const res = await fetch('/api/v1/imports', {
        method: 'POST',
        headers: { 'x-csrf-token': decodeURIComponent(csrf ?? '') },
        body: form,
      });
      return ((await res.json()) as { id: string }).id;
    },
    { kind, files: files.map((f) => ({ name: f.name, data: [...f.data] })), options },
  );
  const wait = async () => {
    for (let i = 0; i < 120; i++) {
      const b = await apiCall<{ status: string }>(page, 'GET', `/imports/${id}`);
      if (!['UPLOADED', 'PARSING', 'APPLYING'].includes(b.data.status)) return b.data.status;
      await page.waitForTimeout(500);
    }
    return 'TIMEOUT';
  };
  await wait();
  if (apply) {
    await apiCall(page, 'POST', `/imports/${id}/apply`);
    await wait();
  }
  return id;
}

const sample = (name: string) => ({ name, data: readFileSync(join(SAMPLES, name)) });

for (const locale of ['en', 'ar'] as const) {
  test(`import tools (${locale})`, async ({ page }) => {
    await loginAdmin(page, locale);
    const stamp = `${locale.toUpperCase()}${Date.now().toString(36).toUpperCase()}`;

    // 1. Batch preview: column mapping, dry run and the validation report (a missing parent).
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Process house');
    ws.addRow([
      'Process code',
      'Name (English)',
      'Name (Arabic)',
      'Category',
      'Parent code',
      'Owner (e-mail)',
    ]);
    ws.addRow([
      `X${stamp}`,
      'Customer services',
      'خدمات المتعاملين',
      'Core',
      '',
      'owner@processhub.local',
    ]);
    ws.addRow([`X${stamp}.01`, 'Handle enquiries', 'معالجة الاستفسارات', '', `X${stamp}`, '']);
    ws.addRow([
      `X${stamp}.02`,
      'Register requests',
      'تسجيل الطلبات',
      '',
      `X${stamp}`,
      'nobody@example.org',
    ]);
    ws.addRow([`X${stamp}.03`, 'Close requests', '', '', 'Q.99', '']);
    const house = await batch(page, 'PROCESS_HOUSE', [
      { name: 'process-house.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()) },
    ]);
    await page.goto(`/admin/imports/${house}`);
    await expect(page.getByTestId('import-items')).toBeVisible();
    await shot(page, '1-batch-preview', locale);

    // 2. Visio shape mapping.
    const visio = await batch(page, 'VISIO', [sample('S.03 Leave request flowchart.vsdx')], {
      attachTo: 'CREATE',
    });
    await page.goto(`/admin/imports/${visio}`);
    await expect(page.getByTestId('visio-mapping')).toBeVisible();
    await page.getByTestId('visio-mapping').scrollIntoViewIfNeeded();
    await shot(page, '2-visio-mapping', locale);

    // 3. Word SOP → wiki page (Arabic document, right-to-left).
    const spaces = await apiCall<{ id: string }[]>(page, 'GET', '/spaces');
    const word = await batch(
      page,
      'WORD',
      [sample('C.01.02 إجراء تسجيل الطلبات (AR).docx')],
      { spaceId: spaces.data[0].id, pageTemplate: 'SOP' },
      true,
    );
    const records = await apiCall<{ items: { entity: string; href: string | null }[] }>(
      page,
      'GET',
      `/imports/${word}/records`,
    );
    await page.goto(records.data.items.find((r) => r.entity === 'PAGE')!.href!);
    await expect(page.getByTestId('imported-tag')).toBeVisible();
    await shot(page, '3-word-page-ar', locale);

    // 4. Migration dashboard.
    await page.goto('/admin/imports/dashboard');
    await expect(page.getByTestId('migration-tiles')).toBeVisible();
    await shot(page, '4-migration-dashboard', locale);

    // 5. Import Center with the batch history and the full export.
    await page.goto('/admin/imports');
    await expect(page.getByTestId('full-export')).toBeVisible();
    await shot(page, '5-import-center-full-export', locale);
  });
}
