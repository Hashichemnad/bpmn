import { expect, test } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login } from './helpers';
import { publishDiagram } from './diagram-helpers';

/** SIPOC (D-125): generated from a process, edited, versioned, published and read in the portal. */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const NAME_EN = `E2E SIPOC ${stamp}`;
let diagramId = '';

test('modeler generates a SIPOC from a process and edits it', async ({ page }) => {
  await login(page, DEMO.modeler);
  const processId = await createSampleProcess(page, `E2E.SIPOC.${stamp}`, {
    nameEn: `E2E program request ${stamp}`,
    nameAr: `طلب برنامج ${stamp}`,
  });
  await page.goto('/processes');
  await page.getByTestId('new-item').click();
  await page.getByRole('menuitem', { name: 'SIPOC' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill(NAME_EN);
  await dialog.getByLabel('Name (Arabic)').fill(`SIPOC ${stamp}`);
  await dialog.getByTestId('sipoc-generate-process').click();
  await page.keyboard.type(`E2E program request ${stamp}`);
  await page
    .locator('.ant-select-tree-node-content-wrapper', { hasText: `E2E program request ${stamp}` })
    .click();
  await dialog.getByLabel('Owner').fill('Omar');
  await page.locator('.ant-select-item-option', { hasText: 'Omar Owner' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/diagrams\/[0-9a-f-]{36}$/);
  diagramId = new URL(page.url()).pathname.split('/')[2];
  const generated = JSON.parse(
    (await apiCall<{ content: string }>(page, 'GET', `/diagrams/${diagramId}/content`)).data
      .content,
  );
  expect(generated.processId).toBe(processId);
  expect(generated.columns.steps.length).toBeGreaterThan(2);
  expect(generated.columns.steps.length).toBeLessThanOrEqual(7);

  await page.goto(`/diagrams/${diagramId}/edit`);
  await page.getByTestId('sipoc-add-customers').click();
  const added = page.locator('[data-column="customers"] li').last();
  await added.locator('input[data-field="nameEn"]').fill('Steering committee');
  await added.locator('input[data-field="nameAr"]').fill('اللجنة التوجيهية');
  await added.locator('input[data-field="nameAr"]').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Save version' }).click();
  await page.getByRole('dialog').getByLabel('Change note').fill('Customers reviewed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(/Version 2 saved/)).toBeVisible();
});

test('the published SIPOC is shown in the portal', async ({ page }) => {
  test.setTimeout(90_000);
  await publishDiagram(page, diagramId);
  await login(page, DEMO.viewer);
  await page.goto('/portal/diagrams?type=SIPOC');
  await page.getByText(NAME_EN).first().click();
  await expect(page.locator('.ph-sipoc-customers')).toContainText('Steering committee');
});
