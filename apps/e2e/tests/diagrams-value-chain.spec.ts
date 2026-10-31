import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Value chain main flow (D-120 / D-121), run in order: a modeler creates a value chain generated
 * from the process house, edits it in the workspace and saves a version; it goes through review
 * (reviewer, owner), is published and a viewer drills down from it to a process in the portal.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const NAME_EN = `E2E value chain ${stamp}`;
const NAME_AR = `سلسلة القيمة ${stamp}`;
let diagramId = '';

async function approveFromTasks(page: Page) {
  await page.goto('/tasks');
  const row = page.getByRole('row', { name: new RegExp(NAME_EN) });
  await row.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page).toHaveURL(/\/reviews\/[0-9a-f-]+/);
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('modeler creates a value chain generated from the process house', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto('/processes');
  await page.getByTestId('new-item').click();
  await page.getByRole('menuitem', { name: 'Value chain' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill(NAME_EN);
  await dialog.getByLabel('Name (Arabic)').fill(NAME_AR);
  await dialog.getByTestId('vc-generate-new').click();
  await dialog.getByLabel('Owner').fill('Omar');
  await page.locator('.ant-select-item-option', { hasText: 'Omar Owner' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/diagrams\/[0-9a-f-]{36}$/);
  diagramId = new URL(page.url()).pathname.split('/')[2];
  // Frames for Management / Core / Support with linked chevrons and blocks; version 1 saved.
  await expect(page.locator('.ph-graph-canvas .djs-shape').first()).toBeVisible();
  const content = await apiCall<{ content: string }>(page, 'GET', `/diagrams/${diagramId}/content`);
  const nodes = JSON.parse(content.data.content).nodes as { kind: string; processId?: string }[];
  expect(nodes.filter((n) => n.kind === 'frame')).toHaveLength(3);
  expect(nodes.filter((n) => n.kind === 'chevron' && n.processId).length).toBeGreaterThan(0);
  // Shown in the repository tree under "Diagrams".
  await expect(page.locator('.ph-tree').getByText(NAME_EN)).toBeVisible();
});

test('modeler edits the value chain and saves a version', async ({ page }) => {
  // Stepped drags on the canvas are slow on a loaded CI runner.
  test.setTimeout(60_000);
  await login(page, DEMO.modeler);
  await page.goto(`/diagrams/${diagramId}/edit`);
  const canvas = page.locator('.ph-ws-canvas');
  await expect(canvas.locator('.djs-shape').first()).toBeVisible();
  // Add a primary activity from the palette and name it on the canvas.
  await page.locator('.ph-palette-entry[data-kind="chevron"]').click();
  const box = (await canvas.boundingBox())!;
  // Several moves: diagram-js needs a hover over the canvas to accept the drop.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width - 160, box.y + box.height - 120, { steps: 5 });
  await page.mouse.click(box.x + box.width - 160, box.y + box.height - 120);
  await page.keyboard.type('Customer feedback');
  await page.mouse.click(box.x + 20, box.y + 20);
  // Arabic label in the properties panel.
  await canvas.locator('.djs-shape', { hasText: 'Customer feedback' }).click();
  await page.locator('input[data-field="nameAr"]').fill('ملاحظات العملاء');
  await page.locator('input[data-field="nameAr"]').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Colour by process status shows a legend.
  await page.getByTestId('vc-colour-by').click();
  await page.getByRole('menuitem', { name: 'Process status' }).click();
  await expect(page.locator('.ph-vc-legend')).toBeVisible();
  await page.getByRole('button', { name: 'Save version' }).click();
  await page.getByRole('dialog').getByLabel('Change note').fill('Added customer feedback');
  await page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(/Version 2 saved/)).toBeVisible();
  const content = await apiCall<{ content: string }>(page, 'GET', `/diagrams/${diagramId}/content`);
  expect(content.data.content).toContain('ملاحظات العملاء');
});

test('modeler submits, reviewer and owner approve, owner publishes', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, DEMO.modeler);
  await page.goto(`/diagrams/${diagramId}`);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Submitted for review')).toBeVisible();

  await login(page, DEMO.reviewer);
  await approveFromTasks(page);
  await login(page, DEMO.owner);
  await approveFromTasks(page);
  await page.goto(`/diagrams/${diagramId}`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published — now the official version')).toBeVisible();
});

test('viewer drills down from the published value chain to a process', async ({ page }) => {
  await login(page, DEMO.viewer);
  await page.goto('/portal/diagrams?type=VALUE_CHAIN');
  await page.getByText(NAME_EN).first().click();
  await expect(page).toHaveURL(new RegExp(`/portal/diagrams/${diagramId}`));
  const drill = page.locator('.ph-graph-canvas .djs-shape.ph-drill').first();
  await expect(drill).toBeVisible();
  await drill.click();
  await expect(page).toHaveURL(/\/portal\/processes\/[0-9a-f-]{36}/);
});

test('Arabic workspace shows the Arabic labels', async ({ page }) => {
  await login(page, DEMO.modeler, 'ar');
  await page.goto(`/diagrams/${diagramId}/edit?view=1`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.ph-ws-canvas')).toContainText('ملاحظات العملاء');
  await expect(page.locator('.ph-ws-canvas')).toContainText('العمليات الرئيسية');
  await login(page, DEMO.modeler, 'en');
});
