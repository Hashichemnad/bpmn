import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login, loginAdmin } from './helpers';

/**
 * KPIs (Phase 4.3, M12): the owner of a seeded KPI sees the due value in My tasks, enters it with a
 * comment, and the status follows the thresholds on the KPI page and in the catalogue.
 */
// Several sign-ins per test: a longer budget than the 30 s default.
test.setTimeout(90_000);

test('enter a KPI measurement: status and catalogue update', async ({ page }) => {
  await login(page, DEMO.owner);
  const list = await apiCall<{ items: { id: string; code: string; duePeriod: string }[] }>(
    page,
    'GET',
    '/kpis?q=KPI-06',
  );
  const kpi = list.data.items.find((k) => k.code === 'KPI-06')!;
  expect(kpi).toBeTruthy();
  // Remove the value of the due period (earlier runs) so the task appears again.
  const before = await apiCall<{ measurements: { id: string; period: string }[] }>(
    page,
    'GET',
    `/kpis/${kpi.id}`,
  );
  const existing = before.data.measurements.find((m) => m.period === kpi.duePeriod);
  if (existing) await apiCall(page, 'DELETE', `/kpis/${kpi.id}/measurements/${existing.id}`);

  await page.goto('/tasks?tab=kpis');
  await expect(page.getByTestId('kpi-tasks')).toContainText('KPI-06');
  await page.getByTestId('kpi-tasks').getByRole('button', { name: 'Enter value' }).first().click();
  await expect(page.getByRole('heading', { level: 3 })).toContainText('Digital service adoption');

  // Below the red threshold (60) → off target.
  await page.getByRole('button', { name: 'Enter value' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#value').fill('55');
  await expect(dialog.getByTestId('rag-RED')).toBeVisible();
  await dialog.locator('#comment').fill('Channel outage in the last week');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('kpi-measurements')).toContainText('Channel outage');
  await expect(page.getByRole('heading', { level: 3 }).getByTestId('rag-RED')).toBeVisible();
  await expect(page.getByTestId('kpi-chart')).toBeVisible();

  // Corrected value above the target (80) → on target, also in the catalogue.
  await page.getByTestId('kpi-measurements').getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('dialog').locator('#value').fill('83');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 3 }).getByTestId('rag-GREEN')).toBeVisible();
  await page.goto('/kpis?q=KPI-06');
  await expect(page.getByTestId('kpi-register')).toContainText('83%');
  await expect(page.getByTestId('kpi-register').getByTestId('rag-GREEN')).toBeVisible();

  // Another user's KPI cannot be measured by the owner role without ownership (server check).
  await login(page, DEMO.modeler);
  const denied = await apiCall(page, 'PUT', `/kpis/${kpi.id}/measurements`, {
    period: kpi.duePeriod,
    value: 1,
  });
  expect(denied.status).toBe(403);
});

test('KPI dashboard, process performance, modeler KPI badge and colour-by, portal setting', async ({
  page,
}) => {
  await login(page, DEMO.owner);
  // KPI-07 (IT incidents within SLA) is off target in the demo data.
  await page.goto('/kpis/dashboard');
  await expect(page.getByTestId('kpi-scorecard')).toContainText('KPI-07');
  const red = Number(
    await page.getByTestId('kpi-tile-RED').locator('.ant-statistic-content-value').innerText(),
  );
  expect(red).toBeGreaterThan(0);
  // Drill-down: the chart of the KPI.
  await page.getByTestId('kpi-scorecard').getByText('KPI-07', { exact: false }).first().click();
  await expect(page.getByTestId('kpi-drawer').getByTestId('kpi-chart')).toBeVisible();
  await page.keyboard.press('Escape');
  // A filter by process narrows the scorecard; the tiles open the filtered register.
  const procs = await apiCall<{ id: string; code: string }[]>(page, 'GET', '/processes/tree');
  const req = procs.data.find((p) => p.code === 'S.01.01')!;
  await page.goto(`/kpis/dashboard?processId=${req.id}`);
  await expect(page.getByTestId('kpi-scorecard')).toContainText('KPI-01');
  await expect(page.getByTestId('kpi-scorecard')).not.toContainText('KPI-07');

  // Process page: performance card with the KPIs and the calculated process KPIs.
  await page.goto(`/processes/${req.id}`);
  await expect(page.getByTestId('process-kpis')).toContainText('KPI-01');
  await expect(page.getByTestId('calculated-kpis')).toBeVisible();

  // Modeler: a KPI badge on the approval step and "Colour by → KPI status".
  await page.goto(`/processes/${req.id}/model`);
  await expect(
    page.locator('.djs-overlay .ph-badge[class*="ph-badge-kpi_"]').first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByText('KPI status', { exact: true }).click();
  const legend = page.getByRole('region', { name: 'Colour legend' });
  await expect(legend.getByRole('listitem').first()).toBeVisible();

  // Portal: KPIs only with "Show KPIs in the portal" (off by default; on for this test, then off).
  await loginAdmin(page);
  const set = (on: boolean) =>
    apiCall(page, 'PUT', '/kpis/settings', { showInPortal: on, reminders: true });
  expect((await set(true)).status).toBe(200);
  await login(page, DEMO.viewer);
  const published = await apiCall<{ id: string; code: string }[]>(page, 'GET', '/portal/processes');
  const withKpis = published.data.find((p) => p.code === 'S.01.01');
  if (withKpis) {
    const res = await apiCall<{ kpis: unknown[] | null }>(
      page,
      'GET',
      `/portal/processes/${withKpis.id}`,
    );
    expect(res.data.kpis).not.toBeNull();
  }
  await loginAdmin(page);
  expect((await set(false)).status).toBe(200);
});
