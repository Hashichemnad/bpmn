import { createSign } from 'node:crypto';
import type { SalesforceFieldDto, SalesforceSettingsInput } from '@processhub/shared';
import { SalesforceError, type SalesforceHttp } from './salesforce-http';

export interface SalesforceSecrets {
  clientSecret: string | null;
  privateKey: string | null;
}

export type SfRecord = Record<string, unknown> & { Id: string };

const message = (body: unknown) => {
  if (Array.isArray(body) && body[0] && typeof body[0] === 'object')
    return String((body[0] as { message?: unknown }).message ?? '').slice(0, 300);
  if (body && typeof body === 'object') {
    const b = body as { error_description?: unknown; error?: unknown; message?: unknown };
    return String(b.error_description ?? b.message ?? b.error ?? '').slice(0, 300);
  }
  return typeof body === 'string' ? body.slice(0, 300) : '';
};

/** Value of a (relationship) path such as `Org_Kpi_Measure__r.Measuring_Year__c`. */
export function fieldValue(record: Record<string, unknown>, path: string): unknown {
  let cur: unknown = record;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Read-only Salesforce REST client for one sync: OAuth 2.0 client credentials (My Domain token
 * endpoint) or JWT bearer (certificate of a connected app), then SOQL queries and describes.
 */
export class SalesforceClient {
  private token: { access: string; instance: string } | null = null;

  constructor(
    private readonly http: SalesforceHttp,
    private readonly settings: SalesforceSettingsInput,
    private readonly secrets: SalesforceSecrets,
  ) {}

  private base() {
    return `${this.token!.instance.replace(/\/+$/, '')}/services/data/v${this.settings.apiVersion}`;
  }

  async authenticate() {
    if (this.token) return this.token;
    const s = this.settings;
    if (!s.instanceUrl || !s.clientId)
      throw new SalesforceError('SF_NOT_CONFIGURED', 'Instance URL and client id are required');
    let res;
    if (s.authFlow === 'CLIENT_CREDENTIALS') {
      if (!this.secrets.clientSecret)
        throw new SalesforceError('SF_NOT_CONFIGURED', 'Client secret missing');
      res = await this.http.token(`${s.instanceUrl.replace(/\/+$/, '')}/services/oauth2/token`, {
        grant_type: 'client_credentials',
        client_id: s.clientId,
        client_secret: this.secrets.clientSecret,
      });
    } else {
      if (!this.secrets.privateKey || !s.username)
        throw new SalesforceError('SF_NOT_CONFIGURED', 'Username and private key are required');
      res = await this.http.token(`${s.loginUrl.replace(/\/+$/, '')}/services/oauth2/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.jwt(),
      });
    }
    const body = res.body as { access_token?: string; instance_url?: string };
    if (res.status !== 200 || !body?.access_token)
      throw new SalesforceError('SF_AUTH_FAILED', `HTTP ${res.status}: ${message(res.body)}`);
    this.token = { access: body.access_token, instance: body.instance_url || s.instanceUrl };
    return this.token;
  }

  /** JWT bearer assertion (RS256): issuer = client id, subject = integration user, audience = login URL. */
  private jwt() {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', typ: 'JWT' });
    const claims = enc({
      iss: this.settings.clientId,
      sub: this.settings.username,
      aud: this.settings.loginUrl.replace(/\/+$/, ''),
      exp: Math.floor(Date.now() / 1000) + 180,
    });
    try {
      const signature = createSign('RSA-SHA256')
        .update(`${head}.${claims}`)
        .sign(this.secrets.privateKey!);
      return `${head}.${claims}.${signature.toString('base64url')}`;
    } catch {
      throw new SalesforceError('SF_NO_KEY', 'The private key cannot sign (PEM, RSA)');
    }
  }

  private async getJson(url: string) {
    const t = await this.authenticate();
    const res = await this.http.get(url, t.access);
    if (res.status === 401)
      throw new SalesforceError('SF_AUTH_FAILED', `HTTP 401: ${message(res.body)}`);
    if (res.status !== 200)
      throw new SalesforceError('SF_QUERY_FAILED', `HTTP ${res.status}: ${message(res.body)}`);
    return res.body;
  }

  /** Runs a SOQL query and follows `nextRecordsUrl` (only paths of this API). */
  async query(soql: string, max = 50_000): Promise<SfRecord[]> {
    await this.authenticate();
    let body = (await this.getJson(`${this.base()}/query?q=${encodeURIComponent(soql)}`)) as {
      records?: SfRecord[];
      nextRecordsUrl?: string;
      done?: boolean;
    };
    const out: SfRecord[] = [...(body.records ?? [])];
    while (body.nextRecordsUrl && out.length < max) {
      if (!/^\/services\/data\/v\d+\.\d\/query\/[\w-]+$/.test(body.nextRecordsUrl))
        throw new SalesforceError('SF_QUERY_FAILED', 'Unexpected next page URL');
      body = (await this.getJson(
        `${this.token!.instance.replace(/\/+$/, '')}${body.nextRecordsUrl}`,
      )) as typeof body;
      out.push(...(body.records ?? []));
    }
    return out;
  }

  async describe(object: string): Promise<SalesforceFieldDto[]> {
    await this.authenticate();
    const body = (await this.getJson(
      `${this.base()}/sobjects/${encodeURIComponent(object)}/describe`,
    )) as {
      fields?: { name: string; label: string; type: string; referenceTo?: string[] }[];
    };
    return (body.fields ?? []).map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      referenceTo: f.referenceTo ?? [],
    }));
  }

  /** The user and organisation the token belongs to (Test connection). */
  async identity(): Promise<{ organizationId?: string; userName?: string }> {
    await this.authenticate();
    const body = (await this.getJson(`${this.base()}/chatter/users/me`).catch(() => null)) as {
      username?: string;
      companyName?: string;
    } | null;
    const org = (await this.query('SELECT Id FROM Organization LIMIT 1').catch(
      () => [],
    )) as SfRecord[];
    return { organizationId: org[0]?.Id, userName: body?.username };
  }

  /** Record page in Lightning Experience. */
  recordUrl(id: string) {
    return `${(this.token?.instance ?? this.settings.instanceUrl).replace(/\/+$/, '')}/lightning/r/${id}/view`;
  }
}
