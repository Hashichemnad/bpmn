import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login, sample } from './helpers';

/**
 * Main flow, run in order: a modeler creates a process in the process house, imports the PMS-01
 * sample in the full-screen workspace, adds a ready-made step, saves a version and submits it;
 * the reviewer and the owner approve, the owner publishes; a viewer finds it in the portal.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const CODE = `E2E.${stamp}`;
const NAME_EN = `E2E Program request ${stamp}`;
const NAME_AR = `طلب برنامج ${stamp}`;
let processId = '';

/** Opens the workspace of the test process and waits for the diagram. */
async function openWorkspace(page: Page) {
  await page.goto(`/processes/${processId}/model`);
  await expect(page.locator('.ph-ws-canvas .djs-container svg').first()).toBeVisible();
}

/** Opens the review of the test process from My tasks and approves it. */
async function approveFromTasks(page: Page) {
  await page.goto('/tasks');
  const row = page.getByRole('row', { name: new RegExp(NAME_EN) });
  await row.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page).toHaveURL(/\/reviews\/[0-9a-f-]+/);
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('modeler creates a process in the process house', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Process house' })).toBeVisible();
  await page.getByRole('button', { name: 'New process' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code').fill(CODE);
  await dialog.getByLabel('Name (English)').fill(NAME_EN);
  await dialog.getByLabel('Name (Arabic)').fill(NAME_AR);
  await dialog.getByLabel('Owner').fill('Omar');
  await page.locator('.ant-select-item-option', { hasText: 'Omar Owner' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/processes\/[0-9a-f-]{36}/);
  processId = new URL(page.url()).pathname.split('/')[2];
  await expect(page.getByText(NAME_EN).first()).toBeVisible();
});

test('modeler imports PMS-01, adds a ready-made step and saves a version', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto(`/processes/${processId}?tab=model`);
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect(page).toHaveURL(new RegExp(`/processes/${processId}/model`));
  await expect(page.locator('.ph-ws-canvas .djs-container svg').first()).toBeVisible();

  // Import the sample (the menu entry opens this file input).
  await page
    .locator('input[type=file][accept*=bpmn]')
    .setInputFiles(sample('PMS-01-Program-Request-Approval.bpmn'));
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Diagram imported')).toBeVisible();
  const lanes = page.locator('.djs-element[data-element-id^="Lane"]');
  await expect(lanes).toHaveCount(8);

  // Ready-made step: pick it in the palette, then click into the top lane (its right part is
  // empty in PMS-01; the mini-map covers the bottom-right corner).
  await page.getByRole('button', { name: 'Approval step' }).click();
  const boxes = await lanes.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().toJSON()),
  );
  const lane = boxes.sort((a, b) => a.y - b.y)[0] as DOMRect;
  // bpmn-js tracks the pointer over the canvas before a click places the shape.
  const at = { x: lane.x + lane.width - 120, y: lane.y + lane.height / 2 };
  await page.mouse.move(at.x - 40, at.y - 10);
  await page.mouse.move(at.x, at.y, { steps: 5 });
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Escape');
  // New shapes get generated ids (Activity_…); the sample uses Task_… ids.
  await expect(page.locator('.djs-shape[data-element-id^="Activity_"]')).toHaveCount(1);

  // At 1280 px the top bar shows icons only (no "Save version" text).
  await page.locator('.ph-ws-tools button:has(.anticon-save)').click();
  await page.getByLabel('Change note').fill('Imported PMS-01 and added an approval step');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Version 1 saved')).toBeVisible();

  const versions = await apiCall<{ versionNumber: number }[]>(
    page,
    'GET',
    `/processes/${processId}/versions`,
  );
  expect(versions.data[0]?.versionNumber).toBe(1);
  const model = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${processId}/model`);
  expect(model.data.bpmnXml).toMatch(
    /ph:nameEn="Approve request"[^>]*ph:stepKind="approval"|ph:stepKind="approval"[^>]*ph:nameEn="Approve request"/,
  );
});

test('modeler submits the version for review', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto(`/processes/${processId}`);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Submitted for review')).toBeVisible();
});

test('reviewer approves the quality review step', async ({ page }) => {
  await login(page, DEMO.reviewer);
  await approveFromTasks(page);
});

test('owner approves and publishes', async ({ page }) => {
  await login(page, DEMO.owner);
  await approveFromTasks(page);
  await page.goto(`/processes/${processId}`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published — now the official version')).toBeVisible();
});

test('viewer opens the published process in the Knowledge Portal', async ({ page }) => {
  await login(page, DEMO.viewer);
  await expect(page).toHaveURL(/\/portal/);
  await page.goto(`/portal/processes/${processId}`);
  await expect(page.getByText(NAME_EN).first()).toBeVisible();
  await expect(page.locator('.djs-container svg').first()).toBeVisible();
  await expect(page.locator('.djs-shape[data-element-id^="Activity_"]')).toHaveCount(1);
});

test('Arabic workspace is right-to-left with the palette on the right', async ({ page }) => {
  await login(page, DEMO.modeler, 'ar');
  await openWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // Labels follow the active language (ph:nameAr).
  await expect(page.locator('.djs-shape[data-element-id^="Activity_"] text')).toContainText(
    'اعتماد',
  );
  const palette = await page.locator('.ph-palette').boundingBox();
  const canvas = await page.locator('.ph-ws-canvas').boundingBox();
  expect(palette && canvas && palette.x > canvas.x).toBeTruthy();
});
