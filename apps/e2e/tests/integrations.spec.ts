import { expect, test, type Page } from '@playwright/test';
import { DEMO, loginAdmin } from './helpers';

/**
 * Phase 4.4 — integrations: API keys (create → public API → revoke → 401), webhooks (publish →
 * signed delivery at the test receiver → delivery log), exports and scheduled reports.
 */
test.setTimeout(120_000);

const stamp = Date.now().toString(36).toUpperCase();

/** Picks a user in a UserSelect (searchable directory). */
async function pickUser(page: Page, field: string, email: string) {
  await page.locator(`#${field}`).click({ force: true });
  await page.keyboard.type(email);
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option', {
      hasText: email,
    })
    .first()
    .click();
}

test('an API key reads the public API until it is revoked', async ({ page, request }) => {
  await loginAdmin(page);
  await page.goto('/settings/integrations');
  await page.getByRole('button', { name: 'Create API key' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(`E2E key ${stamp}`);
  await pickUser(page, 'ownerId', DEMO.owner);
  await dialog.getByRole('button', { name: 'Create key' }).click();

  const secret = (await page.getByTestId('api-key-secret').innerText()).trim();
  expect(secret).toMatch(/^phk_/);
  await page.getByRole('button', { name: 'I have copied the key' }).click();

  const me = await request.get('/api/public/v1/me', { headers: { 'X-API-Key': secret } });
  expect(me.status()).toBe(200);
  expect((await me.json()).scopes).toContain('processes:read');
  const processes = await request.get('/api/public/v1/processes?pageSize=5', {
    headers: { 'X-API-Key': secret },
  });
  expect(processes.status()).toBe(200);
  expect((await processes.json()).total).toBeGreaterThan(0);
  // Not granted by default.
  const risks = await request.get('/api/public/v1/risks', { headers: { 'X-API-Key': secret } });
  expect(risks.status()).toBe(403);

  // The call log shows the calls.
  const row = page.getByRole('row', { name: new RegExp(`E2E key ${stamp}`) });
  await row.getByRole('button', { name: 'Call log' }).click();
  await expect(page.getByRole('dialog').getByText('GET /processes').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await row.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('tooltip').getByRole('button', { name: 'OK' }).click();
  await expect(row.getByText('Revoked')).toBeVisible();
  const after = await request.get('/api/public/v1/me', { headers: { 'X-API-Key': secret } });
  expect(after.status()).toBe(401);
  expect((await after.json()).code).toBe('API_KEY_REVOKED');
});
