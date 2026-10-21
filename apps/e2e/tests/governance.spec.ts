import { expect, test } from '@playwright/test';
import { DEMO, login } from './helpers';

test.describe('Governance (workspace)', () => {
  test('reviewer sees assigned reviews in My tasks and opens the review page', async ({ page }) => {
    await login(page, DEMO.reviewer);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
    const open = page.getByRole('button', { name: 'Review', exact: true }).first();
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(/\/reviews\/[0-9a-f-]+/);
    await expect(page.getByRole('button', { name: /Approve/ }).first()).toBeVisible();
  });

  test('owner sees the governance dashboard with an overdue review', async ({ page }) => {
    await login(page, DEMO.owner);
    await page.goto('/governance');
    await expect(page.getByText(/overdue/i).first()).toBeVisible();
  });

  test('notification centre lists the seeded notifications', async ({ page }) => {
    await login(page, DEMO.owner);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.locator('.ph-notification').first()).toBeVisible();
  });
});
