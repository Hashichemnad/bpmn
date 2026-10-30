import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * KPIs (Phase 4.3, M12): the owner of a seeded KPI sees the due value in My tasks, enters it with a
 * comment, and the status follows the thresholds on the KPI page and in the catalogue.
 */
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
