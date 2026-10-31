import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';
import { publishDiagram } from './diagram-helpers';

/**
 * Organisation chart (D-122): generated from departments and roles, a position shows the steps it
 * performs (RACI), regeneration previews the merge, then version → review → publish → portal.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const NAME_EN = `E2E organisation ${stamp}`;
let diagramId = '';

test('modeler generates an organisation chart from departments and roles', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto('/processes');
  await page.getByTestId('new-item').click();
  await page.getByRole('menuitem', { name: 'Organisation chart' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill(NAME_EN);
  await dialog.getByLabel('Name (Arabic)').fill(`الهيكل ${stamp}`);
  await dialog.getByTestId('org-generate-new').click();
  await dialog.getByLabel('Owner').fill('Omar');
  await page.locator('.ant-select-item-option', { hasText: 'Omar Owner' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/diagrams\/[0-9a-f-]{36}$/);
  diagramId = new URL(page.url()).pathname.split('/')[2];
  const content = await apiCall<{ content: string }>(page, 'GET', `/diagrams/${diagramId}/content`);
  const nodes = JSON.parse(content.data.content).nodes as { kind: string; nameEn: string }[];
  expect(nodes.filter((n) => n.kind === 'unit').map((n) => n.nameEn)).toContain('Finance');
  expect(nodes.filter((n) => n.kind === 'position').map((n) => n.nameEn)).toContain(
    'Procurement Officer',
  );
});

test('a position shows what it performs; regeneration keeps manual edits', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto(`/diagrams/${diagramId}/edit`);
  const canvas = page.locator('.ph-ws-canvas');
  const position = canvas.locator('.djs-shape', { hasText: 'Procurement Officer' });
  await position.click({ force: true });
  await expect(page.getByTestId('org-activities')).toContainText('Purchase');
  // Manual edit: an Arabic label for the position.
  await page.locator('input[data-field="nameAr"]').fill('مسؤول المشتريات');
  await page.locator('input[data-field="nameAr"]').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Regenerate: preview, nothing removed, the manual layout is kept.
  await page.getByTestId('org-regenerate').click();
  await expect(page.getByTestId('org-preview')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Save version' }).click();
  await page.getByRole('dialog').getByLabel('Change note').fill('Reviewed positions');
  await page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(/Version 2 saved/)).toBeVisible();
});

test('the published organisation chart is shown in the portal', async ({ page }) => {
  test.setTimeout(90_000);
  await publishDiagram(page, diagramId);
  await login(page, DEMO.viewer);
  await page.goto('/portal/diagrams?type=ORG_CHART');
  await page.getByText(NAME_EN).first().click();
  await expect(page.locator('.ph-graph-canvas')).toContainText('Procurement Officer');
});
