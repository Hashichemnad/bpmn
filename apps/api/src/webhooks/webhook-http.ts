import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { OutboundPolicy } from '../common/outbound';
import { safeFetch } from '../common/safe-fetch';

export interface WebhookResponse {
  status: number;
  body: string;
}

/**
 * The HTTP POST of a delivery (D-174): SSRF policy of OUTBOUND_ALLOWED_HOSTS (internal addresses
 * refused, the checked address is the one connected to), redirects never followed, 64 KB response
 * limit, WEBHOOK_TIMEOUT_MS.
 */
@Injectable()
export class WebhookHttp {
  readonly policy: OutboundPolicy;
  private readonly fetcher: ReturnType<typeof safeFetch>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.policy = new OutboundPolicy(config.outboundAllowedHosts);
    this.fetcher = safeFetch({
      policy: this.policy,
      timeoutMs: config.WEBHOOK_TIMEOUT_MS,
      maxBytes: 64 * 1024,
    });
  }

  async post(url: string, body: string, headers: Record<string, string>): Promise<WebhookResponse> {
    const res = await this.fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
      body,
    });
    return { status: res.status, body: (await res.text()).slice(0, 2000) };
  }
}
