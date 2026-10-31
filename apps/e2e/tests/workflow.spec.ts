import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Workflow execution (Phase 5.2): make a process executable and deploy it (step 1) → start a request
 * from the portal's service catalogue (step 3) → task in the inbox → return for correction → resubmit
 * → approve through all steps, with the DMN budget rule adding the budget approval (step 2) → request
 * completed with its generated letter → monitor, dashboard and the live event log (step 4) → Arabic.
 * Re-runnable: each run creates its own executable copy of the seeded PMS-01.
 */
const WF = {
  section: 'section@processhub.local',
  pmo: 'pmo@processhub.local',
  finance: 'finance@processhub.local',
  dgo: 'dgo@processhub.local',
};
const stamp = Date.now().toString(36).toUpperCase().slice(-5);
const code = `WF-${stamp}`;
const prefix = `W${stamp}`.replace(/[^A-Z0-9]/g, 'X');
const name = `Executable program request ${stamp}`;
let processId = '';
let caseNumber = '';

async function publishAs(page: Page, id: string, xml: string) {
  await login(page, DEMO.modeler);
  expect(
    (
      await apiCall(page, 'POST', `/processes/${id}/versions`, {
        bpmnXml: xml,
        changeNote: 'Executable',
      })
    ).status,
  ).toBe(201);
  const submitted = await apiCall(page, 'POST', `/governance/processes/${id}/submit`, {});
  expect(submitted.status, JSON.stringify(submitted.data)).toBe(200);
  for (const who of [DEMO.reviewer, DEMO.owner]) {
    await login(page, who);
    const tasks = await apiCall<{ reviews: { id: string; item: { entityId: string } }[] }>(
      page,
      'GET',
      '/tasks',
    );
    const review = tasks.data.reviews.find((r) => r.item.entityId === id);
    expect(review).toBeTruthy();
    expect(
      (await apiCall(page, 'POST', `/reviews/${review!.id}/decision`, { decision: 'APPROVE' }))
        .status,
    ).toBe(200);
  }
  await login(page, DEMO.modeler);
  expect((await apiCall(page, 'POST', `/governance/processes/${id}/publish`, {})).status).toBe(200);
}

/** Opens the workflow task of this request at a step from "My tasks" and decides. */
async function decide(
  page: Page,
  who: string,
  step: string,
  decision: 'APPROVE' | 'RETURN' | null,
  comment = '',
) {
  await login(page, who);
  await page.goto('/tasks?tab=workflow');
  const row = page
    .getByTestId('wf-tasks')
    .locator('tr', { hasText: caseNumber })
    .filter({ hasText: step });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: step }).click();
  await expect(page.getByRole('heading', { name: step })).toBeVisible();
  if (comment) await page.getByTestId('wf-comment').fill(comment);
  await page.getByTestId(decision ? `wf-decision-${decision}` : 'wf-complete').click();
  await page.waitForURL(/\/tasks\?tab=workflow/);
}

test.describe.serial('workflow execution', () => {
  test.describe.configure({ timeout: 240_000 });
  test('step 1: make a copy of PMS-01 executable, publish it and deploy the published version', async ({
    page,
  }) => {
    await login(page, DEMO.modeler);
    const list = await apiCall<{ items: { id: string; code: string }[] }>(
      page,
      'GET',
      '/processes?q=PMS-01&pageSize=50',
    );
    const pms = list.data.items.find((p) => p.code === 'PMS-01');
    expect(pms).toBeTruthy();
    const model = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${pms!.id}/model`);
    const owners = await apiCall<{ id: string; email: string }[]>(
      page,
      'GET',
      `/users/directory?q=${encodeURIComponent(DEMO.owner)}`,
    );
    const created = await apiCall<{ id: string }>(page, 'POST', '/processes', {
      code,
      nameEn: name,
      nameAr: `طلب برنامج قابل للتنفيذ ${stamp}`,
      category: 'CORE',
      ownerId: owners.data.find((u) => u.email === DEMO.owner)?.id,
    });
    expect(created.status).toBe(201);
    processId = created.data.id;
    expect(
      (await apiCall(page, 'PUT', `/processes/${processId}/model`, { bpmnXml: model.data.bpmnXml }))
        .status,
    ).toBe(200);
    await login(page, DEMO.owner);

    // Execution settings on the process page.
    await page.goto(`/processes/${processId}?tab=execution`);
    await page.getByTestId('wf-enabled').click();
    await page.getByLabel('Case number prefix').fill(prefix);
    await page.getByTestId('wf-config-save').click();
    await expect(page.getByText('Execution settings saved')).toBeVisible();

    // The modeler shows the Execution tab and the executable check.
    await page.goto(`/processes/${processId}/model`);
    await page.locator('.djs-container').first().waitFor();
    const show = page.getByRole('button', { name: 'Show side panel' });
    if (await show.isVisible()) await show.click();
    await expect(page.getByRole('tab', { name: 'Execution' })).toBeVisible();
    await page.getByRole('tab', { name: 'Execution' }).click();
    await expect(page.getByText('Select a step, event, gateway or flow')).toBeVisible();

    await publishAs(page, processId, model.data.bpmnXml);
    await login(page, DEMO.owner);
    await page.goto(`/processes/${processId}?tab=execution`);
    await page.getByTestId('wf-deploy').click();
    await expect(page.getByText('Deployed: new requests use this version')).toBeVisible();
    await expect(page.getByText('active', { exact: true })).toBeVisible();
  });

  test('step 3 + 2: start from the portal, return for correction, resubmit, approve through all steps (DMN budget rule)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await login(page, DEMO.viewer);
    await page.goto('/portal/services');
    await page.getByTestId(`start-${code}`).click();
    await page.getByLabel('Program name').fill(`Citizen app ${stamp}`);
    await page.getByLabel('Digital', { exact: true }).check();
    await page.getByLabel('Estimated budget').fill('150000');
    await page.getByLabel('Requesting department').click();
    await page.keyboard.type('Procurement');
    await page.keyboard.press('Enter');
    await page.getByLabel('Justification').fill('One app for all citizen services.');
    await page.getByTestId('wf-submit-request').click();
    await page.waitForURL(/\/portal\/workflow\/cases\//);
    caseNumber = (await page
      .locator('h1 span[dir=ltr], h2 span[dir=ltr], h3 span[dir=ltr]')
      .first()
      .textContent())!.trim();
    expect(caseNumber).toMatch(new RegExp(`^${prefix}-\\d{4}-\\d{5}$`));
    await expect(page.getByTestId('case-diagram')).toBeVisible();

    // Section manager returns the request for correction (comment required).
    await decide(
      page,
      WF.section,
      'Section manager review',
      'RETURN',
      'Please add the target users.',
    );

    // The requester corrects it in the portal and resubmits.
    await login(page, DEMO.viewer);
    await page.goto('/portal/tasks?tab=workflow');
    await page
      .getByTestId('wf-tasks')
      .locator('tr', { hasText: caseNumber })
      .getByRole('link', { name: 'Correct the request' })
      .click();
    await page
      .getByLabel('Justification')
      .fill('One app for all citizen services; 200,000 target users.');
    await page.getByTestId('wf-complete').click();
    await page.waitForURL(/\/portal\/tasks/);

    await decide(page, WF.section, 'Section manager review', 'APPROVE');
    await decide(page, DEMO.owner, 'Department manager approval', 'APPROVE');
    // AED 150,000 ≥ 100,000: the DMN decision adds the budget approval.
    await decide(page, WF.finance, 'Budget approval', 'APPROVE');

    // PMO: a group task — claim it first.
    await login(page, WF.pmo);
    await page.goto('/tasks?tab=workflow');
    await page.getByTestId('wf-scope').getByText('My groups (to claim)').click();
    const groupRow = page.getByTestId('wf-tasks').locator('tr', { hasText: caseNumber });
    await groupRow.getByRole('button', { name: 'Claim' }).click();
    await page.getByTestId('wf-scope').getByText('Assigned to me').click();
    await expect(page.getByTestId('wf-tasks').locator('tr', { hasText: caseNumber })).toBeVisible();
    await decide(page, WF.pmo, 'PMO review', 'APPROVE');
    await decide(page, WF.dgo, 'DGO approval', 'APPROVE');

    // Completed (the approval letter is generated by the job runner).
    await login(page, DEMO.viewer);
    await page.goto('/portal/requests');
    await page.getByRole('link', { name: caseNumber }).click();
    await expect(async () => {
      await page.reload();
      await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 90_000 });
    await expect(page.getByTestId('case-files').getByText(/Program approval letter/)).toBeVisible();
    await expect(page.getByTestId('event-COMPLETED')).toBeVisible();
  });

  test('step 4: monitor, dashboard and the live event log in process mining', async ({ page }) => {
    await login(page, DEMO.owner);
    await page.goto('/workflow/monitor');
    await expect(page.getByTestId('wf-monitor-processes').getByText(code)).toBeVisible();
    await page.goto('/workflow/dashboard');
    await expect(page.getByTestId('wf-dashboard-tiles')).toBeVisible();
    await expect(
      page.getByTestId('wf-dashboard-steps').getByText('Section manager review').first(),
    ).toBeVisible();
    await page.goto(`/processes/${processId}?tab=execution`);
    await page.getByRole('link', { name: 'Live event log' }).click();
    await page.waitForURL(/\/mining\/logs\//);
    await expect(page.getByText(/live cases/).first()).toBeVisible();
    const logId = page.url().split('/mining/logs/')[1].split(/[/?]/)[0];
    const log = await apiCall<{ caseCount: number; eventCount: number }>(
      page,
      'GET',
      `/mining/logs/${logId}`,
    );
    expect(log.data.caseCount).toBeGreaterThanOrEqual(1);
    expect(log.data.eventCount).toBeGreaterThanOrEqual(7);
  });

  test('Arabic: the request page is right-to-left', async ({ page }) => {
    await login(page, DEMO.viewer, 'ar');
    await page.goto('/portal/requests');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('link', { name: caseNumber }).click();
    await expect(page.getByText('مكتمل', { exact: true }).first()).toBeVisible();
    await login(page, DEMO.viewer, 'en');
  });
});
