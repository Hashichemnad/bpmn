import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login, sample } from './helpers';

/**
 * Documentation screenshots of process mining and simulation (docs/screenshots/phase-5-1), English
 * and Arabic, from the demo seed (LOG-001, S.01.04, SIM-001). Not part of the regular suite: run
 * with SCREENSHOTS=1 against a freshly seeded stack.
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(300_000);
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'phase-5-1');

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

for (const locale of ['en', 'ar'] as const) {
  test(`process mining and simulation (${locale})`, async ({ page }) => {
    await login(page, DEMO.performance, locale);
    const logs = await apiCall<{
      items: { id: string; code: string; process: { id: string } | null }[];
    }>(page, 'GET', '/mining/logs?q=LOG-001');
    const log = logs.data.items.find((l) => l.code === 'LOG-001')!;

    // 1. Import: column mapping with the preview (sample CSV).
    await page.goto('/mining/logs/new');
    await page.locator('input[type=file]').setInputFiles({
      name: 'invoice-processing-log.csv',
      mimeType: 'text/csv',
      buffer: readFileSync(sample('invoice-processing-log.csv')),
    });
    await page.locator('#nameEn').fill(`Screenshot ${locale}`);
    await page.locator('button[type=submit]').click();
    await expect(page.getByTestId('mining-mapping')).toBeVisible();
    await shot(page, '1-import-mapping', locale);
    const draft = page.url().split('/mining/logs/')[1].split('/')[0];
    await apiCall(page, 'DELETE', `/mining/logs/${draft}`);

    // 2. Process map (performance view) with the sliders.
    await page.goto(`/mining/logs/${log.id}/map`);
    await expect(page.getByTestId('process-map')).toBeVisible();
    await page.getByTestId('map-mode').locator('.ant-segmented-item').nth(1).click();
    await shot(page, '2-process-map', locale);

    // 3. Variants.
    await page.goto(`/mining/logs/${log.id}/variants`);
    await expect(page.getByTestId('variants-table')).toBeVisible();
    await shot(page, '3-variants', locale);

    // 4. Statistics.
    await page.goto(`/mining/logs/${log.id}/statistics`);
    await expect(page.getByTestId('mining-stats')).toBeVisible();
    await shot(page, '4-statistics', locale);

    // 5. Conformance and the overlay on the BPMN model.
    await page.goto(`/mining/logs/${log.id}/conformance`);
    await expect(page.getByTestId('conformance-summary')).toBeVisible();
    await shot(page, '5-conformance', locale);
    await page.goto(
      `/processes/${log.process!.id}/model?view=1&colourBy=miningDuration&log=${log.id}`,
    );
    await expect(page.locator('.ph-metric-badge').first()).toBeVisible();
    await shot(page, '6-conformance-overlay', locale);

    // 6. Simulation: scenario comparison and the bottleneck view.
    const sims = await apiCall<{ id: string; code: string }[]>(page, 'GET', '/simulations');
    const sim = sims.data.find((s) => s.code === 'SIM-001')!;
    await page.goto(`/mining/simulations/${sim.id}`);
    await expect(page.getByTestId('sim-comparison')).toBeVisible();
    await shot(page, '7-simulation-scenarios', locale);
    await page.getByTestId('sim-comparison').scrollIntoViewIfNeeded();
    await shot(page, '8-simulation-comparison', locale);
    await page.goto(`/processes/${log.process!.id}/model?view=1&colourBy=simUtilisation`);
    await expect(page.locator('.ph-metric-badge').first()).toBeVisible();
    await shot(page, '9-simulation-bottlenecks', locale);
  });
}
