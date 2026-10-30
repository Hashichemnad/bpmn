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

/** Picks a user in a UserSelect (searchable directory). */
async function pickUser(
  page: Page,
  scope: ReturnType<Page['getByTestId']>,
  field: string,
  email: string,
) {
  await scope.locator(`#${field}`).click({ force: true });
  await page.keyboard.type(email);
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option', {
      hasText: email,
    })
    .first()
    .click();
}

test('an issue with an action plan is worked by its owner and verified by the raiser', async ({
  page,
}) => {
  await login(page, DEMO.risk);
  await page.goto('/grc/issues');
  await page.getByRole('button', { name: 'Raise issue' }).click();
  const form = page.getByTestId('issue-form');
  await form.locator('#titleEn').fill(`Supplier onboarding gaps ${stamp}`);
  await form.locator('#titleAr').fill(`ثغرات تسجيل الموردين ${stamp}`);
  await pickUser(page, form, 'ownerId', DEMO.owner);
  await page.locator('.ant-modal').getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/grc\/issues\/[0-9a-f-]+$/);
  const issueUrl = page.url();

  await page.getByTestId('add-action').click();
  const actionForm = page.getByTestId('action-form');
  await actionForm.locator('#titleEn').fill('Update the onboarding checklist');
  await pickUser(page, actionForm, 'ownerId', DEMO.owner);
  await page.locator('.ant-modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('issue-actions')).toContainText('Update the onboarding checklist');

  // The owner completes the action and reports the issue as fixed.
  await login(page, DEMO.owner);
  await page.goto('/tasks?tab=issueActions');
  await page
    .getByTestId('tasks-actions')
    .getByRole('link', { name: 'Update the onboarding checklist' })
    .first()
    .click();
  await expect(page).toHaveURL(issueUrl);
  const handle = page.getByTestId('issue-actions').locator('.ant-slider-handle').first();
  await handle.focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('issue-READY')).toBeVisible();
  await page.getByTestId('issue-READY').click();
  await expect(page.locator('body')).toContainText('Ready for verification');

  // The raiser verifies and closes it.
  await login(page, DEMO.risk);
  await page.goto('/tasks?tab=issuesToVerify');
  await page
    .getByTestId('tasks-verify')
    .getByRole('link', { name: new RegExp(`Supplier onboarding gaps ${stamp}`) })
    .click();
  await page.getByTestId('issue-VERIFY').click();
  await expect(page.locator('.ant-page-header, body')).toContainText('Closed');
});

test('an audit engagement records a finding, management agrees and the report downloads', async ({
  page,
}) => {
  await login(page, DEMO.audit);
  await page.goto('/grc/audits');
  await page.getByRole('button', { name: 'New engagement' }).click();
  const form = page.getByTestId('engagement-form');
  await form.locator('#titleEn').fill(`Procurement audit ${stamp}`);
  await form.locator('#titleAr').fill(`تدقيق المشتريات ${stamp}`);
  await page.locator('.ant-modal').getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/grc\/audits\/[0-9a-f-]+$/);
  const engagementUrl = page.url();

  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.getByTestId('add-finding').click();
  const finding = page.getByTestId('finding-form');
  await finding.locator('#titleEn').fill(`Approvals after delivery ${stamp}`);
  await finding
    .locator('#conditionEn')
    .fill('Purchase orders were approved after the goods arrived.');
  await finding
    .locator('#recommendationEn')
    .fill('Block goods receipts without an approved order.');
  await pickUser(page, finding, 'responseOwnerId', DEMO.owner);
  await page.locator('.ant-modal').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('finding-F-01')).toContainText(`Approvals after delivery ${stamp}`);
  await page.getByTestId('engagement-next').click(); // fieldwork
  await expect(page.getByTestId('engagement-next')).toContainText('Reporting');
  await page.getByTestId('engagement-next').click(); // reporting
  await expect(page.getByTestId('engagement-next')).toContainText('Follow-up');

  // Management (the process owner) agrees from My tasks; an issue is created.
  await login(page, DEMO.owner);
  await page.goto('/tasks?tab=findingsToAnswer');
  await page
    .getByTestId('tasks-findings')
    .getByRole('link', { name: new RegExp(`Approvals after delivery ${stamp}`) })
    .click();
  await page.getByTestId('respond-F-01').click();
  const response = page.getByTestId('response-form');
  await response.locator('#agreedActionEn').fill('Add a system block on goods receipts');
  await response.locator('#target').click();
  await page.keyboard.type('2027-03-31');
  await page.keyboard.press('Enter');
  await page.locator('.ant-modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('finding-F-01')).toContainText('Agreed');
  await expect(page.getByTestId('finding-F-01')).toContainText(/ISS-\d{4}/);

  // The report downloads as Word.
  await login(page, DEMO.audit);
  await page.goto(engagementUrl);
  await page.getByTestId('audit-report').hover();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'English' }).click();
  expect((await download).suggestedFilename()).toMatch(/AUD-\d{4}-\d{2}.*\.docx$/);
});

test('a questionnaire is built, sent to a Viewer, answered in the portal and the results show', async ({
  page,
}) => {
  await login(page, DEMO.risk);
  await page.goto('/grc/surveys');
  await page.getByTestId('new-questionnaire').click();
  await page.getByTestId('q-title-en').fill(`Policy awareness ${stamp}`);
  await page.getByTestId('q-title-ar').fill(`الوعي بالسياسات ${stamp}`);
  await page.getByTestId('add-question-0').click();
  await page.locator('.ant-collapse-header').last().click();
  const editor = page.locator('[data-testid^="editor-"]').last();
  await editor.locator('[data-testid^="text-en-"]').fill('Do you know the purchasing policy?');
  await editor.locator('[data-testid^="type-"]').click();
  await page
    .locator(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Yes / No / N/A"]',
    )
    .click();
  await page.getByTestId('questionnaire-save').click();
  await expect(page).toHaveURL(/\/grc\/surveys\/questionnaires\/[0-9a-f-]+$/);
  const questionnaireId = page.url().split('/').pop()!;

  const viewer = (
    await apiCall<{ id: string; email: string }[]>(page, 'GET', `/users/directory?q=${DEMO.viewer}`)
  ).data.find((u) => u.email === DEMO.viewer)!;
  const campaign = await apiCall<{ id: string }>(page, 'POST', '/surveys/campaigns', {
    questionnaireId,
    audience: { userIds: [viewer.id] },
    endAt: '2027-12-31',
  });
  expect(campaign.status).toBe(201);
  await page.goto(`/grc/surveys/campaigns/${campaign.data.id}`);
  await page.getByTestId('campaign-launch').click();
  await expect(page.locator('body')).toContainText('Open');

  // The Viewer answers in the portal.
  await login(page, DEMO.viewer);
  await page.goto('/portal/tasks');
  await page
    .getByTestId('tasks-surveys')
    .getByRole('link', { name: `Policy awareness ${stamp}` })
    .click();
  await expect(page).toHaveURL(/\/portal\/surveys\//);
  await page.getByTestId('survey-form').getByText('Yes', { exact: true }).click();
  await page.getByTestId('survey-submit').click();
  await expect(page.locator('body')).toContainText('Thank you');

  await login(page, DEMO.risk);
  await page.goto(`/grc/surveys/campaigns/${campaign.data.id}`);
  await expect(page.getByTestId('survey-results')).toContainText(
    'Do you know the purchasing policy?',
  );
  await expect(page.locator('.ant-statistic').first()).toContainText('100');
});
