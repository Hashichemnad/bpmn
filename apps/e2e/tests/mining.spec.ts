import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login, setLocale } from './helpers';

/**
 * Process mining (Phase 5.1): import a CSV with the column mapping, validation report and import;
 * then (later steps) the process map, variants, conformance overlay and simulation scenarios.
 */
test.setTimeout(120_000);

/** Small purchase log: 6 cases, one with rework, one bad row, times in Asia/Dubai (day first). */
export function purchaseCsv(prefix: string) {
  const rows = ['Request;Step;Started;Finished;Clerk;Unit;Channel'];
  const day = (d: number, h: number, m = 0) =>
    `${String(d).padStart(2, '0')}/03/2026 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  for (let i = 1; i <= 6; i++) {
    const c = `${prefix}-${i}`;
    rows.push(`${c};Create request;${day(i, 8)};${day(i, 8, 30)};Sara;Procurement;web`);
    rows.push(`${c};Check budget;${day(i, 9)};${day(i, 10)};Omar;Finance;web`);
    if (i % 3 === 0) rows.push(`${c};Check budget;${day(i, 11)};${day(i, 12)};Omar;Finance;web`);
    rows.push(
      `${c};Approve request;${day(i, 13)};${day(i, 13, 20)};Lina;Finance;${i % 2 ? 'web' : 'email'}`,
    );
  }
  rows.push(`${prefix}-7;;${day(7, 8)};${day(7, 9)};Sara;Procurement;web`); // no activity → skipped
  return rows.join('\n');
}

export async function importCsv(page: Page, name: string, csv: string) {
  await page.goto('/mining/logs/new');
  await page.locator('input[type=file]').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByLabel('Name (English)').fill(name);
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  // Mapping suggested from the column names and values.
  const mapping = page.getByTestId('mining-mapping');
  await expect(mapping.getByTestId('map-caseColumn')).toContainText('Request');
  await expect(mapping.getByTestId('map-activityColumn')).toContainText('Step');
  await expect(mapping.getByTestId('map-startColumn')).toContainText('Started');
  await expect(mapping.getByTestId('map-endColumn')).toContainText('Finished');
  await expect(mapping.getByTestId('map-resourceColumn')).toContainText('Clerk');
  await expect(mapping.getByTestId('map-departmentColumn')).toContainText('Unit');
  // Extra attribute for filters.
  await mapping.locator('.ant-select-multiple').click();
  await page
    .locator('.ant-select-dropdown:visible')
    .locator('.ant-select-item-option-content', { hasText: /^Channel$/ })
    .click();
  await page.keyboard.press('Escape');
  await page.getByTestId('mining-validate').click();
  const report = page.getByTestId('mining-report');
  await expect(report).toContainText('1 rows without an activity');
  await page.getByTestId('mining-import').click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  return page.url().split('/mining/logs/')[1].split('/')[0];
}

test('import an event log: mapping, validation, import', async ({ page }) => {
  await login(page, DEMO.performance);
  const name = `E2E purchase ${Date.now()}`;
  const id = await importCsv(page, name, purchaseCsv(`P${Date.now() % 100000}`));
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  const log = await apiCall<{ caseCount: number; eventCount: number; attributeNames: string[] }>(
    page,
    'GET',
    `/mining/logs/${id}`,
  );
  expect(log.data).toMatchObject({ caseCount: 6, eventCount: 20, attributeNames: ['Channel'] });
  await page.getByRole('tab', { name: 'Activities and steps' }).click();
  await expect(page.getByTestId('mining-activities')).toContainText('Check budget');

  // Arabic: list and page in RTL.
  await setLocale(page, 'ar');
  await page.goto('/mining/logs');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('mining-logs')).toContainText(name);
  await page.goto(`/mining/logs/${id}`);
  await expect(page.getByRole('tab', { name: 'نظرة عامة' })).toBeVisible();
  await setLocale(page, 'en');

  // Other departments' users do not see the log; Viewers have no mining menu.
  await login(page, DEMO.viewer);
  expect((await apiCall(page, 'GET', `/mining/logs/${id}`)).status).toBe(403);
});
