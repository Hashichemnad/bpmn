import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Documentation screenshots of workflow execution (docs/screenshots/phase-5-2), English and Arabic, from
 * the demo seed (PMS-01, demo requests). Not part of the regular suite: run with SCREENSHOTS=1 against a
 * freshly seeded stack.
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(300_000);
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'phase-5-2');

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

/** Selects a diagram element with the side panel closed (it may cover the element), then opens the panel. */
async function selectElement(page: Page, id: string) {
  await page.locator('.djs-container').first().waitFor();
  const hide = page.locator(
    'button[aria-label="Hide side panel"], button[aria-label="إخفاء اللوحة الجانبية"]',
  );
  if (await hide.first().isVisible()) await hide.first().click();
  await page.locator(`[data-element-id="${id}"]`).first().click();
  const show = page.locator(
    'button[aria-label="Show side panel"], button[aria-label="إظهار اللوحة الجانبية"]',
  );
  if (await show.first().isVisible()) await show.first().click();
}

for (const locale of ['en', 'ar'] as const) {
  test(`workflow execution (${locale})`, async ({ page }) => {
    await login(page, DEMO.owner, locale);
    const list = await apiCall<{ items: { id: string; code: string }[] }>(
      page,
      'GET',
      '/processes?q=PMS-01&pageSize=50',
    );
    const pms = list.data.items.find((p) => p.code === 'PMS-01')!;
    const tab = locale === 'ar' ? 'التنفيذ' : 'Execution';

    // 1. Execution tab: the section manager review (assignment, due time, four-eyes, form).
    await page.goto(`/processes/${pms.id}/model`);
    await selectElement(page, 'SectionReview');
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByTestId('exec-assignment')).toBeVisible();
    await shot(page, '1-execution-tab', locale);

    // 2. Form editor: the start form with its bilingual preview.
    await selectElement(page, 'Start');
    await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('button', { name: locale === 'ar' ? 'معاينة' : 'Preview' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();
    await shot(page, '2-form-editor', locale);
    await page.keyboard.press('Escape');

    // 3. Service catalogue and 4. start form (portal, requester).
    await login(page, DEMO.viewer, locale);
    await page.goto('/portal/services');
    await expect(page.getByTestId('start-PMS-01')).toBeVisible();
    await shot(page, '3-service-catalogue', locale);
    await page.getByTestId('start-PMS-01').click();
    await expect(page.getByTestId('wf-submit-request')).toBeVisible();
    await shot(page, '4-start-form', locale);

    // 5. Inbox with a workflow task (budget approval, overdue) and the task page.
    await login(page, 'finance@processhub.local', locale);
    await page.goto('/tasks?tab=workflow');
    await expect(page.getByTestId('wf-tasks')).toBeVisible();
    await shot(page, '5-inbox', locale);
    await page
      .getByTestId('wf-tasks')
      .locator('.ant-table-row')
      .first()
      .getByRole('link')
      .first()
      .click();
    await expect(page.getByTestId('wf-decision-APPROVE')).toBeVisible();
    await shot(page, '6-task', locale);

    // 7. Request page with the highlighted diagram (requester).
    await login(page, DEMO.viewer, locale);
    const cases = await apiCall<{ items: { id: string; number: string }[] }>(
      page,
      'GET',
      '/workflow/cases?scope=mine&pageSize=50',
    );
    const waiting =
      cases.data.items.find((c) => c.number.endsWith('-00004')) ?? cases.data.items[0];
    await page.goto(`/portal/workflow/cases/${waiting.id}`);
    await expect(page.getByTestId('case-diagram')).toBeVisible();
    await shot(page, '7-case-page', locale);

    // 8. Workflow monitor and 9. dashboard (process owner).
    await login(page, DEMO.owner, locale);
    await page.goto('/workflow/monitor');
    await expect(page.getByTestId('wf-monitor-processes')).toBeVisible();
    await shot(page, '8-monitor', locale);
    await page.goto('/workflow/dashboard');
    await expect(page.getByTestId('wf-dashboard-tiles')).toBeVisible();
    await shot(page, '9-dashboard', locale);
    await login(page, DEMO.owner, 'en');
  });
}
