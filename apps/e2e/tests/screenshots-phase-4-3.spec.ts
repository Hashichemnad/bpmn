import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login, loginAdmin, setLocale } from './helpers';
import { SalesforceMock } from './salesforce-mock';

/**
 * Documentation screenshots of Phase 4.3 (docs/screenshots/phase-4-3), English and Arabic, from the
 * demo seed. Not part of the regular suite: run with SCREENSHOTS=1 against a freshly seeded stack
 * (the Salesforce shots use the mock, see salesforce.spec.ts for E2E_SALESFORCE_MOCK_HOST).
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(240_000);
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'phase-4-3');
const mock = new SalesforceMock(
  Number(process.env.E2E_SALESFORCE_MOCK_PORT ?? 7071),
  process.env.E2E_SALESFORCE_MOCK_HOST ?? 'host.docker.internal',
);
test.beforeAll(() => mock.start());
test.afterAll(() => mock.stop());

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

for (const locale of ['en', 'ar'] as const) {
  test(`architecture and KPI screenshots (${locale})`, async ({ page }) => {
    await login(page, DEMO.architect, locale);
    const apps = await apiCall<{ items: { id: string; code: string }[] }>(
      page,
      'GET',
      '/ea/applications?q=SYS-01',
    );
    const erp = apps.data.items.find((a) => a.code === 'SYS-01')!;
    await page.goto(`/ea/applications/${erp.id}`);
    await page.getByRole('tab').nth(1).click();
    await expect(page.getByTestId('impact-panel')).toBeVisible();
    await shot(page, '1-application-impact-analysis', locale);

    await page.goto('/ea/landscape');
    await expect(page.getByTestId('landscape-svg')).toBeVisible();
    await shot(page, '2-interface-diagram', locale);

    await page.goto('/ea/capabilities?colourBy=lifecycle');
    await expect(page.getByTestId('cap-tile').first()).toBeVisible();
    await shot(page, '3-capability-map', locale);

    await login(page, DEMO.owner, locale);
    await page.goto('/kpis/dashboard');
    await expect(page.getByTestId('kpi-scorecard')).toBeVisible();
    await shot(page, '4-kpi-dashboard', locale);

    const kpis = await apiCall<{ items: { id: string; code: string }[] }>(
      page,
      'GET',
      '/kpis?q=KPI-07',
    );
    await page.goto(`/kpis/${kpis.data.items.find((k) => k.code === 'KPI-07')!.id}`);
    await expect(page.getByTestId('kpi-chart')).toBeVisible();
    await shot(page, '5-kpi-detail-chart', locale);

    const procs = await apiCall<{ id: string; code: string }[]>(page, 'GET', '/processes/tree');
    const req = procs.data.find((p) => p.code === 'S.01.01')!;
    await page.goto(`/processes/${req.id}/model?element=Task_Approve`);
    await expect(
      page.locator('.djs-overlay .ph-badge[class*="ph-badge-kpi_"]').first(),
    ).toBeVisible();
    await page
      .getByRole('tab')
      .filter({ hasText: locale === 'ar' ? 'المؤشرات' : 'KPIs' })
      .first()
      .click();
    await shot(page, '6-modeler-kpi-badges', locale);

    await loginAdmin(page, locale);
    await page.goto('/settings/salesforce');
    const form = page.getByTestId('salesforce-form');
    await form.locator('#instanceUrl').fill(mock.url);
    await form.locator('#clientId').fill('3MVG9FAKE.client.id');
    const enabled = form.getByRole('switch').first();
    if (!(await enabled.isChecked())) {
      await form.locator('#clientSecret').fill('mock-secret');
      await enabled.click();
    }
    await page
      .getByRole('button', { name: locale === 'ar' ? 'حفظ' : 'Save' })
      .first()
      .click();
    await page
      .getByRole('button', { name: locale === 'ar' ? 'معاينة التغييرات' : 'Preview changes' })
      .click();
    await expect(page.getByTestId('salesforce-preview')).toBeVisible();
    await shot(page, '7-salesforce-settings-preview', locale);
    // Leave the demo users in English for the regular suite.
    await setLocale(page, 'en');
    await login(page, DEMO.owner, 'en');
    await login(page, DEMO.architect, 'en');
  });
}
