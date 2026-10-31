import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';
import { loginAdmin } from './helpers';

/**
 * Import Center (M15): batches upload → preview → apply → result, and the main migration flows
 * (process house, BPMN ZIP, Word SOP with a process link, undo, migration dashboard).
 */
test.setTimeout(120_000);

const stamp = Date.now().toString(36).toUpperCase();

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
  await expect(orphan).toContainText('does not exist');
  await orphan.getByRole('switch').click();
  await expect(page.getByTestId('import-apply')).toBeEnabled();
  await applyImport(page);
  await page
    .getByTestId('import-records')
    .getByRole('link', { name: /Imported child/ })
    .click();
  await expect(page.getByRole('heading', { level: 3 })).toContainText(`Imported child ${stamp}`);
});
