import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against a running, freshly seeded ProcessHub
 * (`docker compose up` → http://localhost:8080, or Vite dev on :5173 via E2E_BASE_URL).
 * Re-runnable on the same database: the main flow creates a new process with a unique code each
 * run, and the admin's 2FA secret / recovery codes are kept in `.auth/` (git-ignored). In CI the
 * suite runs against `docker compose up` (.github/workflows/ci.yml, job "e2e").
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    // Optional: a pre-installed Chromium (e.g. a sandbox without `playwright install`).
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
