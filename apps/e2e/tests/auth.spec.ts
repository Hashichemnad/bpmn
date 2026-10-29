import { expect, test } from '@playwright/test';
import { ADMIN, readAdminMfa, totpCode, typeCode, writeAdminMfa } from './helpers';

test.describe('Sign-in', () => {
  test('wrong password is refused with a message', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[autocomplete=username]').fill('modeler@processhub.local');
    await page.locator('input[type=password]').fill('Not-The-Password1');
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.ant-alert-error, .ant-message-error').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('Super Admin enrols in two-factor authentication on first sign-in', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[autocomplete=username]').fill(ADMIN.email);
    await page.locator('input[type=password]').fill(ADMIN.password);
    await page.locator('button[type=submit]').click();

    const stored = readAdminMfa();
    const setup = page.getByText('Your role requires two-step verification');
    const verify = page.getByRole('button', { name: 'Use a recovery code instead' });
    await expect(setup.or(verify)).toBeVisible();

    if (await verify.isVisible()) {
      // Already enrolled in an earlier run against the same database: sign in with a recovery
      // code (single use, so no wait for the next 30-second TOTP window).
      test.skip(!stored?.recoveryCodes.length, 'Admin enrolled outside this suite');
      const code = stored!.recoveryCodes.shift()!;
      writeAdminMfa(stored!);
      await verify.click();
      await page.getByLabel('Recovery code').fill(code);
      await page.getByRole('button', { name: 'Verify' }).click();
    } else {
      // The manual key is shown grouped in fours next to the QR code.
      const key = page.locator('.ant-typography code').first();
      await expect(key).toBeVisible();
      const secret = (await key.innerText()).replace(/\s+/g, '');
      expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
      await typeCode(page, totpCode(secret));
      await page.getByRole('button', { name: 'Confirm and turn on' }).click();
      // Recovery codes are shown once.
      const codes = page.getByTestId('recovery-codes').locator('code');
      await expect(codes.first()).toBeVisible();
      writeAdminMfa({ secret, recoveryCodes: await codes.allInnerTexts() });
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    const me = await page.evaluate(async () => (await fetch('/api/v1/auth/me')).json());
    expect(me).toMatchObject({ email: ADMIN.email, mfaEnabled: true });

    // Administration → Modeling conventions (viewed only: the rules are global, other specs run
    // with the defaults).
    await page.getByRole('link', { name: 'Modeling conventions' }).click();
    await expect(page.getByRole('heading', { name: 'Modeling conventions' })).toBeVisible();
    await expect(
      page.getByRole('switch', { name: 'Steps in a lane linked to a role — Check' }),
    ).toBeChecked();
    await expect(
      page.getByRole('switch', {
        name: 'Steps in a lane linked to a role — Required before review',
      }),
    ).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Maximum elements' })).toHaveValue('50');
  });
});
