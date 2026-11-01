import { withDeadline } from '../common/deadline';
import { Inject, Injectable } from '@nestjs/common';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { OutboundBlockedError, OutboundPolicy } from '../common/outbound';

export interface SfResponse {
  status: number;
  body: unknown;
}

export class SalesforceError extends Error {
  constructor(
    readonly code:
      | 'SF_NOT_CONFIGURED'
      | 'SF_AUTH_FAILED'
      | 'SF_HOST_BLOCKED'
      | 'SF_NETWORK'
      | 'SF_QUERY_FAILED'
      | 'SF_NO_KEY',
    message: string,
  ) {
    super(message);
  }
}

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

/**
 * The only place that talks to Salesforce over the network (tests replace it with recorded
 * fixtures). Read-only by construction: `GET` for queries and describes, `POST` only to the OAuth
 * token endpoint. Internal addresses refused unless allowed; https only; redirects not followed.
 */
@Injectable()
export class SalesforceHttp {
  private readonly policy: OutboundPolicy;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.policy = new OutboundPolicy(config.outboundAllowedHosts);
  }

  async get(url: string, token: string): Promise<SfResponse> {
    return this.send(new URL(url), 'GET', { Authorization: `Bearer ${token}` });
  }

  /** OAuth 2.0 token request (form encoded). */
  async token(url: string, form: Record<string, string>): Promise<SfResponse> {
    const target = new URL(url);
    if (!target.pathname.endsWith('/services/oauth2/token'))
      throw new SalesforceError('SF_NETWORK', 'Only the OAuth token endpoint accepts POST');
    return this.send(target, 'POST', {}, new URLSearchParams(form).toString());
  }

  private async send(
    target: URL,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    payload?: string,
  ): Promise<SfResponse> {
    if (target.protocol !== 'https:' && !this.policy.allowsHost(target.hostname))
      throw new SalesforceError('SF_HOST_BLOCKED', `Only https is allowed (${target.host})`);
    let res: { status: number; text: string };
    try {
      await this.policy.resolve(target.hostname);
      res = await this.raw(target, method, headers, payload);
    } catch (err) {
      if (err instanceof OutboundBlockedError)
        throw new SalesforceError('SF_HOST_BLOCKED', err.message);
      throw new SalesforceError(
        'SF_NETWORK',
        `Cannot reach ${target.host}: ${(err as Error).message}`,
      );
    }
    let body: unknown = res.text;
    try {
      body = res.text ? JSON.parse(res.text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  }

  private raw(target: URL, method: string, headers: Record<string, string>, payload?: string) {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const r = send(
        target,
        {
          method,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ProcessHub',
            ...(payload !== undefined
              ? {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
            ...headers,
          },
          lookup: this.policy.lookup(),
          timeout: this.config.SALESFORCE_HTTP_TIMEOUT_MS,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) r.destroy(new Error('response too large'));
            else chunks.push(c);
          });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      r.on('timeout', () => r.destroy(new Error('timeout')));
      withDeadline(r, this.config.SALESFORCE_HTTP_TIMEOUT_MS * 4);
      r.on('error', reject);
      r.end(payload);
    });
  }
}
