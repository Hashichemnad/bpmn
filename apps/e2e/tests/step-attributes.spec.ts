import { expect, test } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login } from './helpers';

/**
 * Step attributes and "colour by" (Modeler design B2): times entered in the side panel are saved
 * as ph: attributes, the duration view colours by band (view only) and the process page shows
 * the totals with the planned time of the main path.
 */
const stamp = Date.now().toString(36).toUpperCase();

test('step times, colour by duration and process totals', async ({ page }) => {
  await login(page, DEMO.modeler);
  const id = await createSampleProcess(page, `E2E.S${stamp}`, {
    nameEn: `E2E attributes ${stamp}`,
    nameAr: `خصائص ${stamp}`,
  });
  await page.goto(`/processes/${id}/model`);
  await page.locator('.djs-shape[data-element-id="Task_CreateRequest"]').click();
  await page.locator('.ph-step-attributes .ant-collapse-header').click();
  // 2 hours of processing, 1 day of waiting.
  await page.getByRole('spinbutton', { name: 'Planned processing time' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Waiting time' }).fill('');
  await page.getByRole('combobox', { name: 'Waiting time — unit' }).click({ force: true });
  await page.locator('.ant-select-item-option', { hasText: 'days' }).last().click();
  await page.getByRole('spinbutton', { name: 'Waiting time' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Cost per execution' }).fill('40');
  await page.getByRole('spinbutton', { name: 'Cost per execution' }).blur();

  // Colour by planned duration: one step "1 to 8 hours"; the stored XML colours stay untouched.
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByText('Planned duration', { exact: true }).click();
  const legend = page.getByRole('region', { name: 'Colour legend' });
  await expect(legend.getByRole('listitem').filter({ hasText: '1 to 8 hours' })).toContainText('1');
  await expect(page.locator('.djs-element.ph-cb-dim').first()).toBeAttached();

  await expect
    .poll(async () => {
      const m = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${id}/model`);
      return m.data.bpmnXml;
    })
    .toMatch(/id="Task_CreateRequest"[^>]*ph:durationMinutes="120"/);
  const xml = (await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${id}/model`)).data
    .bpmnXml;
  expect(xml).toMatch(/id="Task_CreateRequest"[^>]*ph:waitingMinutes="1440"/);
  expect(xml).toMatch(/id="Task_CreateRequest"[^>]*ph:costPerExecution="40"/);
  expect(xml).not.toContain('ph-cb-');

  // Totals on the process page: the main path includes the step with times.
  await page.goto(`/processes/${id}`);
  const totals = page.getByTestId('process-totals');
  await expect(totals).toContainText('Steps');
  await expect(totals).toContainText('1 d 2 h');
});
