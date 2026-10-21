import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { GitError } from './types';

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface HttpRequest {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * The only place that talks to GitHub / GitLab over the network. Tests replace it,
 * so the test suite never calls real services.
 */
@Injectable()
export class GitHttp {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async request(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ProcessHub',
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.GIT_HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GitError(
        'GIT_NETWORK',
        `Cannot reach ${new URL(url).host}: ${(err as Error).message}`,
      );
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, body };
  }
}

/** Short message from a provider error body. */
export function providerMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    const m = b.message ?? b.error;
    if (typeof m === 'string') return m.slice(0, 300);
    if (m) return JSON.stringify(m).slice(0, 300);
  }
  return typeof body === 'string' ? body.slice(0, 300) : '';
}

/** Maps common HTTP failures to error codes. `notFound` decides what a 404 means in context. */
export function httpError(
  res: HttpResponse,
  notFound: 'GIT_REPO_NOT_FOUND' | 'GIT_BRANCH_NOT_FOUND',
): GitError {
  const msg = `HTTP ${res.status}${providerMessage(res.body) ? `: ${providerMessage(res.body)}` : ''}`;
  if (res.status === 401) return new GitError('GIT_AUTH_FAILED', msg);
  if (
    res.status === 429 ||
    (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
  ) {
    return new GitError('GIT_RATE_LIMITED', msg);
  }
  if (res.status === 403) return new GitError('GIT_NO_PUSH_ACCESS', msg);
  if (res.status === 404) return new GitError(notFound, msg);
  if (res.status === 409 || res.status === 422) return new GitError('GIT_CONFLICT', msg);
  if (res.status >= 500) return new GitError('GIT_NETWORK', msg);
  return new GitError('GIT_UNKNOWN', msg);
}
