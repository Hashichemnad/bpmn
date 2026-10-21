import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { PublicAuthDto } from '@processhub/shared';
import { AppProviders, createQueryClient } from '@/app/AppProviders';
import i18n from '@/i18n';
import { LoginPage } from './LoginPage';

type Handler = (body: unknown) => { status: number; body?: unknown };

/** Routes fetch calls of the page to small fakes (path → handler). */
function mockApi(routes: Record<string, Handler>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname.replace('/api/v1', '');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const handler = routes[path];
      const res = handler ? handler(body) : { status: 404, body: { code: 'NOT_FOUND' } };
      return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const options =
  (over: Partial<PublicAuthDto> = {}): Handler =>
  () => ({
    status: 200,
    body: {
      ssoEnabled: true,
      ssoButtonLabelEn: 'Contoso account',
      ssoButtonLabelAr: 'حساب كونتوسو',
      localLoginEnabled: true,
      ...over,
    },
  });

const base: Record<string, Handler> = {
  '/auth/me': () => ({ status: 401, body: { code: 'UNAUTHENTICATED' } }),
  '/auth/refresh': () => ({ status: 401, body: { code: 'SESSION_EXPIRED' } }),
  '/auth/csrf': () => ({ status: 200, body: { csrfToken: 'x'.repeat(43) } }),
  '/settings/public': () => ({
    status: 200,
    body: { orgNameEn: 'ACME', orgNameAr: 'أكمي', defaultLocale: 'en', hasLogo: false },
  }),
};

function renderLogin(url = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <div>home page</div> },
    ],
    { initialEntries: [url] },
  );
  render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('LoginPage', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers the SSO button with the configured label and the password form', async () => {
    mockApi({ ...base, '/auth/options': options() });
    renderLogin();
    const sso = await screen.findByRole('link', { name: /Contoso account/ });
    expect(sso.getAttribute('href')).toBe('/api/v1/auth/sso/start?returnTo=%2F');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('hides the password form when password sign-in is off (break-glass link)', async () => {
    mockApi({ ...base, '/auth/options': options({ localLoginEnabled: false }) });
    renderLogin();
    await screen.findByRole('link', { name: /Contoso account/ });
    expect(screen.queryByLabelText('Password')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Administrator sign-in/ }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows the translated SSO error from the callback', async () => {
    mockApi({ ...base, '/auth/options': options() });
    renderLogin('/login?ssoError=SSO_DOMAIN_NOT_ALLOWED');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your e-mail domain is not allowed to sign in to ProcessHub.',
    );
  });

  it('asks for the authenticator code after a correct password, then signs in', async () => {
    const calls = mockApi({
      ...base,
      '/auth/options': options({ ssoEnabled: false }),
      '/auth/login': () => ({ status: 200, body: { mfa: 'VERIFY' } }),
      '/auth/login/mfa': () => ({
        status: 200,
        body: {
          user: {
            id: 'u1',
            email: 'a@acme.com',
            nameEn: 'A',
            nameAr: '',
            locale: 'en',
            roles: ['VIEWER'],
            permissions: [],
            departmentId: null,
            hasPassword: true,
            ssoLinked: false,
            mfaEnabled: true,
          },
        },
      }),
    });
    const router = renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@acme.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret-Password1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Two-step verification')).toBeInTheDocument();
    // Input.OTP: typing into the first box fills the rest.
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]);
    await userEvent.keyboard('123456');
    await userEvent.click(screen.getByRole('button', { name: /Verify/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.find((c) => c.path === '/auth/login/mfa')?.body).toEqual({ code: '123456' });
  }, 30_000);
});
