import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Assurance (Phase 4.2): approval of changes to active risks and controls, control testing,
 * issues and actions, audit engagements, questionnaires and the assurance dashboard.
 */
const stamp = Date.now().toString(36).toUpperCase();

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
