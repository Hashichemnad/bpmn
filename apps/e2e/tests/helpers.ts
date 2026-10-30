import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

/** Demo users created by the seed (password: SEED_DEMO_PASSWORD, see .env.example). */
export const DEMO = {
  viewer: 'viewer@processhub.local',
  reviewer: 'reviewer@processhub.local',
  owner: 'owner@processhub.local',
  modeler: 'modeler@processhub.local',
  risk: 'risk@processhub.local',
};
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-Password1';

/** Super Admin from the seed (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD). Two-factor is required. */
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@processhub.local',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe-Admin1',
};

/** Where the admin's 2FA secret and unused recovery codes are kept between runs (git-ignored). */
const MFA_FILE = join(__dirname, '..', '.auth', 'admin-mfa.json');
export interface AdminMfa {
  secret: string;
  recoveryCodes: string[];
}
export function readAdminMfa(): AdminMfa | null {
  try {
    return JSON.parse(readFileSync(MFA_FILE, 'utf8')) as AdminMfa;
  } catch {
    return null;
  }
}
export function writeAdminMfa(mfa: AdminMfa) {
  mkdirSync(dirname(MFA_FILE), { recursive: true });
  writeFileSync(MFA_FILE, JSON.stringify(mfa, null, 2));
}

/** Current six-digit code for a base32 TOTP secret (SHA-1, 30 s, like authenticator apps). */
export const totpCode = (secret: string) =>
  new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate();

/** Types a six-digit code into the OTP input (one box per digit). */
export async function typeCode(page: Page, code: string) {
  await page.locator('.ant-otp input').first().click();
  await page.keyboard.type(code);
}

/** Sets the signed-in user's language through the API, then reloads the page. */
export async function setLocale(page: Page, locale: 'en' | 'ar') {
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

/** Signs in through the login form and makes sure the UI is in the requested language. */
export async function login(page: Page, email: string, locale: 'en' | 'ar' = 'en') {
  // Signs out a previous user of the same page.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.locator('input[autocomplete=username], input[type=email]').first().fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
  // The demo users may have switched language in an earlier run.
  await setLocale(page, locale);
}

/** Calls the API from the signed-in browser and returns the HTTP status. */
export function apiStatus(page: Page, path: string) {
  return page.evaluate(async (p) => (await fetch(`/api/v1${p}`)).status, path);
}

/** Calls the API from the signed-in browser (with the CSRF header) and returns status and JSON. */
export function apiCall<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('ph_csrf='))
        ?.split('=')[1];
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': decodeURIComponent(csrf ?? ''),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, data: (text ? JSON.parse(text) : null) as never };
    },
    { method, path, body },
  );
}

/** Absolute path of a file in docs/samples. */
export const sample = (name: string) => join(__dirname, '..', '..', '..', 'docs', 'samples', name);

/** Creates a process owned by `ownerEmail` with the PMS-01 sample as its working model. */
export async function createSampleProcess(
  page: Page,
  code: string,
  names: { nameEn: string; nameAr: string },
  ownerEmail = DEMO.owner,
) {
  const owners = await apiCall<{ id: string; email: string }[]>(
    page,
    'GET',
    `/users/directory?q=${encodeURIComponent(ownerEmail)}`,
  );
  const ownerId = owners.data.find((u) => u.email === ownerEmail)?.id;
  const created = await apiCall<{ id: string }>(page, 'POST', '/processes', {
    code,
    ...names,
    category: 'CORE',
    ownerId,
  });
  expect(created.status).toBe(201);
  const xml = readFileSync(sample('PMS-01-Program-Request-Approval.bpmn'), 'utf8');
  const saved = await apiCall(page, 'PUT', `/processes/${created.data.id}/model`, { bpmnXml: xml });
  expect(saved.status).toBe(200);
  return created.data.id;
}
