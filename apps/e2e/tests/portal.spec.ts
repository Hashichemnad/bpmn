import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiStatus, login } from './helpers';

/** Opens a process from the portal's process tree. */
async function openProcess(page: Page, name: string) {
  await page.locator('.ant-tree-node-content-wrapper', { hasText: name }).first().click();
}

test.describe('Knowledge Portal (viewer)', () => {
  test('viewer lands on the portal and browses a published process', async ({ page }) => {
    await login(page, DEMO.viewer);
    await expect(page).toHaveURL(/\/portal/);
    await expect(page.getByText('Knowledge Portal').first()).toBeVisible();

    await page.getByRole('link', { name: 'Processes', exact: true }).first().click();
    await openProcess(page, 'Purchase Requisition');
    await expect(page.getByText('Process diagram')).toBeVisible();
    await expect(page.locator('.djs-container svg').first()).toBeVisible();
    // Official badge with version label from the publication.
    await expect(page.getByText(/v\d+\.\d+/).first()).toBeVisible();
  });

  test('viewer is kept out of the workspace and its API', async ({ page }) => {
    await login(page, DEMO.viewer);
    await page.goto('/processes');
    await expect(page).toHaveURL(/\/portal/);
    for (const path of ['/processes', '/spaces', '/governance/dashboard', '/workflows']) {
      expect(await apiStatus(page, path), path).toBe(403);
    }
    expect(await apiStatus(page, '/portal/home')).toBe(200);
    // My tasks is open to everyone, but a viewer is never assigned workspace reviews.
    const tasks = await page.evaluate(async () => (await fetch('/api/v1/tasks')).json());
    expect(tasks).toMatchObject({ reviews: [], toPublish: [], dueReviews: [] });
  });

  test('search highlights matches', async ({ page }) => {
    await login(page, DEMO.viewer);
    await page.goto('/portal/search?q=requisition');
    await expect(page.locator('mark').first()).toBeVisible();
  });

  test('Arabic portal is right-to-left', async ({ page }) => {
    await login(page, DEMO.viewer, 'ar');
    await page.goto('/portal');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('بوابة المعرفة').first()).toBeVisible();
  });

  test('print view renders the diagram for PDF download', async ({ page }) => {
    await login(page, DEMO.viewer);
    await page.goto('/portal/processes');
    await openProcess(page, 'Purchase Requisition');
    await page.waitForURL(/\/portal\/processes\/[0-9a-f-]+$/);
    const id = page.url().split('/').pop();
    // Opening the print route directly avoids the print dialog in headless runs.
    await page.addInitScript(() => (window.print = () => undefined));
    await page.goto(`/portal/print/processes/${id}`);
    await expect(page.locator('img[src^="blob:"], svg').first()).toBeVisible();
  });
});
