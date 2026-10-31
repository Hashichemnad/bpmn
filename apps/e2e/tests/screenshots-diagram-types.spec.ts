import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';
import { publishDiagram } from './diagram-helpers';

/**
 * Documentation screenshots of the diagram types (docs/screenshots/diagram-types), editor and
 * portal, English and Arabic, from the demo seed. Not part of the regular suite: run with
 * SCREENSHOTS=1 against a freshly seeded stack.
 */
test.skip(!process.env.SCREENSHOTS, 'documentation screenshots only (SCREENSHOTS=1)');
test.setTimeout(300_000);
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });

const OUT = join(__dirname, '..', '..', '..', 'docs', 'screenshots', 'diagram-types');

async function shot(page: Page, name: string, locale: 'en' | 'ar') {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${name}-${locale}.png`), fullPage: false });
}

type Seeded = { id: string; code: string; status: string };
let diagrams: Record<string, Seeded> = {};

test('demo diagrams are published for the portal shots', async ({ page }) => {
  await login(page, DEMO.modeler);
  const all = await apiCall<Seeded[]>(page, 'GET', '/diagrams/all');
  diagrams = Object.fromEntries(all.data.map((d) => [d.code, d]));
  for (const code of ['EPC-001', 'SIPOC-001'])
    if (diagrams[code].status !== 'PUBLISHED') {
      await login(page, DEMO.modeler);
      await apiCall(page, 'POST', `/governance/diagrams/${diagrams[code].id}/submit`, {});
      await publishDiagram(page, diagrams[code].id).catch(() => undefined);
    }
});

for (const locale of ['en', 'ar'] as const) {
  test(`editor screenshots (${locale})`, async ({ page }) => {
    await login(page, DEMO.modeler, locale);
    const all = await apiCall<Seeded[]>(page, 'GET', '/diagrams/all');
    diagrams = Object.fromEntries(all.data.map((d) => [d.code, d]));
    const open = async (code: string) => {
      await page.goto(`/diagrams/${diagrams[code].id}/edit?view=1`);
      await expect(page.locator('.ph-ws')).toBeVisible();
    };
    await open('VC-001');
    await page
      .getByTestId('vc-colour-by')
      .click()
      .catch(() => undefined);
    await page
      .getByRole('menuitem')
      .nth(1)
      .click()
      .catch(() => undefined);
    await shot(page, '1-value-chain-editor', locale);
    await open('ORG-001');
    await page
      .locator('.ph-ws-canvas .djs-shape[data-element-id^="GP_"]')
      .first()
      .click({ force: true });
    await shot(page, '2-org-chart-editor', locale);
    await open('DMN-001');
    await expect(page.locator('.tjs-container')).toBeVisible();
    await page.getByRole('tab').first().click();
    await page.locator('[data-input-id="Input_Amount"]').fill('50000');
    await page.locator('[data-input-id="Input_Category"]').fill('IT');
    await page.getByTestId('dmn-test').getByRole('button').click();
    await shot(page, '3-dmn-editor', locale);
    await open('EPC-001');
    await page.getByRole('tab').nth(1).click();
    await shot(page, '4-epc-editor', locale);
    await open('SIPOC-001');
    await shot(page, '5-sipoc-editor', locale);
    await page.goto('/processes');
    await shot(page, '6-repository-tree', locale);
    if (locale === 'ar') await login(page, DEMO.modeler, 'en');
  });

  test(`portal screenshots (${locale})`, async ({ page }) => {
    await login(page, DEMO.viewer, locale);
    await page.goto('/portal');
    await expect(page.getByTestId('portal-start-value-chain')).toBeVisible();
    await shot(page, '7-portal-start-value-chain', locale);
    for (const [code, name] of [
      ['VC-001', '8-portal-value-chain'],
      ['ORG-001', '9-portal-org-chart'],
      ['DMN-001', '10-portal-dmn'],
      ['EPC-001', '11-portal-epc'],
      ['SIPOC-001', '12-portal-sipoc'],
    ] as const) {
      await page.goto(`/portal/diagrams/${diagrams[code].id}`);
      await shot(page, name, locale);
    }
    await page.goto('/portal/diagrams');
    await shot(page, '13-portal-diagrams', locale);
    if (locale === 'ar') await login(page, DEMO.viewer, 'en');
  });
}
