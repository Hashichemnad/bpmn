import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login, loginAdmin } from './helpers';
import { SalesforceMock } from './salesforce-mock';

/**
 * Salesforce KPI link (Phase 4.3) against the mock API: a Super Admin configures the link, tests
 * the connection, previews and applies the import; a changed value in Salesforce is updated by
 * the next sync. Mock host: E2E_SALESFORCE_MOCK_HOST (default host.docker.internal for the
 * Docker stack; `localhost` for an API started on the host).
 */
const mock = new SalesforceMock(
  Number(process.env.E2E_SALESFORCE_MOCK_PORT ?? 7071),
  process.env.E2E_SALESFORCE_MOCK_HOST ?? 'host.docker.internal',
);
test.beforeAll(() => mock.start());
test.afterAll(() => mock.stop());
test.setTimeout(90_000);

test('configure, test, preview and sync; a re-sync updates the values', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/settings/salesforce');
  const form = page.getByTestId('salesforce-form');
  const enabled = form.getByRole('switch').first();
  if (!(await enabled.isChecked())) await enabled.click();
  await form.locator('#instanceUrl').fill(mock.url);
  await form.getByLabel('OAuth 2.0 client credentials').check();
  await form.locator('#clientId').fill('3MVG9FAKE.client.id');
  await form.locator('#clientSecret').fill('mock-secret');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Changes saved')).toBeVisible();

  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByTestId('salesforce-test')).toContainText('00DFAKE0000000000');

  // A value that differs from earlier runs, so the sync always has something to update.
  const value = 40 + (Date.now() % 50);
  const results = mock.records.Org_Kpi_Process__c as { records: Record<string, unknown>[] };
  results.records[1].Achieve_Value__c = value;
  await page.getByRole('button', { name: 'Preview changes' }).click();
  const preview = page.getByTestId('salesforce-preview');
  await expect(preview).toContainText('KPIs');
  await expect(preview).toContainText(/\d+ new · \d+ changed/);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('salesforce-runs').locator('tbody tr').first()).toContainText(
    'Succeeded',
  );

  // The imported KPI: source Salesforce, value from the mock.
  const list = await apiCall<{ items: { id: string; code: string }[] }>(
    page,
    'GET',
    '/kpis?q=KPI-0001',
  );
  const kpi = list.data.items.find((k) => k.code === 'KPI-0001')!;
  await page.goto(`/kpis/${kpi.id}`);
  await expect(page.getByTestId('kpi-salesforce')).toContainText('Source: Salesforce');
  await expect(page.getByTestId('kpi-measurements')).toContainText(`${value}%`);

  // Changed in Salesforce → the next sync updates the value.
  results.records[1].Achieve_Value__c = value + 1;
  await page.goto('/settings/salesforce');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByTestId('salesforce-preview')).toContainText('1 changed');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('salesforce-runs').locator('tbody tr').first()).toContainText(
    'Succeeded',
  );
  await page.goto(`/kpis/${kpi.id}`);
  await expect(page.getByTestId('kpi-measurements')).toContainText(`${value + 1}%`);

  // Read-only for everybody else: the KPI owner role cannot enter Salesforce values.
  await login(page, DEMO.owner);
  const denied = await apiCall(page, 'PUT', `/kpis/${kpi.id}/measurements`, {
    period: '2025-Q2',
    value: 1,
  });
  expect([400, 403]).toContain(denied.status);
  const settings = await apiCall(page, 'GET', '/integrations/salesforce');
  expect(settings.status).toBe(403);
});
