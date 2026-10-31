import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';
import { loginAdmin } from './helpers';

/**
 * Import Center (M15): batches upload → preview → apply → result, and the main migration flows
 * (process house, BPMN ZIP, Word SOP with a process link, undo, migration dashboard).
 */
test.setTimeout(120_000);

const stamp = Date.now().toString(36).toUpperCase();
const SAMPLES = join(__dirname, '..', '..', '..', 'docs', 'samples', 'import');
const sampleFile = (name: string, mimeType = 'application/octet-stream') => ({
  name,
  mimeType,
  buffer: readFileSync(join(SAMPLES, name)),
});

async function workbook(header: string[], rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Opens the Import Center, picks a kind and uploads files; lands on the batch page. */
async function startImport(
  page: Page,
  kind: string,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  options?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await page.goto('/admin/imports');
  await page.getByTestId(`import-kind-${kind}`).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles(files);
  if (options) await options(dialog);
  await page.getByTestId('import-upload').click();
  await expect(page).toHaveURL(/\/admin\/imports\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('import-status').first()).toHaveText(/Ready to apply|Failed/, {
    timeout: 30_000,
  });
}

/** Applies the batch on the batch page and waits for the result. */
async function applyImport(page: Page) {
  await page.getByTestId('import-apply').click();
  await page.getByTestId('import-apply-ok').click();
  await expect(page.getByTestId('import-status').first()).toHaveText('Applied', {
    timeout: 60_000,
  });
}

test('Import Center: an existing register import runs as a batch with dry run and result', async ({
  page,
}) => {
  await loginAdmin(page);
  const data = await workbook(
    [
      'Code',
      'Title (English)',
      'Category (key)',
      'Inherent likelihood (1-5)',
      'Inherent impact (1-5)',
    ],
    [[`R-E2E-${stamp}`, `Imported risk ${stamp}`, 'FINANCIAL', 2, 3]],
  );
  await startImport(page, 'GRC_RISKS', [
    {
      name: 'risks.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: data,
    },
  ]);
  await expect(page.getByTestId('import-summary')).toContainText('Dry run');
  await expect(page.getByTestId('import-items')).toContainText('risks.xlsx');
  await applyImport(page);
  await expect(page.getByTestId('import-summary')).toContainText('Register import: 1 rows, 1 new');
  await expect(page.getByTestId('import-records')).toContainText('Created');
  // The batch is listed in the history.
  await page.goto('/admin/imports');
  await expect(page.getByTestId('import-batches')).toContainText('Risks (Excel)');
});

test('Process house from Excel: preview with validation, apply, process tree built as drafts', async ({
  page,
}) => {
  await loginAdmin(page);
  const root = `E2E${stamp}`;
  const data = await workbook(
    ['Process code', 'Name (English)', 'Name (Arabic)', 'Category', 'Parent code'],
    [
      [root, `Imported house ${stamp}`, `بيت مستورد ${stamp}`, 'Core', ''],
      [`${root}.01`, `Imported child ${stamp}`, `عملية فرعية ${stamp}`, '', root],
      [`${root}.02`, `Orphan ${stamp}`, '', '', 'NOPE.99'],
    ],
  );
  await startImport(page, 'PROCESS_HOUSE', [
    {
      name: 'process-house.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: data,
    },
  ]);
  await expect(page.getByTestId('import-mapping')).toBeVisible();
  // The orphan row blocks apply until it is excluded.
  await expect(page.getByTestId('import-apply')).toBeDisabled();
  const orphan = page.getByTestId('import-items').locator('tr', { hasText: `${root}.02` });
  await expect(orphan).toContainText('exists neither in the file nor in ProcessHub');
  await orphan.getByRole('switch').click();
  await expect(page.getByTestId('import-apply')).toBeEnabled();
  await applyImport(page);
  await page
    .getByTestId('import-records')
    .getByRole('link', { name: /Imported child/ })
    .click();
  await expect(page.getByRole('heading', { level: 3 })).toContainText(`Imported child ${stamp}`);
});

test('BPMN ZIP: Arabic and English diagrams, one without layout; imported flag on the process', async ({
  page,
}) => {
  await loginAdmin(page);
  // New processes (the demo data already has processes with some of the sample codes).
  await startImport(page, 'BPMN', [sampleFile('bpmn-diagrams.zip', 'application/zip')], (dialog) =>
    dialog.getByText('Always create new processes').click(),
  );
  const items = page.getByTestId('import-items');
  await expect(items).toContainText('تسجيل الطلبات');
  await expect(items).toContainText('laid out automatically');
  await applyImport(page);
  await page
    .getByTestId('import-records')
    .getByRole('row', { name: /Created Process .*Supplier onboarding/ })
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByTestId('imported-tag')).toBeVisible();
});

test('Visio flowchart: the shape mapping table lists masters and unmapped shapes', async ({
  page,
}) => {
  await loginAdmin(page);
  await startImport(page, 'VISIO', [sampleFile('S.03 Leave request flowchart.vsdx')], (dialog) =>
    dialog.getByText('Always create new processes').click(),
  );
  const mapping = page.getByTestId('visio-mapping');
  await expect(mapping).toContainText('swimlane');
  await expect(mapping).toContainText('document');
  await expect(page.getByTestId('import-items')).toContainText('not mapped to BPMN');
  await applyImport(page);
  await expect(page.getByTestId('import-records')).toContainText('Created');
});

test('Word SOP into the wiki: page in the chosen space, RTL Arabic document, process link suggestion', async ({
  page,
}) => {
  await loginAdmin(page);
  await startImport(
    page,
    'WORD',
    [
      sampleFile('C.01.01 SOP Handle enquiries (EN).docx'),
      sampleFile('C.01.02 إجراء تسجيل الطلبات (AR).docx'),
    ],
    async (dialog) => {
      await dialog.locator('#spaceId').click({ force: true });
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
    },
  );
  await expect(page.getByTestId('import-items')).toContainText('إجراء العمل القياسي');
  await applyImport(page);
  await page
    .getByTestId('import-records')
    .getByRole('link', { name: /إجراء العمل القياسي/ })
    .first()
    .click();
  await expect(page.getByTestId('imported-tag')).toBeVisible();
  await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
});

test('Undo a batch while its items are drafts; the migration dashboard and review queue', async ({
  page,
}) => {
  await loginAdmin(page);
  const code = `U${stamp}`;
  const data = await workbook(
    ['Process code', 'Name (English)', 'Name (Arabic)', 'Category'],
    [[code, `Undo me ${stamp}`, `تراجع ${stamp}`, 'Support']],
  );
  await startImport(page, 'PROCESS_HOUSE', [
    {
      name: 'undo.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: data,
    },
  ]);
  await applyImport(page);
  await page.getByTestId('import-undo').click();
  await page.getByTestId('import-undo-ok').click();
  await expect(page.getByTestId('import-status').first()).toHaveText('Undone');

  await page.goto('/admin/imports/dashboard');
  await expect(page.getByTestId('migration-tiles')).toContainText('Items');
  await expect(page.getByTestId('migration-departmentId')).toBeVisible();
  await page.getByRole('tab', { name: 'By process-house branch' }).click();
  await expect(page.getByTestId('migration-branchId')).toBeVisible();
  await page.getByRole('link', { name: 'Review queue' }).click();
  await expect(page.getByTestId('review-items')).toBeVisible();
  await page
    .getByTestId('review-items')
    .locator('tbody tr.ant-table-row')
    .first()
    .locator('.ant-checkbox-input')
    .check();
  await page.getByTestId('review-validate').click();
  await expect(page.getByTestId('review-result')).toBeVisible();
});

test('Full export: the Super Admin downloads the repository package with its manifest', async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto('/admin/imports');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByTestId('full-export').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^processhub-export-.*\.zip$/);
  const path = await download.path();
  const head = readFileSync(path).subarray(0, 2).toString('latin1');
  expect(head).toBe('PK');
});
