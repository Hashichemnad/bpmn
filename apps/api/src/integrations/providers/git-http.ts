import { withDeadline } from '../../common/deadline';
import { Inject, Injectable } from '@nestjs/common';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { OutboundBlockedError, OutboundPolicy } from '../../common/outbound';
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

/** Largest response body read from a Git provider (tree listings of big repositories). */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/**
 * The only place that talks to GitHub / GitLab over the network. Tests replace it,
 * so the test suite never calls real services. Internal addresses are refused unless allowed
 * (OUTBOUND_ALLOWED_HOSTS); redirects are never followed; plain http only for allowed hosts.
 */
@Injectable()
export class GitHttp {
  private readonly policy: OutboundPolicy;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.policy = new OutboundPolicy(config.outboundAllowedHosts);
  }

  async request(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
    const target = new URL(url);
    if (target.protocol !== 'https:' && !this.policy.allowsHost(target.hostname)) {
      throw new GitError(
        'GIT_HOST_BLOCKED',
        `Plain HTTP is only allowed for OUTBOUND_ALLOWED_HOSTS (${target.host})`,
      );
    }
    const payload = req.body !== undefined ? JSON.stringify(req.body) : undefined;
    let res: { status: number; headers: Headers; text: string };
    try {
      // Checked before connecting (an IP literal skips `lookup`); `lookup` pins host names.
      await this.policy.resolve(target.hostname);
      res = await this.send(target, req, payload);
    } catch (err) {
      if (err instanceof OutboundBlockedError) throw new GitError('GIT_HOST_BLOCKED', err.message);
      throw new GitError('GIT_NETWORK', `Cannot reach ${target.host}: ${(err as Error).message}`);
    }
    let body: unknown = res.text;
    try {
      body = res.text ? JSON.parse(res.text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, body };
  }

  private send(target: URL, req: HttpRequest, payload: string | undefined) {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<{ status: number; headers: Headers; text: string }>((resolve, reject) => {
      const r = send(
        target,
        {
          method: req.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ProcessHub',
            ...(payload !== undefined
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
              : {}),
            ...req.headers,
          },
          lookup: this.policy.lookup(),
          timeout: this.config.GIT_HTTP_TIMEOUT_MS,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) r.destroy(new Error('response too large'));
            else chunks.push(c);
          });
          res.on('end', () => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
            }
            resolve({
              status: res.statusCode ?? 0,
              headers,
              text: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );
      r.on('timeout', () => r.destroy(new Error('timeout')));
      withDeadline(r, this.config.GIT_HTTP_TIMEOUT_MS * 4);
      r.on('error', reject);
      r.end(payload);
    });
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
