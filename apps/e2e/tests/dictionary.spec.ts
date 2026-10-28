import { expect, test } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login } from './helpers';

/**
 * Dictionary (Modeler design B2): propose → approve in the library, label autocomplete on the
 * canvas (matching a synonym), linked-label marker, rename with preview updating the diagram.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const TERM = { en: `Program request ${stamp}`, ar: `طلب إدارة ${stamp}` };
const SYNONYM = `Initiative ${stamp}`;
const PROPOSED = `Gate review ${stamp}`;
let processId = '';
let termId = '';

test('modeler proposes a term; the owner approves it in the dictionary', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto('/library/dictionary');
  await page.getByRole('button', { name: 'Propose a term' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Your proposal is a draft')).toBeVisible();
  await dialog.getByLabel('Name (English)').fill(PROPOSED);
  await dialog.getByLabel('Definition (English)').fill('Decision point between phases.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Term proposed')).toBeVisible();

  await login(page, DEMO.owner);
  await page.goto('/library/dictionary');
  await page.getByRole('tab', { name: /Proposals/ }).click();
  const row = page.getByRole('row', { name: new RegExp(PROPOSED) });
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Term approved')).toBeVisible();
  await page.getByRole('tab', { name: 'Approved terms' }).click();
  await expect(page.getByRole('row', { name: new RegExp(PROPOSED) })).toBeVisible();
});

test('label autocomplete on the canvas links a step to a term (synonym match)', async ({
  page,
}) => {
  await login(page, DEMO.owner);
  const term = await apiCall<{ id: string; status: string }>(page, 'POST', '/dictionary/terms', {
    type: 'TERM',
    nameEn: TERM.en,
    nameAr: TERM.ar,
    synonymsEn: [SYNONYM],
  });
  expect(term.data.status).toBe('APPROVED');
  termId = term.data.id;

  await login(page, DEMO.modeler);
  processId = await createSampleProcess(page, `E2E.D${stamp}`, {
    nameEn: `E2E dictionary ${stamp}`,
    nameAr: `قاموس ${stamp}`,
  });
  await page.goto(`/processes/${processId}/model`);
  const task = page.locator('.djs-shape[data-element-id="Task_CreateRequest"]');
  await task.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(`initiative ${stamp.toLowerCase()}`);
  const option = page.locator('.ph-label-suggest-item', { hasText: TERM.en });
  await expect(option).toBeVisible();
  await expect(option).toContainText(SYNONYM);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ph-labelref-marker')).toHaveCount(1);

  await task.click();
  await expect(page.locator('.ph-panel-labelref')).toContainText(TERM.en);
  await expect(page.getByLabel('Name (Arabic)')).toHaveValue(TERM.ar);
  // Autosave writes the reference; the API links the step to the term.
  await expect
    .poll(async () => {
      const links = await apiCall<{ bpmnElementId: string; relation: string }[]>(
        page,
        'GET',
        `/processes/${processId}/links`,
      );
      return links.data.map((l) => `${l.bpmnElementId}:${l.relation}`);
    })
    .toContain('Task_CreateRequest:NAMED');
});

test('owner renames the term with a preview; the diagram label follows', async ({ page }) => {
  await login(page, DEMO.owner);
  await page.goto(`/library/objects/${termId}`);
  await page.getByRole('button', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill(`Initiative request ${stamp}`);
  await dialog.getByRole('button', { name: 'Show affected diagrams' }).click();
  await expect(dialog.getByRole('row', { name: new RegExp(`E2E.D${stamp}`) })).toContainText(
    'New version',
  );
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByText(/Renamed — 1 process updated/)).toBeVisible();

  const model = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${processId}/model`);
  expect(model.data.bpmnXml).toContain(`ph:nameEn="Initiative request ${stamp}"`);
  const versions = await apiCall<{ changeNote: string }[]>(
    page,
    'GET',
    `/processes/${processId}/versions`,
  );
  expect(versions.data[0].changeNote).toContain('renamed to');
});

test('Arabic: the canvas autocomplete matches Arabic names with spelling variants', async ({
  page,
}) => {
  await login(page, DEMO.modeler, 'ar');
  await page.goto(`/processes/${processId}/model`);
  const task = page.locator('.djs-shape[data-element-id="Task_DDReview"]');
  // Select first (the panel opens on the left in Arabic), then edit the label.
  await task.click();
  await expect(page.locator('.ph-ws-panel')).toBeVisible();
  await task.dblclick();
  await page.keyboard.press('Control+A');
  // Typed without hamza and with ه for ة: still matches "طلب إدارة".
  await page.keyboard.type(`طلب اداره ${stamp.toLowerCase()}`);
  const option = page.locator('.ph-label-suggest-item', { hasText: TERM.ar });
  await expect(option).toBeVisible();
  await expect(page.locator('.ph-label-suggest')).toHaveAttribute('dir', 'rtl');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ph-labelref-marker')).toHaveCount(2);
});
