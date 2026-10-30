import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Assurance (Phase 4.2): approval of changes to active risks and controls, control testing,
 * issues and actions, audit engagements, questionnaires and the assurance dashboard.
 */
const stamp = Date.now().toString(36).toUpperCase();
test.setTimeout(120_000);

/** Opens an Ant Design select by test id and picks the option with this exact title. */
async function choose(page: Page, testId: string, title: string) {
  await page.getByTestId(testId).click();
  const option = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
    .locator(`.ant-select-item-option[title="${title}"]`);
  await option.click();
  await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toHaveCount(
    0,
  );
}

/** Turns the approval of risk / control changes on (with the "any one reviewer" workflow) or off. */
async function changeApproval(page: Page, enabled: boolean) {
  const settings = (await apiCall<Record<string, unknown>>(page, 'GET', '/grc/settings')).data;
  const workflows = (await apiCall<{ id: string; nameEn: string }[]>(page, 'GET', '/workflows'))
    .data;
  const workflowId = workflows.find((w) => w.nameEn.startsWith('Policy review'))?.id ?? null;
  const res = await apiCall(page, 'PUT', '/grc/settings', {
    ...settings,
    changeApproval: { enabled, types: ['RISK', 'CONTROL'], workflowId },
  });
  expect(res.status).toBe(200);
}

test('a change of an active risk waits for approval and applies when a reviewer approves', async ({
  page,
}) => {
  await login(page, DEMO.risk);
  const created = await apiCall<{ item: { id: string } }>(page, 'POST', '/grc/risks', {
    code: `E2E-CH${stamp}`,
    nameEn: `Change approval ${stamp}`,
    nameAr: `اعتماد التعديل ${stamp}`,
    category: 'OPERATIONAL',
    inherentLikelihood: 3,
    inherentImpact: 3,
    status: 'ACTIVE',
  });
  expect(created.status).toBe(201);
  const id = created.data.item.id;
  await changeApproval(page, true);
  try {
    await page.goto(`/grc/risks/${id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    const form = page.getByTestId('grc-form');
    await form.locator('#nameEn').fill(`Change approval ${stamp} (renamed)`);
    await page.getByRole('button', { name: 'Save' }).click();
    const card = page.getByTestId('grc-change');
    await expect(card).toContainText('Proposed change waiting for approval');
    await expect(page.getByTestId('change-fields')).toContainText(
      `Change approval ${stamp} (renamed)`,
    );
    // The current values stay in force.
    await expect(page.locator('h1, h2, h3, h4').first()).not.toContainText('(renamed)');

    await login(page, DEMO.reviewer);
    await page.goto('/tasks?tab=grcChanges');
    await page.getByRole('link', { name: `Change approval ${stamp}` }).click();
    await page.getByTestId('change-approve').click();
    await expect(page.getByTestId('grc-change')).toHaveCount(0);
    await expect(page.locator('body')).toContainText(`Change approval ${stamp} (renamed)`);
  } finally {
    await login(page, DEMO.risk);
    await changeApproval(page, false);
  }
});

test('a control test is planned, performed with evidence, signed off and updates the control', async ({
  page,
}) => {
  await login(page, DEMO.risk);
  const control = await apiCall<{ item: { id: string } }>(page, 'POST', '/grc/controls', {
    code: `E2E-CT${stamp}`,
    nameEn: `Tested control ${stamp}`,
    nameAr: `ضابط مختبر ${stamp}`,
    status: 'ACTIVE',
    frequency: 'MONTHLY',
  });
  expect(control.status).toBe(201);
  const controlId = control.data.item.id;
  const owner = (
    await apiCall<{ id: string; email: string }[]>(page, 'GET', `/users/directory?q=${DEMO.owner}`)
  ).data.find((u) => u.email === DEMO.owner)!;
  const plan = await apiCall(page, 'POST', '/control-tests/plans', {
    controlId,
    testType: 'OPERATING',
    procedure: [
      { en: 'Check the approval signature', ar: 'تحقق من توقيع الاعتماد' },
      { en: 'Check the amount against the limit', ar: 'تحقق من المبلغ مقابل الحد' },
    ],
    sampleSize: 2,
    frequency: 'QUARTERLY',
    testerId: owner.id,
    reviewerRoleKey: 'RISK_OFFICER',
    nextDueAt: '2027-03-31',
  });
  expect(plan.status).toBe(201);

  // "Test now" on the control page creates the test.
  await page.goto(`/grc/controls/${controlId}`);
  const card = page.getByTestId('control-testing');
  await card.getByRole('button', { name: 'Test now' }).click();
  await page.locator('.ant-modal').getByRole('button', { name: 'OK' }).click();
  await expect(page).toHaveURL(/\/grc\/tests\//);
  const testUrl = page.url();

  // The tester performs it from My tasks.
  await login(page, DEMO.owner);
  await page.goto('/tasks?tab=testsToExecute');
  await page
    .getByTestId('tasks-tests-execute')
    .getByRole('link', { name: `E2E-CT${stamp} Tested control ${stamp}` })
    .click();
  await page.getByTestId('test-start').click();
  await choose(page, 'sample-result-0', 'Pass');
  await choose(page, 'sample-result-1', 'Exception');
  await choose(page, 'test-conclusion', 'Effective with exceptions');
  await page
    .getByTestId('evidence')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 sample evidence'),
    });
  await expect(page.getByTestId('evidence')).toContainText('evidence.pdf');
  await page.getByTestId('test-submit').click();
  await expect(page.locator('body')).toContainText('Submitted');

  // The Risk & Compliance officer signs it off (four-eyes: a different person).
  await login(page, DEMO.risk);
  await page.goto(testUrl);
  await page.getByTestId('test-approve').click();
  await page.locator('.ant-modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('body')).toContainText('Reviewed');
  await page.goto(`/grc/controls/${controlId}`);
  await expect(page.getByTestId('control-testing')).toContainText('Partly effective');
});
