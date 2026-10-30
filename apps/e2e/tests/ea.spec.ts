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

test('impact analysis after a step link; capability map colour-by; landscape and traceability', async ({
  page,
}) => {
  await login(page, DEMO.modeler);
  const processId = await createSampleProcess(page, `E2E.EB${stamp}`, {
    nameEn: `E2E impact ${stamp}`,
    nameAr: `أثر ${stamp}`,
  });
  await login(page, DEMO.architect);
  const app = await apiCall<{ item: { id: string } }>(page, 'POST', '/ea/applications', {
    code: `IMP-${stamp}`,
    nameEn: `Legacy finance ${stamp}`,
    lifecycle: 'PHASING_OUT',
  });
  expect(app.status).toBe(201);
  const appId = app.data.item.id;
  const other = await apiCall<{ item: { id: string } }>(page, 'POST', '/ea/applications', {
    code: `NEW-${stamp}`,
    nameEn: `New finance ${stamp}`,
    lifecycle: 'PLANNED',
  });
  await apiCall(page, 'POST', '/ea/interfaces', {
    sourceId: appId,
    targetId: other.data.item.id,
    technology: 'API',
  });
  const top = await apiCall<{ id: string }>(page, 'POST', '/ea/capabilities', {
    code: `L1-${stamp}`,
    nameEn: `Finance ${stamp}`,
  });
  await apiCall(page, 'POST', '/ea/capabilities', {
    code: `L2-${stamp}`,
    nameEn: `Accounting ${stamp}`,
    parentId: top.data.id,
    processIds: [processId],
    applicationIds: [appId],
  });

  // Not linked yet: nothing affected.
  await page.goto(`/ea/applications/${appId}`);
  await page.getByRole('tab', { name: 'Impact analysis' }).click();
  await expect(page.getByTestId('impact-steps')).toContainText('0');

  // A modeler links the application to two steps; the impact analysis shows them.
  await login(page, DEMO.modeler);
  for (const step of ['Task_CreateRequest', 'Task_Screening'])
    expect(
      (
        await apiCall(page, 'POST', `/processes/${processId}/links`, {
          bpmnElementId: step,
          repoObjectId: appId,
          relation: 'SUPPORTS',
        })
      ).status,
    ).toBe(201);
  await login(page, DEMO.architect);
  await page.goto(`/ea/applications/${appId}`);
  await page.getByRole('tab', { name: 'Impact analysis' }).click();
  await expect(page.getByTestId('impact-steps')).toContainText('2');
  await expect(page.getByTestId('impact-processes')).toContainText('1');
  await expect(page.getByTestId('impact-panel')).toContainText(`E2E.EB${stamp}`);

  // Capability map: colour by application lifecycle paints the capability orange (phasing out).
  await page.goto('/ea/capabilities?colourBy=lifecycle');
  const tile = page
    .getByTestId('cap-tile')
    .filter({ hasText: `Accounting ${stamp}` })
    .last();
  await expect(tile).toHaveAttribute('data-colour', '#d46b08');
  await page.goto('/ea/capabilities?colourBy=coverage');
  await expect(tile).toHaveAttribute('data-colour', '#fcd34d');
  await tile.click();
  await expect(page.getByTestId('cap-detail')).toContainText(`Legacy finance ${stamp}`);

  // Landscape of the capability with neighbours: both applications and the interface.
  await page.goto(`/ea/landscape?capabilityId=${top.data.id}&neighbours=true`);
  await expect(page.getByTestId('landscape-node')).toHaveCount(2);
  await expect(page.getByTestId('landscape-edge')).toHaveCount(1);

  // Traceability from the capability down to the steps.
  await page.goto(`/ea/traceability?capabilityId=${top.data.id}`);
  await expect(page.getByTestId('trace-table')).toContainText(`IMP-${stamp}`);
  await expect(page.getByTestId('trace-table').locator('tbody tr.ant-table-row')).toHaveCount(2);

  // Modeler: "Colour by → Application lifecycle" marks the two steps as phasing out.
  await page.goto(`/processes/${processId}/model`);
  await page.locator('.djs-container').waitFor();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByText('Application lifecycle', { exact: true }).click();
  const legend = page.getByRole('region', { name: 'Colour legend' });
  await expect(legend.getByRole('listitem').filter({ hasText: 'Phasing out' })).toContainText('2');
});
