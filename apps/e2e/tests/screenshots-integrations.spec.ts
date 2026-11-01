import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, login, loginAdmin } from './helpers';

/**
 * Documentation screenshots of Phase 4.4 (docs/screenshots/integrations), English and Arabic: API keys,
 * the webhook delivery log, Teams destinations and the report subscription form. The offline HTML export,
 * a PowerPoint slide and the Teams card are captured from generated files (see docs/screenshots/README).
 * Not part of the regular suite: run with SCREENSHOTS=1 against a seeded stack.
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(300_000);
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'integrations');

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

for (const locale of ['en', 'ar'] as const) {
  test(`integration screens (${locale})`, async ({ page }) => {
    await loginAdmin(page, locale);
    await page.goto('/settings/integrations');
    await expect(page.locator('.ant-table-row').first()).toBeVisible();
    await shot(page, 'api-keys', locale);

    await page.goto('/settings/integrations?tab=webhooks');
    const row = page.locator('.ant-table-row').first();
    await expect(row).toBeVisible();
    // A test event, so the log has an entry, then the log with the first payload opened.
    await row.locator('button').nth(1).click();
    await page.waitForTimeout(2500);
    await row.locator('button').first().click();
    const drawer = page.locator('.ant-drawer');
    await expect(drawer.locator('.ant-table-row').first()).toBeVisible();
    await drawer.locator('.ant-table-row-expand-icon').first().click();
    await shot(page, 'webhook-log', locale);
    await page.keyboard.press('Escape');

    await page.goto('/settings/integrations?tab=teams');
    await page.locator('.ant-table-row').first().locator('button').nth(2).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, 'teams-destination', locale);

    await login(page, DEMO.performance, locale);
    await page.goto('/reports/subscriptions');
    await expect(page.locator('.ant-table-row').first()).toBeVisible();
    await shot(page, 'subscriptions', locale);
    await page
      .getByRole('button', { name: locale === 'en' ? 'New subscription' : 'اشتراك جديد' })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').locator('label.ant-radio-wrapper', { hasText: 'PDF' }).click();
    await shot(page, 'subscription-form', locale);
  });
}
