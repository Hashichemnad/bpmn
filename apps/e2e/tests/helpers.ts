import { expect, type Page } from '@playwright/test';

/** Demo users created by the seed (password: SEED_DEMO_PASSWORD, see .env.example). */
export const DEMO = {
  viewer: 'viewer@processhub.local',
  reviewer: 'reviewer@processhub.local',
  owner: 'owner@processhub.local',
  modeler: 'modeler@processhub.local',
};
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-Password1';

/** Signs in through the login form and makes sure the UI is in the requested language. */
export async function login(page: Page, email: string, locale: 'en' | 'ar' = 'en') {
  await page.goto('/login');
  await page.locator('input[autocomplete=username], input[type=email]').first().fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
  // The demo users may have switched language in an earlier run.
  const status = await page.evaluate(async (loc) => {
    const csrf = document.cookie
      .split('; ')
      .find((c) => c.startsWith('ph_csrf='))
      ?.split('=')[1];
    const res = await fetch('/api/v1/auth/me', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': decodeURIComponent(csrf ?? ''),
      },
      body: JSON.stringify({ locale: loc }),
    });
    return res.status;
  }, locale);
  expect(status).toBe(200);
  await page.reload();
}

/** Calls the API from the signed-in browser and returns the HTTP status. */
export function apiStatus(page: Page, path: string) {
  return page.evaluate(async (p) => (await fetch(`/api/v1${p}`)).status, path);
}
