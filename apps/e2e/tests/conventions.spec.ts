import { expect, test } from '@playwright/test';
import { DEMO, createSampleProcess, login } from './helpers';

/**
 * Modeling conventions (Modeler design B2): with the default rules (warnings only) the Validation
 * panel lists the convention findings of PMS-01 — its lanes are not linked to library roles — and
 * clicking one selects the step. Blocking "Submit for review" is covered by the API tests (the
 * rules are global, so this suite does not change them).
 */
const stamp = Date.now().toString(36).toUpperCase();

test('Validation panel shows modeling conventions (EN and AR)', async ({ page }) => {
  await login(page, DEMO.modeler);
  const id = await createSampleProcess(page, `E2E.V${stamp}`, {
    nameEn: `E2E conventions ${stamp}`,
    nameAr: `قواعد ${stamp}`,
  });
  await page.goto(`/processes/${id}/model`);
  await page.getByRole('button', { name: 'Validation' }).click();
  const section = page.getByRole('region', { name: 'Modeling conventions' });
  await expect(section).toBeVisible();
  const finding = section
    .getByRole('button')
    .filter({ hasText: 'Step is not in a lane linked to a role.' })
    .filter({ hasText: 'Create program request' });
  await expect(finding).toBeVisible();
  await finding.click();
  await expect(
    page.locator('.djs-shape.selected[data-element-id="Task_CreateRequest"]'),
  ).toBeVisible();

  await login(page, DEMO.modeler, 'ar');
  await page.goto(`/processes/${id}/model`);
  await page.getByRole('button', { name: 'التحقق' }).click();
  await expect(
    page
      .getByRole('region', { name: 'قواعد النمذجة' })
      .getByText('الخطوة ليست في مسار مرتبط بدور.')
      .first(),
  ).toBeVisible();
  await login(page, DEMO.modeler, 'en');
});
