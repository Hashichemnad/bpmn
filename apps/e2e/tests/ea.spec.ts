import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login } from './helpers';

/**
 * Enterprise architecture (Phase 4.3, M11): an architect records an application, relates it to a
 * capability and a data object; the step link made in the modeler shows on the application.
 */
const stamp = Date.now().toString(36).toUpperCase();

async function pickOption(page: Page, field: string, text: string) {
  await page.locator(`#${field}`).click({ force: true });
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: text })
    .first()
    .click();
}

test('application catalogue: create an application, capability and data object; step link shows', async ({
  page,
}) => {
  await login(page, DEMO.modeler);
  const processId = await createSampleProcess(page, `E2E.EA${stamp}`, {
    nameEn: `E2E architecture ${stamp}`,
    nameAr: `بنية ${stamp}`,
  });

  await login(page, DEMO.architect);
  await page.goto('/ea/applications');
  await page.getByRole('button', { name: 'New application' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#code').fill(`APP-${stamp}`);
  await dialog.locator('#nameEn').fill(`Grants portal ${stamp}`);
  await dialog.locator('#vendor').fill('Acme');
  await pickOption(page, 'lifecycle', 'Phasing out');
  await dialog.locator('#hostingCountry').fill('ae');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 3 })).toContainText(`Grants portal ${stamp}`);
  await expect(page.getByTestId('lifecycle-PHASING_OUT')).toBeVisible();
  const appId = page.url().split('/').pop()!;

  // A modeler links the application to a step (the existing IT system link of the modeler).
  await login(page, DEMO.modeler);
  const link = await apiCall(page, 'POST', `/processes/${processId}/links`, {
    bpmnElementId: 'Task_CreateRequest',
    repoObjectId: appId,
    relation: 'SUPPORTS',
  });
  expect(link.status).toBe(201);

  await login(page, DEMO.architect);
  await page.goto(`/ea/applications/${appId}`);
  await expect(page.getByTestId('app-steps')).toContainText(`E2E.EA${stamp}`);

  // Capability with the application; the catalogue filters by capability.
  await page.goto('/ea/capabilities?view=list');
  await page.getByRole('button', { name: 'New capability' }).click();
  const cap = page.getByRole('dialog');
  await cap.locator('#code').fill(`CAP-${stamp}`);
  await cap.locator('#nameEn').fill(`Grant management ${stamp}`);
  await cap.locator('#applicationIds').click({ force: true });
  await page.keyboard.type(`APP-${stamp}`);
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: `APP-${stamp}` })
    .click();
  await page.keyboard.press('Escape');
  await cap.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.ant-table')).toContainText(`Grant management ${stamp}`);

  // Data object with the application in the CRUD matrix.
  const data = await apiCall(page, 'POST', '/ea/data-objects', {
    code: `D-${stamp}`,
    nameEn: `Grant ${stamp}`,
    systemOfRecordId: appId,
    usages: [{ applicationId: appId, create: true, read: true }],
  });
  expect(data.status).toBe(201);
  await page.goto(`/ea/data?view=matrix&q=${stamp}`);
  await expect(page.getByTestId('crud-matrix')).toContainText('CR ★');

  // Viewers (portal only) never reach the architecture workspace.
  await login(page, DEMO.viewer);
  const denied = await apiCall(page, 'GET', '/ea/applications');
  expect(denied.status).toBe(403);
});
