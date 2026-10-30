import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login } from './helpers';

/**
 * Risk & Compliance (Phase 4.1): an officer records a risk, links it to a step in the modeler, sees
 * it on the heat map and the coverage dashboard; the portal shows risks and controls only as the
 * setting allows; an Excel import is checked before anything is imported.
 */
const stamp = Date.now().toString(36).toUpperCase();

async function pickOption(page: Page, field: string, text: string) {
  await page.locator(`#${field}`).click({ force: true });
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: text })
    .first()
    .click();
}

test('create a risk, link it to a step, see it on the heat map and the coverage dashboard', async ({
  page,
}) => {
  await login(page, DEMO.modeler);
  const processId = await createSampleProcess(page, `E2E.G${stamp}`, {
    nameEn: `E2E risks ${stamp}`,
    nameAr: `مخاطر ${stamp}`,
  });

  await login(page, DEMO.risk);
  await page.goto('/grc/risks');
  await page.getByRole('button', { name: 'New risk' }).click();
  const form = page.getByTestId('grc-form');
  await form.locator('#code').fill(`E2E-R${stamp}`);
  await form.locator('#nameEn').fill(`Unapproved programme ${stamp}`);
  await pickOption(page, 'category', 'Strategic');
  await pickOption(page, 'inherentLikelihood', '5 · Almost certain');
  await pickOption(page, 'inherentImpact', '5 · Severe');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('grc-register-RISK')).toContainText(
    `Unapproved programme ${stamp}`,
  );

  // Link it to a step in the modeler (Risk & Compliance officers need no model rights).
  await page.goto(`/processes/${processId}/model?element=Task_CreateRequest`);
  await page.getByRole('tab').filter({ hasText: 'Risks & Controls' }).first().click();
  const panel = page.getByTestId('grc-step-panel');
  await panel.locator('.ant-select').last().click();
  await page.keyboard.type(`E2E-R${stamp}`);
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: `E2E-R${stamp}` })
    .click();
  await panel.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(panel.getByTestId('grc-step-RISK')).toContainText(`Unapproved programme ${stamp}`);
  await expect(panel).toContainText('high risk without an effective control');
  await expect(page.locator('.djs-overlay .ph-badge-alert').first()).toBeVisible();

  // Dashboard of the process: residual cell 5 × 5 and the coverage tiles.
  await page.goto(`/grc/dashboard?processId=${processId}`);
  const cell = page.getByTestId('grc-heatmap-residual').locator('[data-cell="5,5"]');
  await expect(cell).toHaveText('1');
  await expect(page.getByTestId('grc-tile-alertRisksWithoutEffectiveControl')).toContainText('1');
  await expect(page.getByTestId('grc-tile-stepsWithRiskNoControl')).toContainText('1');
  await cell.click();
  await expect(page.getByTestId('grc-cell-risks')).toContainText(`Unapproved programme ${stamp}`);
  await page.getByTestId('grc-tile-risksWithoutControls').click();
  await expect(page).toHaveURL(/\/grc\/risks\?.*withoutControls=true/);
  await expect(page.getByTestId('grc-register-RISK')).toContainText(
    `Unapproved programme ${stamp}`,
  );
});

test('the portal shows linked risks and controls only as the setting allows', async ({ page }) => {
  // Six sign-ins and three portal pages.
  test.setTimeout(60_000);
  await login(page, DEMO.risk);
  const settings = (await apiCall<Record<string, unknown>>(page, 'GET', '/grc/settings')).data;
  const set = async (portalVisibility: string) =>
    expect(
      (await apiCall(page, 'PUT', '/grc/settings', { ...settings, portalVisibility })).status,
    ).toBe(200);
  const list = await apiCall<{ items: { id: string; code: string }[] }>(
    page,
    'GET',
    '/processes?q=S.01&pageSize=50',
  );
  const p2p = list.data.items.find((p) => p.code === 'S.01')!;
  try {
    for (const [mode, control, riskShown] of [
      ['OFF', false, false],
      ['CONTROLS', true, false],
      ['ALL', true, true],
    ] as const) {
      await set(mode);
      await login(page, DEMO.viewer);
      await page.goto(`/portal/processes/${p2p.id}`);
      await page.locator('.djs-shape[data-element-id="Task_Pay"]').click();
      const details = page.locator('.ant-card').filter({ hasText: 'Pay supplier' }).last();
      await expect(details).toBeVisible();
      await expect(details.getByText('Payment run approval')).toHaveCount(control ? 1 : 0);
      await expect(details.getByText('Payment to a fraudulent bank account')).toHaveCount(
        riskShown ? 1 : 0,
      );
      await login(page, DEMO.risk);
    }
  } finally {
    await set('OFF');
  }
});

test('Excel import shows a validation report and imports nothing while there are errors', async ({
  page,
}) => {
  await login(page, DEMO.risk);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Risks');
  ws.addRow([
    'Code',
    'Title (English)',
    'Category (key)',
    'Inherent likelihood (1-5)',
    'Inherent impact (1-5)',
  ]);
  ws.addRow([`E2E-X${stamp}`, 'Bad rating', 'FRAUD', 9, 2]);
  ws.addRow([`E2E-Y${stamp}`, 'Bad category', 'NOPE', 2, 2]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.goto('/grc/risks');
  await page.getByRole('button', { name: 'Excel' }).click();
  await page.getByText('Import from Excel').click();
  await page.locator('.ant-modal input[type=file]').setInputFiles({
    name: 'risks.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  const report = page.getByTestId('grc-import-report');
  await expect(report).toContainText('2 rows: 2 new, 0 updated');
  await expect(report).toContainText('Must be 1 to 5');
  await expect(report).toContainText('Unknown category key');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  const check = await apiCall<{ total: number }>(page, 'GET', `/grc/risks?q=E2E-X${stamp}`);
  expect(check.data.total).toBe(0);
});
