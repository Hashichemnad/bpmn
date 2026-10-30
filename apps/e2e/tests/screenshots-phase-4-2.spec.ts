import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Documentation screenshots of Phase 4.2 (docs/screenshots/phase-4-2), English and Arabic, from the
 * demo seed. Not part of the regular suite: run with SCREENSHOTS=1 against a freshly seeded stack.
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(240_000);
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'phase-4-2');
const SAMPLES = join(__dirname, '..', '..', '..', 'docs', 'samples');

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

for (const locale of ['en', 'ar'] as const) {
  test(`assurance screenshots (${locale})`, async ({ page }) => {
    await login(page, DEMO.risk, locale);
    const tests = await apiCall<{ items: { id: string }[] }>(
      page,
      'GET',
      '/control-tests?conclusion=NOT_EFFECTIVE',
    );
    await page.goto(`/grc/tests/${tests.data.items[0].id}`);
    await expect(page.getByTestId('test-samples')).toBeVisible();
    await shot(page, '1-test-execution', locale);

    const issues = await apiCall<{ items: { id: string; code: string }[] }>(
      page,
      'GET',
      '/issues?sort=code&order=asc',
    );
    await page.goto(`/grc/issues/${issues.data.items.find((i) => i.code === 'ISS-0001')!.id}`);
    await expect(page.getByTestId('issue-actions')).toBeVisible();
    await shot(page, '2-issue-with-actions', locale);

    const questionnaires = await apiCall<{ id: string }[]>(page, 'GET', '/surveys/questionnaires');
    await page.goto(`/grc/surveys/questionnaires/${questionnaires.data[0].id}`);
    await page.locator('.ant-collapse-header').nth(1).click();
    await shot(page, '4-questionnaire-builder', locale);

    const campaigns = await apiCall<{ id: string }[]>(page, 'GET', '/surveys/campaigns');
    await page.goto(`/grc/surveys/campaigns/${campaigns.data[0].id}`);
    await expect(page.getByTestId('survey-results')).toBeVisible();
    await shot(page, '5-questionnaire-results', locale);

    await page.goto('/grc/assurance');
    await expect(page.getByTestId('tile-tests-done')).toBeVisible();
    await shot(page, '6-assurance-dashboard', locale);

    await login(page, DEMO.audit, locale);
    const audits = await apiCall<{ id: string }[]>(page, 'GET', '/audits');
    await page.goto(`/grc/audits/${audits.data[0].id}?tab=findings`);
    await expect(page.getByTestId('finding-F-01')).toBeVisible();
    await shot(page, '3-audit-engagement-findings', locale);
    // Sample audit report (docs/samples), downloaded like a user does.
    await page.getByTestId('audit-report').hover();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: locale === 'en' ? 'English' : 'العربية' }).click();
    await (await download).saveAs(join(SAMPLES, `sample-audit-report-${locale}.docx`));
    // Leave the demo users in English for the regular suite.
    await login(page, DEMO.audit, 'en');
    await login(page, DEMO.risk, 'en');
  });
}
