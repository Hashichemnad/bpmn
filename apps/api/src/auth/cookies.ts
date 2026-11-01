import type { CookieOptions, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '@processhub/shared';
import type { AppConfig } from '../config/config';
import { MFA_CHALLENGE_TTL_SECONDS, type IssuedTokens } from './auth.service';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';
/** "Password correct, second factor pending" (see AuthService.challenge). */
export const MFA_COOKIE = 'ph_mfa';
const MFA_COOKIE_PATH = '/api/v1/auth/login';

function base(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict' };
}

export function setAuthCookies(res: Response, tokens: IssuedTokens, config: AppConfig): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(config),
    path: '/api',
    maxAge: tokens.accessTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(config),
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...base(config), path: REFRESH_COOKIE_PATH });
}

/** CSRF token cookie: readable by JS (double-submit pattern), strict same-site. */
export function setCsrfCookie(res: Response, config: AppConfig): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
  });
  return token;
}

export function setMfaCookie(res: Response, challenge: string, config: AppConfig): void {
  res.cookie(MFA_COOKIE, challenge, {
    ...base(config),
    path: MFA_COOKIE_PATH,
    maxAge: MFA_CHALLENGE_TTL_SECONDS * 1000,
  });
}

export function clearMfaCookie(res: Response, config: AppConfig): void {
  res.clearCookie(MFA_COOKIE, { ...base(config), path: MFA_COOKIE_PATH });
}
