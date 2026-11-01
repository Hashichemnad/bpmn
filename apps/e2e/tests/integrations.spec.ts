import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
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

test('a Teams channel gets an Adaptive Card in Arabic (right to left)', async ({
  page,
  request,
}) => {
  await request.delete(`${RECEIVER}/received`);
  await loginAdmin(page);
  await page.goto('/settings/integrations?tab=teams');
  await page.getByRole('button', { name: 'Add Teams channel' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(`E2E Teams ${stamp}`);
  // Only Power Automate hosts are accepted for Teams …
  await dialog.getByLabel('Teams Workflows webhook URL').fill('https://example.com/hook');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This host is not on the allow-list')).toBeVisible();
  // … except internal test receivers listed in OUTBOUND_ALLOWED_HOSTS.
  await dialog.getByLabel('Teams Workflows webhook URL').fill(`${RECEIVER_TARGET}?sig=teams`);
  await dialog.getByText('العربية').click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row', { name: new RegExp(`E2E Teams ${stamp}`) });
  // The signature part of the URL is never shown again.
  await expect(row).not.toContainText('sig=teams');
  await row.getByRole('button', { name: 'Send test event' }).click();
  await expect(page.getByText(/Test event delivered/)).toBeVisible();

  const list = (await (await request.get(`${RECEIVER}/received`)).json()) as Received[];
  const card = JSON.parse(list.at(-1)!.body);
  expect(card.type).toBe('message');
  const content = card.attachments[0].content;
  expect(content).toMatchObject({ type: 'AdaptiveCard', version: '1.5', rtl: true });
  expect(JSON.stringify(content)).toContain('رسالة تجريبية من ProcessHub');
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('tooltip').getByRole('button', { name: 'OK' }).click();
  await expect(row).toBeHidden();
});

test('a process exports as an offline website that opens without network, and as PowerPoint', async ({
  page,
  browser,
}, testInfo) => {
  await login(page, DEMO.viewer);
  await page.goto('/portal/processes');
  await page.locator('a[href^="/portal/processes/"]').first().click();
  await expect(page).toHaveURL(/\/portal\/processes\/[0-9a-f-]{36}/);
  await page.getByRole('button', { name: /Reports/ }).click();
  await page.getByRole('menuitem', { name: 'Offline website (HTML)' }).click();
  const [zipDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('dialog').getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
  const zip = await JSZip.loadAsync(readFileSync((await zipDownload.path())!));
  const dir = testInfo.outputPath('site');
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const target = join(dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await entry.async('nodebuffer'));
  }
  const index = Object.keys(zip.files).find((n) => n.endsWith('/index.html'))!;
  // Open the copy from disk with every network request counted.
  const offline = await browser.newContext();
  const requests: string[] = [];
  offline.on('request', (r) => {
    if (!/^(file|data):/.test(r.url())) requests.push(r.url());
  });
  const site = await offline.newPage();
  await site.goto(`file://${join(dir, index)}`);
  await site.locator('ul.tree a').first().click();
  await expect(site.locator('.diagram img').first()).toBeVisible();
  await site.getByRole('button', { name: 'العربية' }).click();
  await expect(site.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(requests).toEqual([]);
  await offline.close();

  await page.getByRole('button', { name: /Reports/ }).click();
  await page.getByRole('menuitem', { name: 'PowerPoint' }).click();
  await page.getByRole('dialog').getByText('العربية').click();
  const [deck] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('dialog').getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(deck.suggestedFilename()).toMatch(/_ar\.pptx$/);
  const pptx = await JSZip.loadAsync(readFileSync((await deck.path())!));
  const slide = await pptx.file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).toContain('rtl="1"');
});

/** Mailpit of the Compose stack (every e-mail ProcessHub sends); optional when running elsewhere. */
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

test('a scheduled KPI report is set up, sent and logged', async ({ page, request }) => {
  await login(page, DEMO.performance);
  await page.goto('/reports/subscriptions');
  await page.getByRole('button', { name: 'New subscription' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(`E2E KPIs ${stamp}`);
  await dialog.getByText('PDF', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row', { name: new RegExp(`E2E KPIs ${stamp}`) });
  await expect(row).toContainText('Every Sunday at 07:00');
  await row.getByRole('button', { name: 'Send to me now' }).click();
  await expect(page.getByText('Report sent to your e-mail')).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Delivery log' }).click();
  await expect(page.locator('.ant-drawer').getByText('Sent').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // The e-mail (Mailpit in the Compose stack): summary and a secure link, no attachment by default.
  const mailpit = await request
    .get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${DEMO.performance}`)}`)
    .catch(() => null);
  if (mailpit?.ok()) {
    const found = (await mailpit.json()) as {
      messages: { ID: string; Subject: string; Attachments: number }[];
    };
    const msg = found.messages.find((m) => m.Subject.includes(`E2E KPIs ${stamp}`));
    expect(msg).toBeTruthy();
    expect(msg!.Attachments).toBe(0);
    const body = (await (await request.get(`${MAILPIT}/api/v1/message/${msg!.ID}`)).json()) as {
      Text: string;
    };
    const link = /\/reports\/deliveries\/[0-9a-f-]{36}/.exec(body.Text)![0];
    const [download] = await Promise.all([page.waitForEvent('download'), page.goto(link)]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  }
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('tooltip').getByRole('button', { name: 'OK' }).click();
  await expect(row).toBeHidden();
});
