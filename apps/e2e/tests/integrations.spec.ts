import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, createSampleProcess, login, loginAdmin, sample } from './helpers';

/** Test receiver (docker-compose.yml service webhook-receiver): read here, called by the API there. */
const RECEIVER = process.env.E2E_RECEIVER_URL ?? 'http://localhost:8090';
const RECEIVER_TARGET = process.env.E2E_RECEIVER_TARGET ?? 'http://webhook-receiver:8090/hook';

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

interface Received {
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** Approves the open review of an item as the signed-in user (API). */
async function approve(page: Page, entityId: string) {
  const tasks = await apiCall<{ reviews: { id: string; item: { entityId: string } }[] }>(
    page,
    'GET',
    '/tasks',
  );
  const review = tasks.data.reviews.find((r) => r.item.entityId === entityId);
  expect(review).toBeTruthy();
  const res = await apiCall(page, 'POST', `/reviews/${review!.id}/decision`, {
    decision: 'APPROVE',
  });
  expect(res.status).toBe(200);
}

test('publishing a process delivers a signed webhook, shown in the delivery log', async ({
  page,
  request,
}) => {
  await request.delete(`${RECEIVER}/received`);
  await loginAdmin(page);
  await page.goto('/settings/integrations?tab=webhooks');
  await page.getByRole('button', { name: 'Add webhook' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(`E2E receiver ${stamp}`);
  await dialog.getByLabel('Target URL (HTTPS)').fill(RECEIVER_TARGET);
  await dialog.getByRole('button', { name: 'Save' }).click();
  const secret = (await page.getByTestId('webhook-secret').innerText()).trim();
  expect(secret).toMatch(/^whsec_/);
  await page.getByRole('button', { name: 'I have copied the key' }).click();

  // A process goes through review and is published (API calls as the demo users).
  await login(page, DEMO.modeler);
  const id = await createSampleProcess(page, `WH.${stamp}`, {
    nameEn: `Webhook process ${stamp}`,
    nameAr: `عملية خطاف ${stamp}`,
  });
  const xml = readFileSync(sample('PMS-01-Program-Request-Approval.bpmn'), 'utf8');
  expect(
    (await apiCall(page, 'POST', `/processes/${id}/versions`, { bpmnXml: xml, changeNote: 'v1' }))
      .status,
  ).toBe(201);
  expect((await apiCall(page, 'POST', `/governance/processes/${id}/submit`, {})).status).toBe(200);
  await login(page, DEMO.reviewer);
  await approve(page, id);
  await login(page, DEMO.owner);
  await approve(page, id);
  expect((await apiCall(page, 'POST', `/governance/processes/${id}/publish`, {})).status).toBe(200);

  // The receiver got the event, signed with the secret.
  let delivery: Received | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get(`${RECEIVER}/received`)).json()) as Received[];
        delivery = list.find(
          (r) => r.headers['x-processhub-event'] === 'process.published' && r.body.includes(id),
        );
        return !!delivery;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const ts = delivery!.headers['x-processhub-timestamp'];
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${delivery!.body}`).digest('hex')}`;
  expect(delivery!.headers['x-processhub-signature']).toBe(expected);
  const payload = JSON.parse(delivery!.body);
  expect(payload).toMatchObject({ type: 'process.published', entity: { id, code: `WH.${stamp}` } });

  // Delivery log in the UI.
  await loginAdmin(page);
  await page.goto('/settings/integrations?tab=webhooks');
  const row = page.getByRole('row', { name: new RegExp(`E2E receiver ${stamp}`) });
  await row.getByRole('button', { name: 'Delivery log' }).click();
  const drawer = page.locator('.ant-drawer');
  await expect(drawer.getByText('Process published').first()).toBeVisible();
  await expect(drawer.getByText('Delivered').first()).toBeVisible();
  // Send a test event from the list.
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'Send test event' }).click();
  await expect(page.getByText(/Test event delivered/)).toBeVisible();
  // Leave the destination switched off for later runs.
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByRole('switch').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row.getByText('Inactive')).toBeVisible();
});
