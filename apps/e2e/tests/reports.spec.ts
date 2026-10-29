import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login } from './helpers';

/**
 * Reports (Modeler design B2): the process handbook (.docx) and the RACI matrix (.xlsx) download
 * from the process page; Viewers get published content only (the audit entry is covered by the API
 * tests).
 */
const stamp = Date.now().toString(36).toUpperCase();

async function download(page: Page, item: string) {
  await page.getByRole('button', { name: /More/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    dialog.getByRole('button', { name: 'Download' }).click(),
  ]);
  await expect(dialog).toBeHidden();
  const path = await file.path();
  return readFileSync(path);
}

test('handbook and RACI download; viewer gets published content only', async ({ page }) => {
  await login(page, DEMO.modeler);
  const id = await createSampleProcess(page, `E2E.R${stamp}`, {
    nameEn: `E2E reports ${stamp}`,
    nameAr: `تقارير ${stamp}`,
  });
  await page.goto(`/processes/${id}`);
  await expect(page.getByTestId('process-totals')).toBeVisible();

  // Both files are zip containers (Office Open XML) with real content.
  const docx = await download(page, 'Process handbook (Word)');
  expect(docx.subarray(0, 2).toString()).toBe('PK');
  expect(docx.length).toBeGreaterThan(20_000);
  const xlsx = await download(page, 'RACI matrix (Excel)');
  expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  expect(xlsx.length).toBeGreaterThan(5_000);

  // A Viewer cannot export an unpublished process.
  await login(page, DEMO.viewer);
  const raci = await apiCall<{ code: string }>(page, 'GET', `/reports/raci/${id}?locale=en`);
  expect(raci.status).toBe(404);
  expect(raci.data.code).toBe('NOT_PUBLISHED');
});
