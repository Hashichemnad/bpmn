import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against a running, freshly seeded ProcessHub
 * (`docker compose up` → http://localhost:8080, or Vite dev on :5173 via E2E_BASE_URL).
 * The tests only read data or add feedback, so they can be re-run on the same database.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    locale: 'en-GB',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
